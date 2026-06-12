# MCP tool description diet + registration budget guard (T1)

Why: each registered tool's name+description+schema is injected into every agent session. After #588's lean profile, descriptions were the next cost: six tools carried 500-900-char descriptions whose tails were reference prose, not triggers.

What:
- Rewrote attention_inbox, task_ready_for_agent, task_relay, task_hand_off (incl. shared RELAY_FALLBACK_RULE), cluster_observations, task_plan_list descriptions. All test-pinned trigger phrases preserved (tool-descriptions.test.ts, message-descriptions.test.ts, server.test.ts assertions all green).
- New apps/mcp-server/test/tool-budget.test.ts: lean surface ≤ 4,200 est. tokens (measured 3,828), full ≤ 15,000 (measured 13,676), per-description cap 540 chars.
- De-flaked coordination-loop.test.ts claimed_file_preview ordering (same-ms timestamp tie).

Verification: pnpm typecheck/lint/test/build green (test exit 0).
