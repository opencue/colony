## Why

- Colony's hard gates were hostile to the default agent: unprofiled agents are `executor` and could not propose; scouts could not claim; contended claims hard-failed; executors could not even see unapproved proposals. The user wants advisory coordination — fewer rules, more agent freedom — with strictness still available.

## What Changes

- New `settings.coordinationMode: 'open' | 'guarded'`, default **open**.
- Open mode: `SCOUT_NO_CLAIM` and `EXECUTOR_CANNOT_PROPOSE` lifted; scout proposal cap lifted; `filterReadyForExecutor` bypassed (everyone sees all proposals); contended `task_claim_file` succeeds with `{contention, contention_detail, warning, claim_status}` while table ownership stays with the live owner.
- Hard in both modes: queen/operator-only proposal approval, subtask completion ownership, proposal evidence requirement, protected-branch claim rejection.
- `task_plan_claim_subtask` gains `force: boolean` — overrides `PLAN_SUBTASK_DEPS_UNMET` and records a `plan-subtask-force-claim` audit observation.
- Guarded mode preserves the historical behavior byte-for-byte; strict-gate tests now run against explicit guarded settings.

## Impact

- Behavior change for fleets relying on role gating: set `coordinationMode: 'guarded'` to keep strict mode. docs/mcp.md updated (task_claim_file, task_propose). Response shapes additive.
