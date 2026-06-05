#!/usr/bin/env node
// Colony CLI bin shim with daemon fast-path for `colony bridge lifecycle`.
//
// Why: every IDE tool event fires `colony bridge lifecycle ...` from external
// hook integrations (oh-my-codex's ColonyBridge.spawnSync, Codex/Claude Code
// settings). Cold-starting Node on each event pegs ~one core for ~300 ms.
// Multiplied across concurrent agents this is a measurable CPU storm. When
// the worker daemon is running, we POST the envelope to /api/bridge/lifecycle
// and skip the rest of the CLI bootstrap entirely.
//
// Rules:
// - Only `bridge lifecycle --json` is fast-pathed. Everything else falls
//   through to the in-process CLI so behavior is unchanged.
// - Daemon unreachable / errored / unknown flags / missing --json / trailing
//   positional args ⇒ fall back to the in-process CLI with stdin intact
//   (we buffer it so it can be replayed).
// - Pure node:* builtins so the same shim runs on Linux, macOS, and Windows
//   (cmd, PowerShell, Git Bash) — no curl, no /bin/sh.

import { request } from 'node:http';
import { connect } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = (() => {
  // COLONY_CLI_ENTRY is a test-only seam: the bin-shim tests point it at a
  // stub so they can assert on argv/stdin replay without booting the real CLI.
  const override = process.env.COLONY_CLI_ENTRY;
  if (override) return isAbsolute(override) ? override : resolve(HERE, '..', override);
  return resolve(HERE, '..', 'dist', 'index.js');
})();

const fastEnv = (process.env.COLONY_BRIDGE_FAST ?? '1').toLowerCase();
const FAST_DISABLED =
  fastEnv === '0' || fastEnv === 'false' || fastEnv === 'no' || fastEnv === 'off';

const PORT = Number(process.env.COLONY_WORKER_PORT ?? 37777);
const HOST = '127.0.0.1';
// Match the curl-based shell version: --connect-timeout 1, --max-time 2.
const CONNECT_TIMEOUT_MS = 1000;
const REQUEST_TIMEOUT_MS = 2000;

const argv = process.argv.slice(2);

await main().catch((err) => {
  process.stderr.write(`colony: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

async function main() {
  // Non-fast-path-eligible commands take the unchanged CLI path immediately.
  if (FAST_DISABLED || argv[0] !== 'bridge' || argv[1] !== 'lifecycle') {
    await runCli(argv, null);
    return;
  }

  const parsed = parseBridgeLifecycleFlags(argv.slice(2));

  // Bail on unknown flags, missing --json (humans want pretty output), or
  // trailing positional args we don't know how to forward. Same triage as
  // the legacy shell shim.
  if (!parsed.ok || !parsed.json || parsed.rest.length > 0) {
    await runCli(rebuildSafeArgv(parsed), null);
    return;
  }

  const body = await readAllStdin();
  const served = await tryDaemon({ ide: parsed.ide, cwd: parsed.cwd, body });
  if (served) return;

  // Daemon unreachable or non-200 — fall back to the in-process CLI with the
  // buffered envelope replayed on stdin.
  await runCli(rebuildSafeArgv(parsed), body);
}

function parseBridgeLifecycleFlags(rest) {
  const out = { ok: true, json: false, ide: '', cwd: '', rest: [] };
  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a === '--json') {
      out.json = true;
      i += 1;
      continue;
    }
    if (a === '--ide') {
      out.ide = rest[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (a.startsWith('--ide=')) {
      out.ide = a.slice('--ide='.length);
      i += 1;
      continue;
    }
    if (a === '--cwd') {
      out.cwd = rest[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (a.startsWith('--cwd=')) {
      out.cwd = a.slice('--cwd='.length);
      i += 1;
      continue;
    }
    if (a === '--') {
      out.rest = rest.slice(i + 1);
      break;
    }
    out.ok = false;
    out.rest = rest.slice(i);
    break;
  }
  return out;
}

function rebuildSafeArgv(parsed) {
  const out = ['bridge', 'lifecycle'];
  if (parsed.json) out.push('--json');
  if (parsed.ide) out.push('--ide', parsed.ide);
  if (parsed.cwd) out.push('--cwd', parsed.cwd);
  return out;
}

function readAllStdin() {
  return new Promise((resolveOuter, rejectOuter) => {
    if (process.stdin.isTTY) {
      resolveOuter(Buffer.alloc(0));
      return;
    }
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolveOuter(Buffer.concat(chunks)));
    process.stdin.on('error', rejectOuter);
  });
}

function probeDaemon() {
  return new Promise((resolveOuter) => {
    const socket = connect({ port: PORT, host: HOST });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveOuter(ok);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function tryDaemon({ ide, cwd, body }) {
  if (!(await probeDaemon())) return false;
  return new Promise((resolveOuter) => {
    const req = request(
      {
        host: HOST,
        port: PORT,
        method: 'POST',
        path: '/api/bridge/lifecycle',
        headers: {
          'content-type': 'application/json',
          'content-length': body.length,
          'x-colony-ide': ide,
          'x-colony-cwd': cwd,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            process.stdout.write(Buffer.concat(chunks));
            resolveOuter(true);
          } else {
            resolveOuter(false);
          }
        });
        res.on('error', () => resolveOuter(false));
      },
    );
    req.on('error', () => resolveOuter(false));
    req.on('timeout', () => {
      req.destroy();
      resolveOuter(false);
    });
    req.write(body);
    req.end();
  });
}

async function runCli(args, stdinBuffer) {
  // Make isMainEntry() in dist/index.js succeed when we dynamic-import it:
  // it compares import.meta.url against the realpath of process.argv[1].
  // Pointing argv[1] at the resolved CLI entry makes the in-process import
  // behave exactly like a direct `node dist/index.js` invocation.
  process.argv = [process.argv[0], CLI_ENTRY, ...args];
  if (stdinBuffer && stdinBuffer.length > 0) {
    installReplayStdin(stdinBuffer);
  }
  await import(pathToFileURL(CLI_ENTRY).href);
}

function installReplayStdin(buf) {
  const replay = Readable.from([buf]);
  // Preserve a few properties consumers may sniff on process.stdin.
  Object.assign(replay, { isTTY: false, fd: 0 });
  Object.defineProperty(process, 'stdin', {
    value: replay,
    configurable: true,
    writable: true,
  });
}
