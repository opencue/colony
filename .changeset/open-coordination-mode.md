---
'@colony/mcp-server': minor
'@colony/config': minor
---

Open coordination mode (new default): role gates become advisory. `settings.coordinationMode: 'open' | 'guarded'` — under open, scouts can claim, any agent can propose (no cap), everyone sees all proposals, and contended `task_claim_file` calls succeed with loud contention info (`contention`, `contention_detail`, `warning`) instead of erroring; table ownership stays with the live owner. Queen-only approval, subtask completion ownership, evidence requirements, and protected-branch rejection stay hard in both modes. `task_plan_claim_subtask` gains `force: boolean` to override unmet deps with an audit note. Set `coordinationMode: 'guarded'` to restore strict behavior.
