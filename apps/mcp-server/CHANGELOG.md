# @colony/mcp-server

## 0.8.0

### Minor Changes

- 8f33724: Add `account_claims` table and three new MCP tools for binding Codex accounts to planner waves.

  `task_claim_account`, `task_release_account_claim`, and `task_list_account_claims` let the recodee planner Account Capacity rail bind a Codex account to a planner wave so multiple operators on the same plan see the same dispatch state. Bindings are keyed by `(plan_slug, wave_id)` — a planner-logical coordinate that exists before any Colony task is spawned — and persist across operators via a new `account_claims` SQLite table. A partial unique index enforces at-most-one-active claim per wave; released claims stay as audit history.

  Schema migrates forward-only from version 10 to 11. No data backfill is required: the table starts empty and is populated by user action. The contract is regression-tested via an MCP-inspector test (`apps/mcp-server/test/account-claims.test.ts`) exercising the full claim → rebind → release → list lifecycle.

- 819660d: Auto-release stale plan-subtask claims in `task_ready_for_agent`

  A `claimed` subtask older than `STALE_PLAN_SUBTASK_CLAIM_MS` (default 1h)
  is now released server-side at the top of `task_ready_for_agent` so the
  ready-queue can route it to the next eligible worker on the same tick.
  Replaces the prior `rescue_candidate` + `next_tool: rescue_stranded_scan`
  suggestion path, which deadlocked policy-locked worker fleets (codex,
  others) that refuse to rescue another agent's claim.

  New behavior:

  - The response carries `auto_released_stale_claims[]` listing the
    releases performed by this call (omitted when nothing was stale).
  - Pass `auto_release_stale_claims: false` to suppress the sweep and
    observe stale state without mutating it (admin / telemetry callers).
  - A new `autoReleaseStalePlanSubtaskClaims(store, plans, options)`
    export from `@colony/core` exposes the same sweep to other consumers
    (e.g. an autopilot tick).

  Audit trail: each release writes one `plan-subtask-claim` observation
  with `status: 'available'` and `rescue_reason: 'auto-released-stale-claim'`,
  matching the shape `bulkRescueStrandedSessions` already uses.

- 782ddb6: Add `cluster_observations` MCP tool for semantic dedupe.

  Greedy single-linkage clustering by cosine threshold over a caller-
  supplied set of observation IDs. The intended consumer is handoff /
  attention_inbox dedupe: collect pending handoff IDs, pass them through
  `cluster_observations(ids, threshold)`, and show the user one canonical
  row per cluster instead of three different agents saying the same thing.

  The MCP tool wraps a new `MemoryStore.clusterObservations` primitive,
  so callers that already use the core package can dedupe without going
  through MCP. Threshold defaults to `0.85`; observations missing an
  embedding come back in a separate `unembedded` array so the caller
  chooses whether to keep them as singletons. Capped at 500 input IDs to
  bound the O(N²) cosine cost.

- a83eeea: `colony gain drift` and a matching `savings_drift_report` MCP tool flag
  tools whose median tokens-per-call has drifted up or down. Default windows
  are non-overlapping: recent = last 3 days, baseline = 14 days ending 3 days
  before recent. Default thresholds: `--threshold 1.25` (up), `--down-threshold
0.75`, `--min-calls 20` per window. Classifications: `up_drift`,
  `down_drift`, `new_tool` (no baseline), `gone` (no recent), `insufficient_data`,
  `stable`.

  Storage gains `Storage.mcpTokenDriftPerOperation()` which computes per-operation
  medians with a `ROW_NUMBER() OVER (PARTITION BY operation ORDER BY tpc)`
  window function — chosen over the correlated `LIMIT 1 OFFSET (COUNT-1)/2`
  form because SQLite forbids outer aggregate references in scalar-subquery
  `OFFSET`. A `mcpMetricsMinTs()` helper surfaces a one-line warning when the
  baseline window starts before the first recorded metric.

- 7dcece2: ICM slice 2 — feedback `record`, `search`, and `stats` MCP tools.

  Adds a new `feedback` lane that records "AI predicted X, real answer
  was Y" corrections so a future agent can search prior mistakes by
  topic before repeating them. Migration 015 introduces the `feedback`
  table plus a porter-unicode61 `feedback_fts` virtual table mirrored
  by the standard `ai/ad/au` triggers; importance is a four-level enum
  defaulting to `medium`. `prediction`, `correction`, and the optional
  `context` flow through `MemoryStore.recordFeedback`, which routes each
  body through `prepareMemoryText` — the same redact-then-compress path
  observations use — so the compression invariant holds at the write
  boundary.

  MCP surface (progressive disclosure):

  - `feedback_record({ topic, prediction, correction, context?, importance?, created_by? })` → `{ id }`
  - `feedback_search({ query, topic?, limit? })` → compact hits (`id`, `topic`, `importance`, `score`, `snippet`, `created_at`)
  - `feedback_stats({ topic? })` → per-topic counts and `last_created_at`

  Follow-up (separate PR): a pre-tool-use hook that surfaces prior
  corrections on inbound prompts. This PR keeps the slice scoped to the
  storage + search surface so it can ship behind a manual query first.

  Reference: `docs/icm-integration-plan.md` slice 2.

- 0950b42: ICM slice 3 — observation importance + temporal decay.

  Every observation now carries an `importance` tier
  (`critical | high | medium | low`, default `medium`), a rolling
  `access_count`, a `last_accessed_at` timestamp, and a `weight` value.
  Critical/high pin their weight to the base value and never decay;
  medium/low decay as `baseWeight / (1 + access_count * 0.1)` whenever
  they are read. Read paths (`MemoryStore.search`, `getObservations`,
  `semanticSearch`) coalesce ids into a debounced 50ms batch and flush
  the access bookkeeping in one transactional UPDATE, so heavy read
  loops trade at most one extra write per ~50ms window.

  Search and `get_observations` MCP responses now include `importance`
  and `weight` on each row (additive — older callers ignore them).
  `task_post` accepts an optional `importance` parameter forwarded to
  the underlying observation insert.

  New CLI subcommand `colony memory prune` deletes near-zero-weight
  medium/low rows; `--min-weight <n>` overrides the default 0.1
  threshold and `--dry-run` reports the candidate count without
  deleting. Critical/high are never affected.

  Storage: schema bumped to version 17 with four additive columns on
  `observations` and two new indexes. `Storage.recordAccess`,
  `Storage.pruneLowDecay`, and `Storage.countLowDecayCandidates` are
  the public primitives. (Originally targeted version 15 in isolation;
  landed at 17 alongside slice 1 memoirs and slice 2 feedback.)

