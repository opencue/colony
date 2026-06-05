import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Locking the wrapper's behavior matters because rule #10 in CLAUDE.md
// ("hooks never wait on, never lose writes to, a daemon that may be down")
// is enforced by the wrapper, not by the worker. If the wrapper stops
// falling back to the in-process CLI when the daemon is unreachable, writes
// get silently dropped on the floor.
//
// The shim used to be a POSIX shell script (`bin/colony.sh`) and these tests
// spawned it through `sh`. It is now a Node ES module so the same shim runs
// on Windows, macOS, and Linux — the tests drive it via `node bin/colony.mjs`.

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM = resolve(HERE, '..', 'bin', 'colony.mjs');
const IS_WINDOWS = platform() === 'win32';

function freeUnusedPort(): string {
  // Port 1 is reserved/privileged on Linux. Connecting to it from a
  // non-root user reliably refuses without being a wildcard. Good enough
  // for "daemon definitely not listening".
  return '1';
}

interface ShimRun {
  status: number;
  stdout: string;
  stderr: string;
  log: string;
}

function runShim(
  args: string[],
  opts: { stdin?: string; env?: NodeJS.ProcessEnv; cliStub: string; logFile: string },
): ShimRun {
  const result = spawnSync(process.execPath, [SHIM, ...args], {
    input: opts.stdin ?? '',
    env: {
      ...process.env,
      // The shim resolves its CLI target via this env var so tests don't have
      // to build dist/ to exercise the dispatch logic.
      COLONY_CLI_ENTRY: opts.cliStub,
      COLONY_STUB_LOG: opts.logFile,
      ...(opts.env ?? {}),
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    log: existsOrEmpty(opts.logFile),
  };
}

function existsOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

describe('bin/colony.mjs', () => {
  let dir: string;
  let cliStub: string;
  let stubLog: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'colony-shim-'));
    cliStub = join(dir, 'cli-stub.mjs');
    stubLog = join(dir, 'stub.log');
    // The shim dynamic-imports CLI_ENTRY in the same process. The stub
    // records argv (one arg per line) and the buffered stdin so tests can
    // assert on both, then exits cleanly.
    writeFileSync(
      cliStub,
      [
        "import { appendFileSync } from 'node:fs';",
        'const log = process.env.COLONY_STUB_LOG;',
        "appendFileSync(log, 'ARGV_BEGIN\\n');",
        "for (const a of process.argv.slice(2)) appendFileSync(log, a + '\\n');",
        "appendFileSync(log, 'ARGV_END\\n');",
        "appendFileSync(log, 'STDIN_BEGIN\\n');",
        "let buf = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (c) => { buf += c; });",
        "process.stdin.on('end', () => {",
        "  appendFileSync(log, buf + '\\nSTDIN_END\\n');",
        '});',
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exists and is executable when packaged', () => {
    const stat = statSync(SHIM);
    if (IS_WINDOWS) {
      // Windows has no POSIX exec bit; npm generates `.cmd`/`.ps1` wrappers
      // that invoke `node bin\\colony.mjs`. We just assert the file is there.
      expect(stat.isFile()).toBe(true);
    } else {
      // Owner exec bit. npm pack preserves the executable bit when packaging,
      // so this is what e2e-publish.sh ends up installing as $PREFIX/bin/colony.
      expect(stat.mode & 0o100).toBeTruthy();
    }
  });

  it('falls back to the CLI when the daemon is unreachable, with stdin and args intact (rule-10 contract)', () => {
    const envelope = '{"event_id":"e_test_1","event_name":"pre_tool_use"}';
    const result = runShim(
      ['bridge', 'lifecycle', '--json', '--ide', 'claude-code', '--cwd', '/tmp/has spaces'],
      {
        stdin: envelope,
        env: { COLONY_WORKER_PORT: freeUnusedPort() },
        cliStub,
        logFile: stubLog,
      },
    );

    expect(result.status).toBe(0);
    expect(result.log).toContain('ARGV_BEGIN');
    expect(result.log).toContain('bridge');
    expect(result.log).toContain('lifecycle');
    expect(result.log).toContain('--json');
    expect(result.log).toContain('--ide');
    expect(result.log).toContain('claude-code');
    expect(result.log).toContain('--cwd');
    // Quoting must be preserved across the value with the space.
    expect(result.log).toContain('/tmp/has spaces');
    expect(result.log).toContain(`STDIN_BEGIN\n${envelope}`);
  });

  it('disables the fast-path entirely when COLONY_BRIDGE_FAST=0', () => {
    const result = runShim(['bridge', 'lifecycle', '--json'], {
      stdin: '{}',
      env: { COLONY_BRIDGE_FAST: '0' },
      cliStub,
      logFile: stubLog,
    });

    expect(result.status).toBe(0);
    expect(result.log).toContain('bridge');
    expect(result.log).toContain('lifecycle');
  });

  it('passes through non-bridge-lifecycle commands unchanged', () => {
    const result = runShim(['--version'], {
      cliStub,
      logFile: stubLog,
    });

    expect(result.status).toBe(0);
    expect(result.log).toContain('--version');
  });

  it('passes through `bridge lifecycle` without --json (humans want pretty output)', () => {
    const result = runShim(['bridge', 'lifecycle'], {
      stdin: '{}',
      env: { COLONY_WORKER_PORT: freeUnusedPort() },
      cliStub,
      logFile: stubLog,
    });

    expect(result.status).toBe(0);
    expect(result.log).toContain('bridge');
    expect(result.log).toContain('lifecycle');
    expect(result.log).not.toContain('--json');
  });

  it('passes through `bridge replay <file>` unchanged (no fast-path, CLI owns it)', () => {
    const result = runShim(['bridge', 'replay', 'foo.pre.json'], {
      env: { COLONY_WORKER_PORT: freeUnusedPort() },
      cliStub,
      logFile: stubLog,
    });

    expect(result.status).toBe(0);
    expect(result.log).toContain('bridge');
    expect(result.log).toContain('replay');
    expect(result.log).toContain('foo.pre.json');
  });
});
