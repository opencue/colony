## Why

- Colony's MCP server registers every tool unconditionally (79 at time of writing). Each registered tool's name + description + JSON schema is injected into every connected agent session's context — an estimated 15-30k tokens per session — even though a typical coding session calls only a handful of memory + coordination tools.

## What Changes

- The stdio MCP server resolves a **tool profile** at startup: `COLONY_TOOL_PROFILE` env var (`lean` | `full`) > `settings.mcp.toolProfile` > default `lean`.
- `lean` registers only the 20-tool `LEAN_TOOLS` set (`apps/mcp-server/src/tools/tool-profile.ts`): startup_panel, hivemind, hivemind_context, attention_inbox, task_ready_for_agent, search, get_observations, task_list, task_post, task_note_working, task_claim_file, task_claim_quota_accept, task_claim_quota_decline, task_message, task_messages, task_message_mark_read, task_accept_handoff, task_decline_handoff, bridge_status, recall_session.
- `full` preserves today's complete surface. Gating is central — a registrar facade drops non-lean `server.tool()` registrations — so the tools/*.ts modules stay untouched.
- New `mcp.toolProfile` setting in `@colony/config` (auto-documented via settingsDocs).

## Impact

- **Breaking (accepted):** sessions that relied on the default full surface (plan/spec/foraging/memoir/proposal/queen lanes) must set `COLONY_TOOL_PROFILE=full` in their MCP spawn config or `settings.mcp.toolProfile: 'full'`. The MCP SDK cannot re-register mid-session, so switching requires a server restart.
- codex/OMX bridge keeps working: `bridge_status` and the AGENTS.md sweep tools (hivemind_context, attention_inbox, task_ready_for_agent) are all in lean.
- Vitest runs pin `COLONY_TOOL_PROFILE=full` (vitest.config.ts) so behavior tests keep the full surface; lean coverage asserts the exact 20-tool list explicitly.