- 0950b42: ICM slice 1 — memoirs (typed knowledge graphs).

  A memoir is a named container of typed concepts (graph nodes) connected
  by typed relations (graph edges). Concept content routes through the
  same `prepareMemoryText` redact → compress pipeline used for
  observations, so the compression invariant holds at the write boundary.
  The nine relation types
  (`part_of`, `depends_on`, `related_to`, `contradicts`, `refines`,
  `alternative_to`, `caused_by`, `instance_of`, `superseded_by`) mirror
  ICM's taxonomy and let agents express "what supersedes X", "what
  contradicts decision Y", and similar structural reasoning without
  abandoning the flat-observations primary store.

  Schema bump 14 → 15 adds three tables (`memoirs`,
  `memoir_concepts`, `memoir_relations`) and one virtual table
  (`memoir_concepts_fts`) with `(ai, ad, au)` triggers mirroring
  `observations_fts`. Migrations are forward-only.

  `MemoryStore` exposes `createMemoir`, `listMemoirs`, `addConcept`,
  `refineConcept`, `linkConcepts`, `searchConcepts`, and `inspectConcept`.
  Seven MCP tools (`memoir_create`, `memoir_list`, `memoir_add_concept`,
  `memoir_refine`, `memoir_link`, `memoir_search`, `memoir_inspect`) wrap
  them with progressive disclosure — `memoir_search` returns compact hits
  and `memoir_inspect` is the only path that returns full bodies plus a
  BFS neighbourhood.

- 7aba1eb: MCP tool profiles: the stdio server now defaults to a lean ~20-tool surface (memory + coordination primitives), cutting per-session schema-injection context cost by more than half. Set `COLONY_TOOL_PROFILE=full` or `settings.mcp.toolProfile: 'full'` to restore the entire tool surface (plan, spec, foraging, memoir, proposal, savings, queen lanes). New `mcp.toolProfile` setting in `@colony/config`.
- 45e1abe: Trim `task_plan_list` token bloat and add recovery hints to two error paths.

  `task_plan_list` now defaults to a compact rollup that omits `subtasks[].description` and `subtasks[].file_scope` — the two heavy fields driving ~60% of MCP wire token spend (12.9k avg per call in `colony gain`). The full legacy shape is preserved as opt-in via `detail: 'full'`. Internal `listPlans()` callers in `@colony/core` bypass MCP and are unaffected.

  `task_note_working` now returns `nearby_tasks` (ranked branch-and-repo > branch-only > repo-only) plus a recovery `hint` when `ACTIVE_TASK_NOT_FOUND` and the caller supplied a `repo_root` or `branch`. Fresh agent sessions that have not yet joined the active task on their branch can recover via `task_post(task_id=...)` or `task_accept_handoff` without re-listing the task table.

  `task_plan_claim_subtask` now attaches `next_available_subtask_index`, `next_available_count`, and a compact `next_available[]` list to `PLAN_SUBTASK_NOT_AVAILABLE` errors so a racing claimer can retry immediately instead of issuing a full `task_plan_list` round trip.

- 3b86d74: Open coordination mode (new default): role gates become advisory. `settings.coordinationMode: 'open' | 'guarded'` — under open, scouts can claim, any agent can propose (no cap), everyone sees all proposals, and contended `task_claim_file` calls succeed with loud contention info (`contention`, `contention_detail`, `warning`) instead of erroring; table ownership stays with the live owner. Queen-only approval, subtask completion ownership, evidence requirements, and protected-branch rejection stay hard in both modes. `task_plan_claim_subtask` gains `force: boolean` to override unmet deps with an audit note. Set `coordinationMode: 'guarded'` to restore strict behavior.
- 7770b58: Session-start preface now enforces a global token budget (`sessionStart.prefaceTokenBudget`, default 800): low-priority sections (scope check, foraging, suggestions, prior sessions) drop first with a one-line trailer naming the trim. Prior-session summaries are capped at 300 chars each. MCP `get_observations` stops forcing expansion — it now honors `compression.expandForModel` (default false), so model-facing reads stay compressed unless `expand: true` is passed. `@colony/core` re-exports `countTokens`.
- ccd51b6: Add `semantic_search` MCP tool for pure-vector recall.

  The existing `search` tool starts with a BM25 candidate pool and then
  vector-reranks it. Queries whose terms never appear in any stored
  observation return zero candidates and miss the vector path entirely —
  that hurts cross-language queries, concept-level queries, and any case
  where the agent and the writer used different words for the same idea.

  `semantic_search` is the escape hatch: skip FTS entirely, embed the
  query, score every stored observation vector by cosine, return top-K.
  Same compact return shape as `search` (id + session_id + kind + snippet

  - score + ts + task_id) and the same progressive-disclosure rule
    (callers fetch full bodies via `get_observations`). Requires an
    embedding provider; returns a structured error otherwise.

  The implementation is intentionally O(N) over stored vectors. At 50k
  observations on the dev box it still fits inside the 50 ms p95 budget
  for `search`; a future ANN index (sqlite-vss / HNSW) goes behind the
  same method signature when scale demands it.

- fc53979: One-call startup + registration-cost telemetry. `startup_panel` now carries `compact_hivemind` (lane map), `attention_summary` ({unread, blocking, pending_handoffs}), and `tool_profile` (lean/full, so agents know whether to restart with COLONY_TOOL_PROFILE=full for plan/spec/memoir tools) — AGENTS.md blesses it as THE startup call, with the legacy 4-call sweep deprecated but working. `savings_report` gains `registration_cost` ({profile, tool_count, name_description_tokens}) so the per-session schema-injection cost is observable.
- 66fa52c: Surface unpublished on-disk plan workspaces in `task_plan_list`, and chain `plan create` into `plan publish`

  Two related improvements so orchestrators (and fleets of codex workers) don't waste cap on a plan they have a workspace for but never registered in Colony:

  - `task_plan_list` now scans `openspec/plans/*` and merges any disk workspace whose slug is not already registered, marked `registry_status: 'unpublished'`. Workers cannot claim from these, but seeing them lets the orchestrator notice and run `colony plan publish <slug>`. Pass `include_unpublished: false` to mirror the legacy registered-only behavior.
  - `colony plan create` now accepts `--publish` (plus optional `--publish-session`, `--publish-agent`, `--publish-auto-archive`) which chains into the same publish path immediately after the workspace is created, eliminating the "I created a plan but workers don't see it" failure mode.
  - `PlanInfo.registry_status` gains an `'unpublished'` variant.

- a918e6f: `task_list` MCP tool now returns a compact rollup by default.

  `colony gain` showed `task_list` averaging 14.1k tokens per call — the second-largest line item after the recently-trimmed `task_plan_list`. Each row was emitting the full `TaskRow` shape (8 fields including long `repo_root` absolute paths and long `agent/*` branch names) for up to 50 tasks per call.

  Default response is now `tasks: [{ id, title, branch, status, updated_at }]`. The legacy shape including `repo_root`, `created_by`, and `created_at` is preserved as opt-in via `detail: "full"`. Internal callers using `store.storage.listTasks()` directly are unaffected.

- f7b490a: Cross-agent awareness: unified liveness + working-note "now lines". `readHivemind` accepts an optional `sqliteLiveness` source — sessions with stale heartbeat files but fresh SQLite observations are reclassified as working (`liveness_source: 'sqlite'`); every hivemind session now carries `liveness_source`. `attention_inbox` gains `active_working_notes` (latest task_note_working note per other live session, 30-min window) plus `summary.active_working_note_count`. The SessionStart task preface shows up to 3 co-participant "now:" lines so agents start each session knowing what everyone else is mid-flight on.

### Patch Changes

