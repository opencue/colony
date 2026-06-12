---
'@colony/mcp-server': patch
---

Tool description diet + registration token budget guard. The six bulkiest MCP tool descriptions (attention_inbox, task_ready_for_agent, task_relay, task_hand_off, cluster_observations, task_plan_list) are rewritten to keep their trigger phrases and drop tail prose. New `tool-budget.test.ts` fails CI if the lean surface exceeds 4,200 estimated tokens, the full surface exceeds 15,000, or any description exceeds 540 chars. Also de-flakes coordination-loop's claim-preview ordering assertion.
