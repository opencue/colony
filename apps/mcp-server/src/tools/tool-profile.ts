import type { McpToolProfile, Settings } from '@colony/config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Tools registered under the lean profile: the high-traffic memory +
 * coordination primitives a typical single coding session actually calls.
 * Everything else (plan, spec, foraging, memoir, proposal, relay, savings,
 * rescue, autopilot, queen lanes) registers only under the full profile —
 * each registered tool costs every agent session schema-injection tokens
 * whether or not it is ever called.
 *
 * Adding a tool here is a contract change: update docs/mcp.md and the
 * lean-profile assertions in apps/mcp-server/test/server.test.ts.
 */
export const LEAN_TOOLS: ReadonlySet<string> = new Set([
  'startup_panel',
  'hivemind',
  'hivemind_context',
  'attention_inbox',
  'task_ready_for_agent',
  'search',
  'get_observations',
  'task_list',
  'task_post',
  'task_note_working',
  'task_claim_file',
  'task_claim_quota_accept',
  'task_claim_quota_decline',
  // task_message_retract / task_message_claim excluded — low-traffic, full-only.
  'task_message',
  'task_messages',
  'task_message_mark_read',
  'task_accept_handoff',
  'task_decline_handoff',
  'bridge_status',
  'recall_session',
]);

/** Env override wins over settings so per-lane MCP spawn configs (e.g. a queen/planner lane that needs the plan tools) can opt into the full surface without editing shared settings. */
export function resolveToolProfile(
  settings: Settings,
  env: NodeJS.ProcessEnv = process.env,
): McpToolProfile {
  const fromEnv = env.COLONY_TOOL_PROFILE;
  if (fromEnv === 'lean' || fromEnv === 'full') return fromEnv;
  return settings.mcp.toolProfile;
}

/**
 * Wrap an McpServer so `tool(name, ...)` registrations are dropped unless
 * `allow(name)` passes. Every other member delegates to the real server with
 * `this` bound to it, so SDK-internal state stays on the original instance.
 * Central gating keeps one source of truth (LEAN_TOOLS) instead of spreading
 * profile conditionals across every tools/*.ts module.
 *
 * Callers must not capture `tool()`'s return value: dropped registrations
 * return undefined even though the McpServer type promises RegisteredTool.
 */
export function gateToolRegistration(
  server: McpServer,
  allow: (name: string) => boolean,
  onRegister?: (name: string, description: string) => void,
): McpServer {
  return new Proxy(server, {
    get(target, prop, _receiver) {
      if (prop === 'tool') {
        return (...args: unknown[]) => {
          const name = args[0];
          if (typeof name === 'string' && !allow(name)) return undefined;
          if (typeof name === 'string' && onRegister) {
            onRegister(name, typeof args[1] === 'string' ? args[1] : '');
          }
          return (target.tool as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      // receiver is target, not the proxy — getters must run against the
      // real instance or proxy re-entrancy corrupts `this`-dependent state.
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as CallableFunction).bind(target) : value;
    },
  }) as McpServer;
}

/**
 * Registration-cost telemetry captured while tools register. Token figure
 * covers name + description only — input schemas are zod shapes here and only
 * become countable JSON schema at listTools time; the schema-inclusive budget
 * lives in apps/mcp-server/test/tool-budget.test.ts.
 */
export interface ToolRegistrationStats {
  profile: McpToolProfile;
  tool_count: number;
  name_description_tokens: number;
}