- 9e1a791: Explain `task_claim_file` rejections instead of returning a generic "not claimable"

  `task_claim_file` (and the `TaskThread.claimFile` /
  `normalizeOptionalClaimPath` paths inside `@colony/core`) used to throw
  `INVALID_CLAIM_PATH: claim path is not claimable` with no hint at the
  reason. Telemetry showed agents bouncing off the same surface for the same
  input — e.g. `colony/packages/core/test` (a directory) — because the
  message gave them nothing to act on.

  The rejection branch now classifies the failure and renders a specific
  message per reason:

  - `directory` — _"claim path "X" is a directory; claim individual files inside it instead."_
  - `pseudo` — _"claim path "X" is a pseudo path (e.g. /dev/null) and cannot be claimed."_
  - `outside_repo` — _"claim path "X" resolves outside this task's repo_root and cannot be claimed."_
  - `empty` — _"claim path is empty."_
  - fallback — the legacy generic message, still keyed on the input path.

  New exports from `@colony/storage`:

  - `classifyClaimPathRejection(context)` — pure classifier paralleling
    `normalizeRepoFilePath`. Returns the reason or `null`.
  - `claimPathRejectionMessage(reason, file_path)` — single source of
    truth for the user-facing message so the MCP `task_claim_file`
    handler and `TaskThread.claimFile` stay in sync.
  - New storage method `classifyTaskFilePathRejection(task_id, file_path,
cwd?)` plumbs the task → repo_root lookup that the existing
    `normalizeTaskFilePath` already does, so callers only pay for the
    classifier on the error branch.

  No behavior change: the same inputs that used to be rejected are still
  rejected; only the error message and code surface improve. Existing
  INVALID_CLAIM_PATH error code is preserved.

- f1659a8: Attribute `<unknown>` session metrics via the MCP client-identity fallback

  `colony gain` previously bucketed ~9,000 calls/day into a single
  `<unknown>` session row. Cause: high-volume read-only tools
  (`task_plan_list`, `get_observations`, `search`, `task_timeline`,
  `list_sessions`, `examples_list`, …) carry no `session_id` in their
  schema, so `metricContextOf` had nothing to attribute the call to.

  The metrics wrapper now reuses the same `detectMcpClientIdentity` heuristic
  the heartbeat wrapper already runs on every call: env-derived identity
  (`CODEX_SESSION_ID`, `CLAUDECODE_SESSION_ID`, `COLONY_CLIENT_SESSION_ID`),
  or a stable `mcp-<ppid>` fallback when no signal is available. The
  explicit `args.session_id` / `args.current_session_id` path is unchanged;
  the fallback only fires when both are absent.

  Effect on the savings report: per-client session rows replace the giant
  `<unknown>` bucket, making it possible to see which agent / connection is
  driving the bulk of the load — the regression-investigation gap that
  PR #531's compact-mode fix left open.

  No new tool dependencies; the wrapper reads `detectMcpClientIdentity` from
  `./heartbeat.js` (already in the same package).

- 364e6a0: Move `task_foraging_report` source location from `attention.ts` to `foraging.ts`

  The tool is part of the foraging surface (it wraps `ProposalSystem.foragingReport`
  and is conceptually paired with `examples_list` / `examples_query`), not the
  attention-inbox surface. It only lived in `attention.ts` as an accident of the
  pre-split monolithic `server.ts`.

  Pure code-location refactor. The MCP tool name, description, input schema, and
  handler body are byte-identical. `server.ts` registers it at the same call-site
  slot via a new `registerTaskForagingReport` named export, so the `listTools`
  ordering observed by inspectors stays unchanged.

- e6c5766: Reject `task_claim_file` at the MCP layer when the task's branch is a protected base branch.

  `guardedClaimFile` already returned `protected_branch_rejected` (controlled by the `rejectProtectedBranchClaims` setting, default `true`) but the MCP handler silently fell through and recorded the claim anyway. The handler now checks for that status and returns a distinct `PROTECTED_BRANCH_CLAIM_REJECTED` error code with a message directing the agent to start a sandbox worktree first.

  `PROTECTED_BRANCH_CLAIM_REJECTED` is added to `TASK_THREAD_ERROR_CODES` in `@colony/core`. Two new integration tests cover the reject and allow cases.

  Note: the same `guardedClaimFile` call in `task_plan_claim_subtask` has the same gap; that is out of scope for this patch.

- a87921e: `task_claim_file` now surfaces the task's `repo_root` in the
  `INVALID_CLAIM_PATH` rejection message so agents see the exact anchor their
  path failed to resolve against. The `outside_repo` and `unknown` branches of
  `claimPathRejectionMessage(reason, file_path, { repo_root })` switch from a
  terse "claim path is not claimable: …" to an actionable
  "… resolves outside this task's repo_root \"<root>\" …" / "… could not be
  resolved relative to this task's repo_root \"<root>\". Either retarget a task
  whose repo_root matches the path being claimed, or pass a path that resolves
  inside that anchor." So the agent can immediately tell whether to rewrite the
  path or claim a different task.

  The MCP handler in `apps/mcp-server/src/tools/task.ts` and both
  `TaskThread.claimFile` / `TaskThread.normalizeOptionalClaimPath` paths in
  `packages/core/src/task-thread.ts` thread the task's repo_root through.
  Backward compatible — the `context` arg is optional and existing callers see
  the original messages.

- 13ce3ad: Tool description diet + registration token budget guard. The six bulkiest MCP tool descriptions (attention_inbox, task_ready_for_agent, task_relay, task_hand_off, cluster_observations, task_plan_list) are rewritten to keep their trigger phrases and drop tail prose. New `tool-budget.test.ts` fails CI if the lean surface exceeds 4,200 estimated tokens, the full surface exceeds 15,000, or any description exceeds 540 chars. Also de-flakes coordination-loop's claim-preview ordering assertion.
- Updated dependencies [819660d]
- Updated dependencies [cdf22de]
- Updated dependencies [4a68470]
- Updated dependencies [782ddb6]
- Updated dependencies [b6e2ad4]
- Updated dependencies [86a3d1a]
- Updated dependencies [9e1a791]
- Updated dependencies [829556b]
- Updated dependencies [dafe17b]
- Updated dependencies [a83eeea]
- Updated dependencies [7dcece2]
- Updated dependencies [0950b42]
- Updated dependencies [0950b42]
- Updated dependencies [7aba1eb]
- Updated dependencies [950a95d]
- Updated dependencies [3b86d74]
- Updated dependencies [1d78c99]
- Updated dependencies [7770b58]
- Updated dependencies [e6c5766]
- Updated dependencies [60c3123]
- Updated dependencies [2e8fba1]
- Updated dependencies [3898ff3]
- Updated dependencies [ccd51b6]
- Updated dependencies [66fa52c]
- Updated dependencies [a87921e]
- Updated dependencies [8a15958]
- Updated dependencies [f7b490a]
- Updated dependencies [2cc5ff8]
- Updated dependencies [9a36e5e]
  - @colony/core@0.8.0
  - @colony/embedding@0.8.0
  - @colony/config@0.8.0
  - @colony/hooks@0.8.0
  - @colony/foraging@0.8.0
  - @colony/spec@0.8.0
  - @colony/queen@0.8.0

## 0.7.0

### Minor Changes

