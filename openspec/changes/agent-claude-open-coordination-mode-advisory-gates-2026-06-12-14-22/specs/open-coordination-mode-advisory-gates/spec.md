## ADDED Requirements

### Requirement: Coordination gates follow coordinationMode
Coordination role gates SHALL be advisory under `coordinationMode: 'open'` (default) and strict under `'guarded'`.

#### Scenario: Open mode lifts role gates
- **WHEN** mode is open
- **THEN** scouts can claim files, any agent can propose with evidence, no open-proposal cap applies, and ready-work shows unapproved proposals.

#### Scenario: Contended claim succeeds loudly in open mode
- **WHEN** another live session holds a file and mode is open
- **THEN** `task_claim_file` succeeds with `contention: true`, `claim_status`, `warning`, and `contention_detail`
- **AND** the claims table ownership stays with the live owner.

#### Scenario: Guarded mode preserves strict behavior
- **WHEN** mode is guarded
- **THEN** SCOUT_NO_CLAIM, EXECUTOR_CANNOT_PROPOSE, the proposal cap, executor filtering, and CLAIM_HELD_BY_ACTIVE_OWNER / CLAIM_TAKEOVER_RECOMMENDED errors behave as before.

### Requirement: Hard gates survive both modes
Queen/operator-only proposal approval, subtask completion ownership, proposal evidence, and protected-branch claim rejection SHALL remain enforced regardless of mode.

#### Scenario: Forced subtask claim is audited
- **WHEN** `task_plan_claim_subtask` is called with `force: true` and deps are unmet
- **THEN** the claim proceeds and a `plan-subtask-force-claim` observation records the unmet deps.
