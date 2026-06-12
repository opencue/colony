#!/usr/bin/env node
import { readSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { type Settings, loadSettings, resolveDataDir } from '@colony/config';
import { type Embedder, MemoryStore } from '@colony/core';
import { createEmbedder } from '@colony/embedding';
import { isMainEntry } from '@colony/process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as accountClaims from './tools/account-claims.js';
import * as attention from './tools/attention.js';
import * as autopilot from './tools/autopilot.js';
import * as bridge from './tools/bridge.js';
import type { ToolContext } from './tools/context.js';
import * as drift from './tools/drift.js';
import * as feedback from './tools/feedback.js';
import * as foraging from './tools/foraging.js';
import { registerTaskForagingReport } from './tools/foraging.js';
import * as handoff from './tools/handoff.js';
import { createHeartbeatWrapper, installActiveSessionHeartbeat } from './tools/heartbeat.js';
import * as hivemind from './tools/hivemind.js';
import * as memoirs from './tools/memoirs.js';
import * as message from './tools/message.js';
import { createMetricsWrapper } from './tools/metrics-wrapper.js';
import * as planValidate from './tools/plan-validate.js';
import * as plan from './tools/plan.js';
import * as profile from './tools/profile.js';
import * as proposal from './tools/proposal.js';
import * as queen from './tools/queen.js';
import * as readyQueue from './tools/ready-queue.js';
import * as recall from './tools/recall.js';
import * as relay from './tools/relay.js';
import * as rescue from './tools/rescue.js';
import * as savingsDrift from './tools/savings-drift.js';
import * as savings from './tools/savings.js';
import * as search from './tools/search.js';
import * as spec from './tools/spec.js';
import * as startupPanel from './tools/startup-panel.js';
import * as suggest from './tools/suggest.js';
import * as task from './tools/task.js';
import { LEAN_TOOLS, gateToolRegistration, resolveToolProfile } from './tools/tool-profile.js';

export { buildBridgeStatusPayload } from './tools/bridge.js';
export type { BridgeStatus, BridgeStatusOptions } from './tools/bridge.js';
export { LEAN_TOOLS, resolveToolProfile } from './tools/tool-profile.js';

/**
 * MCP stdio server exposing progressive-disclosure tools:
 * - search: compact hits with BM25 + optional semantic re-rank
 * - timeline: chronological IDs around a point
 * - get_observations: full bodies by ID
 * - list_sessions: recent sessions for navigation
 * - hivemind: compact proxy-runtime active task map
 * - hivemind_context: active task map plus compact relevant memory hits
 *
 * Embedder is loaded lazily on first search — keeps MCP handshake fast.
 */
export function buildServer(
  store: MemoryStore,
  settings: Settings,
  options: Pick<ToolContext, 'planValidation' | 'toolProfile'> = {},
): McpServer {
  const server = new McpServer({
    name: 'colony',
    version: '0.1.0',
  });

  // lean (default) registers only LEAN_TOOLS — every registered tool costs
  // every agent session schema-injection context whether or not it is called.
  // COLONY_TOOL_PROFILE=full (or settings.mcp.toolProfile) restores the
  // whole surface for plan/spec/queen lanes.
  const toolProfile = options.toolProfile ?? resolveToolProfile(settings);
  const registrar =
    toolProfile === 'lean' ? gateToolRegistration(server, (name) => LEAN_TOOLS.has(name)) : server;

  // Make this MCP client visible to hivemind even when the IDE never ran
  // colony's lifecycle hooks (codex, custom MCP clients, background tools).
  // The stdio MCP server is spawned per client session, so env + cwd
  // identify the caller; upsertActiveSession merges with whatever a hook
  // writer may have produced and preserves richer task previews.
  installActiveSessionHeartbeat(server, store, settings);

  // tri-state: undefined = not yet attempted; null = unavailable (provider=none or load failed)
  let embedder: Embedder | null | undefined = undefined;
  const resolveEmbedder = async (): Promise<Embedder | null> => {
    if (embedder !== undefined) return embedder;
    try {
      embedder = await createEmbedder(settings, { log: () => {} });
    } catch (err) {
      process.stderr.write(
        `[colony mcp] embedder unavailable: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      embedder = null;
    }
    return embedder;
  };

  const heartbeat = createHeartbeatWrapper(store, settings);
  const metrics = createMetricsWrapper(store);
  const ctx: ToolContext = {
    store,
    settings,
    toolProfile,
    ...(options.planValidation !== undefined ? { planValidation: options.planValidation } : {}),
    resolveEmbedder,
    // Heartbeat outer touches the active-session row before the handler runs;
    // metrics inner measures handler input/output around the actual work so
    // bookkeeping overhead does not skew duration_ms.
    wrapHandler: (name, handler) => heartbeat(name, metrics(name, handler)),
  };

  // Registration order mirrors the pre-split monolithic server.ts so existing
  // MCP inspector fixtures and snapshot tests stay stable. Every module
  // registers through `registrar`, which drops non-lean tools when the lean
  // profile is active — gating lives in tool-profile.ts, not in the modules.
  search.register(registrar, ctx);
  hivemind.register(registrar, ctx);
  task.register(registrar, ctx);
  accountClaims.register(registrar, ctx);
  handoff.register(registrar, ctx);
  proposal.register(registrar, ctx);
  profile.register(registrar, ctx);
  attention.register(registrar, ctx);
  // task_foraging_report lives in foraging.ts (foraging surface) but stays in
  // the slot it occupied when it was bundled inside attention.ts, so the
  // listTools ordering above does not shift.
  registerTaskForagingReport(registrar, ctx);
  bridge.register(registrar, ctx);
  message.register(registrar, ctx);
  relay.register(registrar, ctx);
  plan.register(registrar, ctx);
  queen.register(registrar, ctx);
  planValidate.register(registrar, ctx);
  readyQueue.register(registrar, ctx);
  startupPanel.register(registrar, ctx);
  recall.register(registrar, ctx);
  suggest.register(registrar, ctx);
  rescue.register(registrar, ctx);
  savings.register(registrar, ctx);
  savingsDrift.register(registrar, ctx);

  // ICM slice 2 feedback lane (docs/icm-integration-plan.md). Registered
  // after the read-side surfaces so the heartbeat wrapper has seen every
  // core tool first.
  feedback.register(registrar, ctx);

  // Autopilot lane (tick advisor + drift checker). Cheap compositions of
  // existing primitives; registered after the core surface so the heartbeat
  // wrapper has already wrapped the tools they delegate to.
  autopilot.register(registrar, ctx);
  drift.register(registrar, ctx);

  // Spec-driven dev lane (@colony/spec). Adds spec_read, spec_change_open,
  // spec_change_add_delta, spec_build_context, spec_build_record_failure,
  // spec_archive. Registered last so the heartbeat wrapper has seen every
  // core tool first.
  spec.register(registrar, ctx);

  // Foraging lane (@colony/foraging). Adds examples_list, examples_query,
  // examples_integrate_plan. Registered after spec so the heartbeat has
  // wrapped the earlier tools before we bind these three.
  foraging.register(registrar, ctx);

  // Memoirs lane (ICM-inspired typed knowledge graphs). Adds memoir_create,
  // memoir_list, memoir_add_concept, memoir_refine, memoir_link,
  // memoir_search, memoir_inspect. Registered last so heartbeat + metrics
  // wrappers have already wrapped the core surface.
  memoirs.register(registrar, ctx);

  return server;
}

export async function main(): Promise<void> {
  const settings = loadSettings();
  const dbPath = join(resolveDataDir(settings.dataDir), 'data.db');
  const store = new MemoryStore({ dbPath, settings });

  const server = buildServer(store, settings);
  const input = createMcpInput();
  const transport = new StdioServerTransport(input, process.stdout);
  try {
    await server.connect(transport);
    await waitForInputClose(input);
  } finally {
    store.close();
  }
}

function createMcpInput(): Readable {
  if (process.stdin.isTTY) return process.stdin;

  const input = new PassThrough();
  const firstChunk = Buffer.alloc(64 * 1024);
  const bytesRead = readSync(0, firstChunk, 0, firstChunk.length, null);

  if (bytesRead === 0) {
    input.end();
    return input;
  }

  input.write(firstChunk.subarray(0, bytesRead));
  process.stdin.pipe(input);
  return input;
}

function waitForInputClose(input: Readable): Promise<void> {
  if (input.destroyed || input.readableEnded) return Promise.resolve();

  return new Promise((resolve) => {
    const keepAlive = setInterval(() => {}, 1_000_000_000);
    const done = () => {
      clearInterval(keepAlive);
      process.off('SIGTERM', done);
      process.off('SIGINT', done);
      input.off('end', done);
      input.off('close', done);
      input.off('error', done);
      resolve();
    };

    input.once('end', done);
    input.once('close', done);
    input.once('error', done);
    process.once('SIGTERM', done);
    process.once('SIGINT', done);

    // A stdio MCP server must keep the process alive after connect() returns.
    // The stdin stream alone is not a reliable event-loop ref in spawned MCP
    // clients. The MCP client owns shutdown by closing/killing the child.
  });
}

if (isMainEntry(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`[colony mcp] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