- 8e800f4: `attention_inbox` now defaults to a compact payload (`summary` +
  `observation_ids`) and accepts a new `format: "compact" | "full"` flag
  that opts back into the historical fully hydrated shape. Compact mode
  trims the response to the counts and IDs an agent actually needs to
  decide what to call next; bodies stay one `get_observations(ids)` call
  away.

  The `verbose` and `audit` flags keep their existing semantics
  (weak-expired audit-claim visibility) and are now orthogonal to
  `format` — full payload + audit, compact + audit, etc., are all valid.
  Existing `attention_inbox` callers that depended on the inbox arrays
  must pass `format: "full"`.

- d919011: Auto-archive completed Queen plans after a 60-second grace window, even
  when the plan was published with `auto_archive: false`. Previously, plans
  without explicit opt-in lingered forever after their last sub-task
  completed, leaving `queen_plan_readiness` red and forcing operators to
  run `colony plan close` by hand.

  `runAutoArchiveIfReady` now compares the latest `plan-subtask-claim`
  completion timestamp against an `AUTO_ARCHIVE_GRACE_PERIOD_MS` constant
  (60 seconds). Within the window the call still returns `skipped` with
  reason `auto_archive grace period pending`, giving the lane time to
  land a manual close or reject the archive entirely. Past the window the
  three-way merge runs and the change is moved to
  `openspec/changes/archive/<date>-<slug>` as before.

  `task_plan_list` now triggers an opportunistic sweep over completed
  plans before returning, so health/agents that read plans drive the
  archive without a daemon. Conflicts and errors continue to surface as
  `plan-archive-blocked` / `plan-archive-error` observations on the
  parent spec task instead of failing the list call.

- 528b5ba: Add `task_autopilot_tick` and `task_drift_check` MCP tools — light-weight ports of two ideas from the Ruflo autopilot/swarm playbook, mapped onto Colony primitives.

  `task_autopilot_tick` is a one-shot advisor that combines `attention_inbox` + `task_ready_for_agent` into a single decision (next tool + args + sleep hint). The loop itself stays caller-side (Claude Code's `ScheduleWakeup`, the `/loop` skill, or cron) — this MCP call is stateless. Decision priority: pending handoff → quota relay → blocking message → claim ready subtask → continue current claim → no-op. Stalled lanes whose only signal is "Session start"/"No active swarm" are classified as dead heartbeats and excluded from the actionable count, so callers don't escalate on noise.

  `task_drift_check` compares a session's claims for a given task against its recent edit-tool observations within a configurable window. Surfaces files edited without a matching claim (drift) and claims with no recent edit activity (potentially abandoned). File-scope drift only — does not analyze semantic drift from the task description.

  Both tools are pure compositions of existing storage and core helpers; no SQL migration, no new package, no edits to `packages/storage/src/storage.ts`. `@colony/core` re-exports `InboxQuotaPendingClaim` so downstream tools can build typed quota-relay payloads.

- 6bfc818: Surface a `claim_required: true` flag on `task_ready_for_agent` whenever
  the response carries a claimable plan sub-task or quota-relay handoff
  that the calling agent should follow up on with
  `task_plan_claim_subtask` (or `task_claim_quota_accept`). Loop adoption
  sat at 0% across sessions because the queue response only carried a
  hint inside `next_action`; agents that stopped reading at the result
  shape skipped the claim. The new boolean lets clients gate work
  selection on the explicit signal.

  SessionStart now appends a one-line `## Ready Queen sub-tasks` preface
  when the active repo has unclaimed plan sub-tasks, listing the count
  and reminding the agent to follow `task_ready_for_agent` with
  `task_plan_claim_subtask`. The nudge is silent when no cwd is detected,
  no real `(repo_root, branch)` resolves, or no plan has unclaimed work.

- 919cc9b: Add per-operation token instrumentation and a savings surface with three
  entry points that share one data source:

  - New `mcp_metrics` SQLite table records `(operation, ts, input_bytes,
output_bytes, input_tokens, output_tokens, duration_ms, ok)` for every
    wrapped MCP tool call. Recording is best-effort: a write failure cannot
    break a tool call. Tokens are counted via `@colony/compress#countTokens`
    so values align with observation token receipts.
  - `Storage.recordMcpMetric` and `Storage.aggregateMcpMetrics` expose the
    table; new types `NewMcpMetric`, `AggregateMcpMetricsOptions`,
    `McpMetricsAggregate`, and `McpMetricsAggregateRow` ship from
    `@colony/storage`.
  - `apps/mcp-server` composes a metrics wrapper alongside the existing
    heartbeat wrapper. Heartbeat outer (touches active session before the
    handler), metrics inner (measures handler input/output around the actual
    work).
  - New MCP tool `savings_report` returns hand-authored reference rows plus
    live per-operation usage. CLI `colony gain` renders the same data with
    optional `--hours`, `--since`, `--operation`, `--json` flags. Worker
    exposes `/savings` (HTML) and `/api/colony/savings` (JSON), reachable
    from the index page link.
  - Hand-authored reference table lives in
    `packages/core/src/savings-reference.ts` so all three surfaces stay in
    sync from one source.

### Patch Changes

- b937fb7: Cap `attention_inbox` stalled lane rows by default while preserving total
  counts and explicit expansion.
- 77c9e30: Make PreToolUse auto-claim coverage observable and surface hook-wiring problems instead of agent-discipline ones.

  - The Claude installer now scopes PreToolUse and PostToolUse to a write-tool matcher so the hook does not fire (or get blamed) for unrelated tools.
  - `colony hook run pre-tool-use` now writes its warning back through Claude Code's PreToolUse `permissionDecision: allow` so the agent sees the missing-claim warning instead of it being silently dropped on stderr.
  - The pre-tool-use warning embeds a concrete `next_call` (an exact `mcp__colony__task_claim_file({...})` invocation) and a multi-line actionable `message`, so an agent that hits ACTIVE_TASK_NOT_FOUND / AMBIGUOUS_ACTIVE_TASK / SESSION_NOT_FOUND knows exactly what to do.
  - `claimBeforeEditStats` adds a `pre_tool_use_signals` count of `claim-before-edit` telemetry rows in the window. `colony health` and `hivemind_context`'s claim-before-edit nudge use it to distinguish "hook is not firing" from "agent skipped the claim", and emit an install/restart hint in the former case.
  - `colony health` also reports explicit/manual vs auto-claim breakdown and reads "had a claim before edit" instead of "explicit claims first".

- 7d93a48: Make task_claim_file discoverable as the normal before-edit soft claim path.
- c94ed35: Three colony-health fixes:

  - `claimBeforeEditStats` now strips the managed agent-worktree prefix (`.omx/agent-worktrees/<lane>/` and `.omc/agent-worktrees/<lane>/`) when comparing edit and claim file paths. Edits recorded inside a worktree now line up with claims posted on canonical repo-relative paths, so the claim-before-edit metric stops reporting `path_mismatch` for the same logical file.
  - `task_ready_for_agent` accepts a new opt-in `auto_claim` boolean. When set, the server claims the unambiguous ready sub-task in the same call and reports the outcome as `auto_claimed` so harnesses no longer have to call `task_plan_claim_subtask` as a follow-up. Skips the auto-claim when the candidate is routed to a different agent or when no claimable work is ready.
  - The plan auto-archive sweep now reconciles plans whose change directory was already moved to `openspec/changes/archive/<date>-<slug>/` on disk: it records a `plan-archived` observation referencing the archive path instead of looping forever as completed-but-unarchived. The sweep also strips a deleted agent-worktree segment from the parent task's `repo_root` before opening `SpecRepository`, so plans whose lane was pruned still archive cleanly.

- Updated dependencies [b937fb7]
- Updated dependencies [77c9e30]
- Updated dependencies [6b09a3d]
- Updated dependencies [f769824]
- Updated dependencies [7d86bd2]
- Updated dependencies [cb4c9f9]
- Updated dependencies [43ef76a]
- Updated dependencies [46d0153]
- Updated dependencies [36e95ba]
- Updated dependencies [528b5ba]
- Updated dependencies [99b9715]
- Updated dependencies [9424987]
- Updated dependencies [6bfc818]
- Updated dependencies [a27c52c]
- Updated dependencies [2a077ed]
- Updated dependencies [08e4700]
- Updated dependencies [2ddc284]
- Updated dependencies [7d86bd2]
- Updated dependencies [fa4e1a3]
- Updated dependencies [919cc9b]
- Updated dependencies [36bd261]
  - @colony/core@0.7.0
  - @colony/hooks@0.7.0
  - @colony/config@0.7.0
  - @colony/foraging@0.7.0
  - @colony/queen@0.7.0
  - @colony/spec@0.7.0
  - @colony/embedding@0.7.0

## 0.6.0

### Minor Changes

- d6bfe31: Add `@colony/spec` — the spec-driven dev lane (colonykit-in-colony).
  Provides a `SPEC.md` grammar, `CHANGE.md` grammar, three-way sync
  engine, backprop failure-signature gate, and cite-scoped context
  resolver. Rides on `@colony/core`'s TaskThread, ProposalSystem, and
  MemoryStore — no parallel infrastructure.

  Six new MCP tools land in `apps/mcp-server/src/tools/spec.ts`:
  `spec_read`, `spec_change_open`, `spec_change_add_delta`,
  `spec_build_context`, `spec_build_record_failure`, `spec_archive`.

  Four matching Claude Code skills ship under `skills/` at the repo
  root: `/co:change`, `/co:build`, `/co:check`, `/co:archive`, plus
  supporting internals (`spec`, `sync`, `backprop`).

  Tests: `packages/spec/test/spec.test.ts` covers grammar round-trip,
  always-on invariant detection, stable hashing, cite-scope transitive
  closure, and all four sync conflict shapes. `apps/mcp-server` tool
  list updated to include the six new tools.

- af5d371: Expose foraged food sources to MCP clients through three new tools and
  wire `MemoryStore.search` with an optional kind/metadata filter so
  scoped queries don't pollute the main search.

  New MCP tools (registered alongside spec in `apps/mcp-server`):

  - `examples_list({ repo_root })` — compact list of indexed example
    names, manifest kinds, and cached observation counts.
  - `examples_query({ query, example_name?, limit? })` — BM25 hits
    scoped to `kind = 'foraged-pattern'` and optionally to a specific
    example. Returns compact snippets — fetch full bodies via
    `get_observations`.
  - `examples_integrate_plan({ repo_root, example_name, target_hint? })`
    — deterministic plan: npm dependency delta between the example and
    the target `package.json`, files to copy (derived from indexed
    entrypoints), `config_steps` (npm scripts), and an
    `uncertainty_notes` list for everything the planner couldn't
    resolve. No LLM in the loop.

  `@colony/foraging` adds `buildIntegrationPlan(storage, opts)`. The
  function reads manifests fresh from disk to avoid round-tripping
  structured JSON through the compressor.

  `@colony/core` extends `MemoryStore.search(query, limit?, embedder?, filter?)`
  with `{ kind?: string; metadata?: Record<string, string> }`. When a
  filter is set the method skips vector ranking — the embedding index has
  no kind column, so mixing vector hits would require a second pass to
  drop them. `@colony/storage`'s `searchFts(query, limit, filter?)`
  applies the filter in SQL via `json_extract` so the LIMIT still bounds
  the scan.

- cfb6338: Eight-part overhaul of the `task_message` system so directed-agent messaging
  behaves more like a real coordination channel than a one-shot inbox.

  `@colony/core`:

  - `MessageMetadata` gains `expires_at`, `retracted_at`, `retract_reason`, and
    `claimed_by_session_id` / `claimed_by_agent` / `claimed_at`. `MessageStatus`
    picks up `expired` and `retracted` terminal states. `parseMessage` backfills
    the new fields to `null` so legacy rows still pass the strict-null
    visibility predicates without a migration.
  - `TaskThread.postMessage` accepts `expires_in_ms`, auto-claims a still-
    unclaimed `to_agent='any'` broadcast on reply, and keeps reply-chain depth
    authoritative at 1-deep — only the immediate parent flips to `replied`.
  - New `TaskThread.retractMessage` (sender-only, refuses replied messages) and
    `TaskThread.claimBroadcastMessage` (idempotent for the existing claimer,
    rejects directed messages with `NOT_BROADCAST`).
  - `TaskThread.markMessageRead` writes a sibling `message_read` observation
    so the original sender's inbox can render read receipts; past-TTL reads
    flip the on-disk status to `expired` and throw `MESSAGE_EXPIRED`.
  - `pendingMessagesFor` and `listMessagesForAgent` filter retracted, expired,
    and other-agents'-claimed broadcasts. Inbox summaries surface `expires_at`,
    `is_claimable_broadcast`, and the claim state.
  - `buildAttentionInbox` adds `summary.blocked` (gates non-message lanes when
    any unread is `blocking`), `coalesced_messages` (groups by task / sender /
    urgency), and `read_receipts` (drops once the recipient replies). New
    `read_receipt_window_ms` / `read_receipt_limit` options.

  `@colony/mcp-server`:

  - `task_message` accepts `expires_in_minutes` (max 7 days).
  - New `task_message_retract` and `task_message_claim` tools.
  - `task_messages` shape now includes `expires_at`, `is_claimable_broadcast`,
    `claimed_by_session_id`, and `claimed_by_agent`.
  - Tool descriptions document the 1-deep reply contract, retract semantics,
    TTL behavior, and broadcast-claim flow.

- 7e5a430: Add opt-in `auto_archive` flag to `task_plan_publish`. When set, the parent spec change three-way-merges and archives automatically after the last sub-task completes via `task_plan_complete_subtask`. Default is `false` because silent state change after the final completion is risky if the merged spec has not been verified — opt in per plan once the lane lands cleanly. Conflicts on the three-way merge are non-fatal: the completion still returns `status: 'completed'`, the archive is skipped, and a `plan-archive-blocked` observation is recorded on the parent spec task so resolution stays explicit. Other auto-archive failures (missing `CHANGE.md`, write errors) are likewise recorded as `plan-archive-error` observations and never propagate as tool errors. The completion response now carries an `auto_archive: { status, reason?, archived_path?, merged_root_hash?, applied?, conflicts? }` field that reports the outcome on every call. New observation kinds: `plan-config` (publish-time policy on the parent spec task), `plan-archived`, `plan-archive-blocked`, `plan-archive-error`. Also fixes a latent lifecycle race in `@colony/core` `readSubtask`: when a `claimed` and `completed` `plan-subtask-claim` observation share the same millisecond timestamp (back-to-back claim then complete in tests or fast-running flows), SQLite's `ORDER BY ts DESC` had undefined tie-breaker behavior and could surface the sub-task as `claimed`. Status is now resolved with terminal-state-wins precedence (`completed > blocked > claimed`) so a completion is authoritative once it exists.
- e6c03f2: Add a plan publication lane on top of the existing task-thread + spec primitives. `task_plan_publish` writes a spec change document and opens one task thread per sub-task on `spec/<slug>/sub-N` branches, linking them via `metadata.parent_plan_slug`. Independent sub-tasks must not share file scopes; sequence overlapping work via `depends_on` (zero-based, must point at earlier indices). `task_plan_list` returns plan-level rollups with sub-task counts (`available | claimed | completed | blocked`) and a `next_available` list of unblocked, unclaimed sub-tasks; filterable by `repo_root`, `only_with_available_subtasks`, and `capability_match`. `task_plan_claim_subtask` claims an available sub-task race-safely (scan-before-stamp inside a SQLite transaction so two concurrent claims serialize through the write lock — first wins, second sees the prior claim observation and rejects with `PLAN_SUBTASK_NOT_AVAILABLE`); on success it joins the caller to the sub-task thread and activates file claims. `task_plan_complete_subtask` releases file claims and stamps a completion observation; downstream sub-tasks become available automatically. New observation kinds: `plan-subtask` (initial advertisement) and `plan-subtask-claim` (lifecycle transitions). New worker route `GET /api/colony/plans` exposes the same rollup to the read-only viewer. No schema migration; the lane composes over existing `task_thread` and `@colony/spec` primitives.
- f48269e: Add `recall_session` MCP tool. An agent passes a `target_session_id` plus its own `current_session_id`, and the tool returns a compact timeline of the target (IDs + kind + ts only — bodies still come from `get_observations(ids[])`) while writing a `kind: 'recall'` observation into the _caller's_ session as the audit trail.

  The recall observation introduces a new wire contract that other code may filter on:

  - `kind === 'recall'`
  - `metadata.recalled_session_id` — the consulted session
  - `metadata.owner_ide` — `inferIdeFromSessionId` fallback when the target's `ide` column is `unknown`, so foreign-session recalls stay traceable without re-inferring at read time
  - `metadata.observation_ids` — the timeline slice that was returned
  - `metadata.around_id` and `metadata.limit` — the request parameters that produced the slice

  Both session ids are validated via `Storage.getSession()` before any write. `MemoryStore.addObservation` routes through `ensureSession` (memory-store.ts:96), which silently materialises a missing sessions row — without these checks a typo'd `current_session_id` would create a phantom session and write a recall observation into it. Errors come back as `{ code: 'SESSION_NOT_FOUND', error }`.

  Also extends `GET /api/sessions/:id/observations` on the worker viewer with an `?around=<id>&limit=<n>` query so the same paged timeline is reachable from the HTTP surface (the route already proxied to `Storage.timeline`, which has supported `aroundId` for a while). Cross-session `?around` ids cleanly return `[]` rather than spilling into the target window, matching the SQL filter on `session_id`.

- b158138: Smoothness pack: macOS idle-sleep prevention, desktop notifier slot, and
  cross-task links.

  `@colony/process`:

  - New `notify({ level, title, body }, { provider, minLevel, log })` helper.
    `provider: 'desktop'` fans out to `osascript` on darwin / `notify-send` on
    linux; `'none'` is a no-op. Fire-and-forget: never awaits the spawned
    helper, never throws, never blocks a hot path. Spawn failures are reported
    via the optional `log` callback rather than crashing the caller.
  - Re-exports `NotifyLevel`, `NotifyMessage`, `NotifyOptions`, plus a
    `buildNotifyArgv` helper for testing.

  `@colony/config`:

  - New `notify` settings group: `provider: 'desktop' | 'none'` (default
    `'none'` so a fresh install is silent) and `minLevel: 'info' | 'warn' |
'error'` (default `'warn'`). Picked up automatically by `colony config
show` and `settingsDocs()`.

  `@colony/storage`:

  - Schema bumps to v8. New `task_links` table stores cross-task edges as one
    row per unordered pair (`low_id < high_id` enforced via CHECK), with
    `created_by`, `created_at`, and an optional `note`.
  - `Storage.linkTasks(p)` is idempotent — re-linking a pair preserves the
    original metadata. `Storage.unlinkTasks(a, b)` returns whether a row was
    removed. `Storage.linkedTasks(task_id)` returns the _other_ side of each
    edge with link metadata, regardless of which side originally linked.
  - Self-links (`task_id_a === task_id_b`) are rejected as a caller bug.
  - New types: `TaskLinkRow`, `NewTaskLink`, `LinkedTask`.

  `@colony/core`:

  - `TaskThread.linkedTasks()`, `TaskThread.link(other_task_id, created_by,
note?)`, `TaskThread.unlink(other_task_id)` — symmetric helpers around
    the storage primitives.

  `@colony/worker`:

  - New `apps/worker/src/caffeinate.ts` holds a `caffeinate -i -w <pid>`
    assertion on darwin while the embed loop is running, so a laptop lid-close
    or system idle doesn't suspend long-running embedding backfills. No-op on
    non-darwin and on missing binary; never started when the embedder failed
    to load (the worker is then just a viewer + state file writer).
  - Worker now emits a desktop notification via `@colony/process` when the
    embedder fails to load, so users see a real signal instead of a stderr
    line they may never read. Honours `settings.notify`.

  `@colony/mcp-server`:

  - New tools: `task_link(task_id, other_task_id, session_id, note?)`,
    `task_unlink(task_id, other_task_id)`, `task_links(task_id)`. Symmetric:
    callers don't need to think about ordering, and re-linking the same pair
    is idempotent.

  Inspired by patterns in agent-orchestrator (caffeinate, plugin-style
  notifier slot) and hive (worktree connections / cross-task linking).

- 49f7736: Add a direct-message primitive on task threads so agents can coordinate in prose without transferring file claims. `task_message` sends a message with explicit addressing (`to_agent: claude | codex | any`, optional `to_session_id`) and an `urgency` (`fyi | needs_reply | blocking`) that controls preface prominence. `task_messages` returns the compact inbox addressed to the caller across every task they participate in; `task_message_mark_read` flips a message to `read` idempotently. Replies (`reply_to`) flip the parent's status to `replied` atomically on the send so resolution is authoritative rather than advisory. Storage reuses the existing observation write path — no schema migration — with lifecycle fields kept in `metadata` alongside the existing `handoff` / `wake_request` primitives.
- 1fbc24e: Add `task_relay`: a coordination primitive for passing in-flight work to
  another agent when the sender is being cut off (quota, rate-limit,
  turn-cap) and can't write a thoughtful handoff. The sender provides one
  sentence; everything else — recently edited files, active claims, recent
  decisions and blockers, last baton-pass summary, search seeds — is
  synthesized from the last 30 minutes of task-thread activity at emit
  time. A `worktree_recipe` block (base branch, claims to inherit, optional
  git sha, untracked-file warning) lets a receiver in a different worktree
  set up an equivalent tree before editing.

  Difference from `task_hand_off`: relays assume the sender is gone, so
  their claims are _dropped_ at emit time and re-claimed by the receiver
  on accept (mirrors the `transferred_files` invariant — no third agent
  can grab a file in the gap). The `expires_at` window is shorter (4h
  default vs. 2h for handoffs but stricter ceiling — work the relay
  describes goes stale fast).

  Core (`@colony/core`):

  - `TaskThread.relay()` / `acceptRelay()` / `declineRelay()` /
    `pendingRelaysFor()` parallel the handoff/wake/message primitives
    with their own typed metadata, error codes (`NOT_RELAY`,
    `RELAY_EXPIRED`), and content rendering.
  - New exports: `RelayMetadata`, `RelayObservation`, `RelayArgs`,
    `RelayStatus`, `RelayTarget`, `RelayReason`. Existing
    `CoordinationKind` union extended with `'relay'`.
  - Heterogeneous-metadata-safe synthesis of `last_handoff_summary`:
    branches on observation kind so `summary` (handoffs) and `one_line`
    (relays) both feed the field correctly when the most recent
    baton-pass is one or the other.

  MCP (`@colony/mcp-server`):

  - Three new tools: `task_relay`, `task_accept_relay`,
    `task_decline_relay`. Registered next to `task_message` so
    coordination primitives stay contiguous.

- 754949f: Add wake-request primitive and attention inbox for idle/stalled cross-agent nudges.

  - `task_wake` / `task_ack_wake` / `task_cancel_wake` MCP tools post lightweight nudges on a task thread — no claim transfer, no baton pass. Targets see the request on their next SessionStart or UserPromptSubmit turn with a copy-paste-ready ack call.
  - `attention_inbox` MCP tool + `colony inbox` CLI command aggregate pending handoffs, pending wakes, stalled lanes from the hivemind snapshot, and recent other-session file claims into one compact view. Bodies are not expanded; fetch via `get_observations`.
  - Hook injection extended: `buildTaskPreface` surfaces pending wake requests alongside pending handoffs; `buildTaskUpdatesPreface` inlines an ack call for wake requests that arrive between turns.

  Deferred follow-ups (not in this change): safe session takeover, claim TTL renewal, session Stop checkpoint, and any terminal-control wake mechanism.

### Patch Changes

- 2217a68: Remove the unused wake MCP tools from the live server surface and make `task_message` match `task_post` ergonomics: callers can now send a broadcast with only `task_id`, `session_id`, `agent`, and `content`, while directed-message knobs remain optional.
- 185a9d9: Extract shared `isMainEntry`, pidfile helpers, `isAlive`, and the
  `spawn(process.execPath, …)` wrapper into a new `@colony/process`
  package. These utilities had divergent copies in four places
  (`apps/cli/src/commands/lifecycle.ts`, `apps/cli/src/commands/worker.ts`,
  `apps/mcp-server/src/server.ts`, `apps/worker/src/server.ts`, and
  `packages/hooks/src/auto-spawn.ts`). The regex that decides whether
  Node should be invoked via `execPath` — the Windows EFTYPE guard —
  and the realpath-normalized bin-shim check both now live exactly once.

  No behavior change. Internal helper refactor only.

- 5c17c92: Split `apps/mcp-server/src/server.ts` into eight per-tool-group modules
  under `src/tools/` (search, hivemind, task, handoff, proposal, profile,
  wake, plus shared/context/heartbeat helpers). `buildServer()` is now a
  small registration list that calls `register(server, ctx)` on each
  group in the same order the tools appeared in the pre-split file.
  Behavior is unchanged — all 17 mcp-server tests (InMemory MCP client
  hitting every tool + task-thread suites) pass without modification.
- 18412d3: Document the task relay fallback on the MCP tools that remain visible when a
  client does not expose `task_relay`. `task_post` now tells agents what relay
  context to record, `task_hand_off` explains how to resume from a base branch
  instead of a missing source lane, and `colony debrief` names `task_relay` as a
  coordination commit example.
- d710353: Close two test gaps that were quiet failure modes.

  **`task_relay` MCP-level lifecycle tests** (`apps/mcp-server/test/task-threads.test.ts`):
  the relay primitive shipped without integration coverage in the MCP
  test suite — only core-level unit tests existed. Added four lifecycle
  tests round-tripped through the MCP client transport that pin the
  contract reviewers actually care about: claims-drop-at-emit, receiver
  re-claim on accept, decline-cancels-and-blocks-future-accept, directed
  relay refuses non-target agents, expired relay flips status to
  `expired` instead of staying `pending`. Without these tests an
  internal storage/metadata change could silently break the receiver's
  re-claim path or leave expired relays advertising themselves as live.

  **`renderFrame` snapshot test** (`apps/cli/test/observe.test.ts`):
  the `colony observe` dashboard's unclaimed-edits footer is the
  load-bearing diagnostic for whether proactive claiming is happening,
  but the renderer wasn't under test — a metadata field rename or a
  `safeJson` typo would have surfaced as nonsense on the dashboard, the
  worst way to find out. `renderFrame` is now exported and a Vitest
  suite seeds a deterministic fixture (frozen clock, kleur disabled),
  calls the renderer, and asserts on the structural anchors that would
  break under those regressions: task header, participants, claims,
  pending handoffs (`from_agent → to_agent: summary`), and the
  unclaimed-edits footer in both populated and zero-state forms.

- Recover stranded session ownership by exposing rescue diagnostics through MCP and by letting the worker prepare relays for sessions whose owning agent vanished.
- Rewrite Colony MCP tool descriptions so intent-based searches prefer the active coordination primitives and make the fallback guidance discoverable from the server surface.
- 82251e7: Remove the dead `task_wake`, `task_ack_wake`, and `task_cancel_wake` MCP surface after `ScheduleWakeup` won the coordination fight. The wake storage substrate stays in place so a future `ScheduleWakeup` interception can still reuse `wake_request` observations.
- Updated dependencies [d6bfe31]
- Updated dependencies [e9e5587]
- Updated dependencies [1b076d8]
- Updated dependencies [185a9d9]
- Updated dependencies [f8f1bcc]
- Updated dependencies [90bc096]
- Updated dependencies [af5d371]
- Updated dependencies [beaf0f4]
- Updated dependencies [ed5a0b0]
- Updated dependencies [c027e5d]
- Updated dependencies [cfb6338]
- Updated dependencies [7e5a430]
- Updated dependencies [e6c03f2]
- Updated dependencies [9e559a4]
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [b158138]
- Updated dependencies [2aec9a9]
- Updated dependencies [49f7736]
- Updated dependencies [1fbc24e]
- Updated dependencies [754949f]
  - @colony/spec@0.6.0
  - @colony/core@0.6.0
  - @colony/hooks@0.6.0
  - @colony/foraging@0.6.0
  - @colony/config@0.6.0
  - @colony/process@0.6.0
  - @colony/embedding@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies
  - @colony/compress@0.5.0
  - @colony/config@0.5.0
  - @colony/core@0.5.0
  - @colony/embedding@0.5.0
  - @colony/hooks@0.5.0

## 0.4.0

### Minor Changes

- Register the MCP caller in hivemind on startup and on every tool call. When a
  client (e.g. codex) attaches to the colony stdio server without ever running
  colony's lifecycle hooks, the server now writes / refreshes
  `.omx/state/active-sessions/<session_id>.json` using the caller's cwd plus a
  session id derived from `CODEX_SESSION_ID`, `CLAUDECODE_SESSION_ID`,
  `CLAUDE_SESSION_ID`, `COLONY_CLIENT_SESSION_ID`, or a per-parent-process
  fallback. Existing hook-written heartbeats are preserved — the writer never
  overwrites a richer task preview with a blank one.

  Exposes `upsertActiveSession` / `removeActiveSession` from `@colony/hooks` so
  other non-hook runtimes can reuse the same writer.

### Patch Changes

- Updated dependencies
  - @colony/hooks@0.4.0

## 0.3.0

### Minor Changes

- f853481: Add a compact `hivemind` MCP tool that maps active proxy-runtime agent sessions to their current tasks.
- 4076133: Add proposal system: pre-tasks that auto-promote via collective reinforcement. Agents call `task_propose` to surface a candidate improvement; other agents call `task_reinforce` (kind `explicit` or `rediscovered`), and PostToolUse adds weak `adjacent` reinforcement whenever an edit touches a file listed in a pending proposal's `touches_files`. Total decayed strength (1-hour half-life, weights 1.0 / 0.7 / 0.3 by kind) is recomputed on every read; when it crosses `PROMOTION_THRESHOLD` (2.5), the proposal is auto-promoted to a real `TaskThread` on a synthetic branch `{branch}/proposal-{id}`. The new `task_foraging_report` MCP tool lists pending (above the 0.3 noise floor) and promoted proposals; `SessionStart` surfaces the same report in-preface. Schema bumped 4 → 5: adds `proposals` and `proposal_reinforcements`.
- 42dd222: Add response-threshold routing for broadcast (`to_agent: 'any'`) handoffs. Each agent identity (Claude, Codex, …) can register a capability profile (`ui_work`, `api_work`, `test_work`, `infra_work`, `doc_work`, each `0..1`) via the new `agent_upsert_profile` MCP tool; unknown agents default to `0.5` across all dimensions. When `TaskThread.handOff` runs with `to_agent: 'any'`, it snapshots a keyword-weighted ranking of every non-sender participant into `HandoffMetadata.suggested_candidates`. `SessionStart` preface surfaces the top match and the viewing agent's own score inline with each pending broadcast handoff, so receivers can see at a glance whether they are the best fit. New `agent_get_profile` MCP tool exposes read-only inspection. Schema bumped 5 → 6: adds `agent_profiles` table.

### Patch Changes

- Fix `colony mcp` never starting the stdio server.

  `apps/mcp-server/src/server.ts` gated `main()` behind an `isMainEntry()` check
  so it only ran when executed directly. The CLI `mcp` command invoked it via
  `await import('@colony/mcp-server')`, which triggered the guard (entry was
  the CLI binary, not `server.js`) and skipped `main()` — the process exited
  immediately after the dynamic import, causing IDE clients (Codex, Claude
  Code) to fail the MCP handshake with "connection closed: initialize
  response".

  `main` is now exported from the server module and invoked explicitly by the
  CLI command.

- Updated dependencies [eb4dad9]
- Updated dependencies [5f37e75]
- Updated dependencies [4076133]
- Updated dependencies [42dd222]
  - @colony/compress@0.3.0
  - @colony/config@0.3.0
  - @colony/core@0.3.0
  - @colony/embedding@0.3.0

## 0.2.0

### Minor Changes

- 416957b: Wire embeddings end-to-end and make lifecycle obvious.

  **Embeddings (previously dead code) now work out of the box**

  - New `@colony/embedding` package exports `createEmbedder(settings)` with three providers: `local` (Transformers.js, default — `Xenova/all-MiniLM-L6-v2`, 384 dim), `ollama`, and `openai`. `@xenova/transformers` is an optional dependency: installs automatically with `npm install -g cavemem` on supported platforms, falls back gracefully otherwise.
  - The worker now runs an embedding backfill loop: polls `observationsMissingEmbeddings`, embeds the expanded (human-readable) text, persists. On startup it drops rows whose model differs from settings so switching providers never pollutes cosine ranking.
  - Storage gains a model/dim filter on `allEmbeddings()` plus `dropEmbeddingsWhereModelNot`, `countObservations`, `countEmbeddings`, and a model-scoped variant of `observationsMissingEmbeddings`.
  - The `Embedder` interface in `@colony/core` now exposes `model` and `dim` so the store can reject mismatched rows before cosine computation.
  - Both the CLI `search` command and the MCP `search` tool instantiate the embedder lazily and pass it into `MemoryStore.search`. Semantic search is on by default; `cavemem search --no-semantic` bypasses it.
  - Worker writes a `worker.state.json` snapshot after every batch so `cavemem status` can show "embedded 124 / 200 (62%)" without hitting HTTP.

  **Lifecycle (previously unclear) is now ergonomic**

  - Hooks auto-spawn the worker detached + pidfile-guarded when it is not running (fast path < 2 ms; full `stat` + `process.kill(pid, 0)` probe). Respects `CAVEMEM_NO_AUTOSTART` for deterministic tests. Skipped when `embedding.autoStart=false` or `provider=none`.
  - Worker idle-exits after `embedding.idleShutdownMs` (default 10 min) of no embed work and no viewer traffic. No launchd/systemd integration needed.
  - New top-level `cavemem start`, `cavemem stop`, `cavemem restart`, and `cavemem viewer` commands — thin wrappers around the existing pidfile-managing implementation.

  **Config UX**

  - New `cavemem status` top-level command: single-pane dashboard showing settings path, data dir, DB counts, installed IDEs, embedding provider/model, backfill progress, worker pid and uptime.
  - New `cavemem config show|get|set|open|path|reset` command backed by zod `.describe()` — the schema is self-documenting; no parallel docs to maintain.
  - New `settingsDocs()` export from `@colony/config` returns `[{path, type, default, description}]` for every field.
  - `cavemem install` now prints a multi-line "what to try next" block explaining that there is no daemon to start, and surfaces the embedding model + weight-download cost.
  - Settings schema gains `embedding.batchSize`, `embedding.autoStart`, and `embedding.idleShutdownMs` — every field now has a `.describe(...)` string.

  **MCP server**

  - Lazy-singleton embedder resolution — MCP handshake stays fast; model loads on first `search` tool call.
  - New `list_sessions` tool.

  **Non-negotiable rule update**

  - CLAUDE.md now documents the "no daemon on the write path" invariant: hooks may detach-spawn the worker but must never wait on it; observations write synchronously.

### Patch Changes

- Updated dependencies [416957b]
- Updated dependencies [4af0d0d]
  - @colony/config@0.2.0
  - @colony/core@0.2.0
  - @colony/embedding@0.2.0
  - @colony/compress@0.2.0
