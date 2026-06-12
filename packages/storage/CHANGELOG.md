# @colony/storage

## 0.8.0

### Minor Changes

- 8f33724: Add `account_claims` table and three new MCP tools for binding Codex accounts to planner waves.

  `task_claim_account`, `task_release_account_claim`, and `task_list_account_claims` let the recodee planner Account Capacity rail bind a Codex account to a planner wave so multiple operators on the same plan see the same dispatch state. Bindings are keyed by `(plan_slug, wave_id)` — a planner-logical coordinate that exists before any Colony task is spawned — and persist across operators via a new `account_claims` SQLite table. A partial unique index enforces at-most-one-active claim per wave; released claims stay as audit history.

  Schema migrates forward-only from version 10 to 11. No data backfill is required: the table starts empty and is populated by user action. The contract is regression-tested via an MCP-inspector test (`apps/mcp-server/test/account-claims.test.ts`) exercising the full claim → rebind → release → list lifecycle.

- edc318f: `colony gain --summary` now renders an rtk-style compact view over the same
  `mcp_metrics` receipts: headline KPI stack (total calls, input/output/total
  tokens, tokens saved, total exec time), efficiency meter, top-N **By
  Operation** table with proportional impact bars, a 30-day **Daily Activity**
  bar graph, and a 12-day **Daily Breakdown** table. `--graph` and `--daily`
  narrow the output to a single section; `--days <n>` and `--top-ops <n>` tune
  the window and table size. Per-operation saved-token credit is distributed
  across each comparison row's `matched_operations` proportionally to call share
  so the `Saved` column lines up with the headline total.

  Storage gains `Storage.aggregateMcpMetricsDaily({ since, until, operation })`
  returning per-UTC-day rollups (`{ day, calls, input_tokens, output_tokens,
total_tokens, total_duration_ms }`) ordered newest-first. Type exports
  `AggregateMcpMetricsDailyOptions` and `McpMetricsDailyRow` come along.

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

- 53836ff: `colony health --coach` walks a repo through first-week setup. It detects
  adoption stage (`fresh` / `installed_no_signal` / `early` / `mid_adoption`)
  from cheap signals (`countObservations`, installed-IDE flags,
  `firstObservationTs`, `Math.max(toolCallsSince, countMcpMetricsSince)`),
  then surfaces the NEXT incomplete step from a fixed 7-step ladder:
  `install_runtime` → `first_task_post` → `first_task_claim_file` →
  `first_task_hand_off` → `first_plan_claim` → `first_quota_release` →
  `first_gain_review`. Each step carries an exact `cmd:` and `tool:` string.

  Progress is persisted in a new `coach_progress` SQLite table (migration
  `014-coach-progress.ts`, schema_version 13 → 14). Step completion is
  event-observed via `mcp_metrics` / `observations`, never user-clicked.
  `colony gain` records a `coach_gain_review` observation so step 7 can
  self-detect. `--coach` is mutually exclusive with `--fix-plan` and respects
  `--json`.

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

- 71ee50d: Add `task_run_attempts` table + repository helpers (Symphony §4.1.5 / §7.2 — run-attempt lifecycle). New exports: `createRunAttempt`, `getRunAttempt`, `listRunAttemptsByTask`, `updateRunAttemptStatus`, `recordRunAttemptEvent`, `finishRunAttempt`, `RunAttemptError`, plus types `TaskRunAttemptRow`, `NewTaskRunAttempt`, `TaskRunAttemptEventUpdate`, `TaskRunAttemptFinish`, `RunAttemptStatus`, `RunAttemptTerminalStatus` and constants `RUN_ATTEMPT_ACTIVE_STATUSES` / `RUN_ATTEMPT_TERMINAL_STATUSES`. Foundation for Symphony Wave 3 MCP tools (Agents 209/210/211).

### Patch Changes

- 4a68470: Fix read-then-write race in claim cleanup paths

  `releaseExpiredQuotaClaims` and `bulkRescueStrandedSessions` previously read
  eligible claims outside their DEFERRED transaction, allowing two concurrent
  callers to both snapshot the same rows and each emit a duplicate
  `claim-weakened` or `rescue-stranded` audit observation.

  The fix moves the claim read inside a `BEGIN IMMEDIATE` transaction on both
  paths so the write lock is acquired before any row is inspected. The storage
  `transaction()` helper gains an `{ immediate: true }` option that maps to
  better-sqlite3's `.immediate()` mode. A new idempotency test confirms that
  calling each cleanup path twice produces exactly one audit observation.

- 8917c73: Fix two `colony health` scoring bugs that surfaced as "bad" readiness areas with no real defect:

  - **`colony_mcp_share.mcp_tool_calls = 0` despite live MCP traffic.** The counter only read `tool_calls` rows, missing MCP traffic when the calling agent's PostToolUse hook didn't fire for `mcp__*` tools. The counter now takes the max of that observed count and `mcp_metrics` row count (colony MCP server's own per-call receipt), with the source surfaced in `source_breakdown.colony_mcp_metrics`. New storage helper `countMcpMetricsSince(since, until?)`.
  - **`claim_before_edit_ratio = null` when any edits lacked file_path metadata.** Forcing the ratio to null whenever `edit_tool_calls !== edits_with_file_path` turned a real 200/363 = 55% signal into a bare `n/a` headline. The ratio is now computed over measurable edits whenever `edits_with_file_path > 0`; the `status` field still communicates partial measurability for downstream consumers.

- e52cd83: Fix `aggregateMcpMetrics` error_reasons grouping so per-row counts sum to
  `error_count`. The grouping previously partitioned by `(operation, error_code,
error_message)`, but several handlers embed unique session IDs in their error
  messages (e.g. `sub-task is claimed by codex-session-XYZ`), so each race loss
  produced a distinct group. Combined with a 3-row truncation per operation, the
  result was that nearly all errors were hidden — `task_plan_claim_subtask` would
  report 7 errors in the Top error reasons table while the Operations table showed
  93 for the same row. Grouping now drops `error_message` from the key (SQLite
  picks the row with the latest `ts` for the sample message via its bare-column-
  with-MAX optimization) and the per-operation cap is bumped from 3 to 8 since
  codes are low-cardinality. Sum-of-reasons now matches error_count exactly.
- 60c3123: Changed the embedding backfill loop to send one batch of texts to embedders that support `embedBatch`, default worker batches to 32 observations, and persist each batch in a single SQLite transaction. The codex-gpu provider now calls `/embed/batch`, while storage copies returned embedding buffers so vector reads do not alias SQLite row memory.
- 3898ff3: Stop scanning the full task table on every PreToolUse tool call

  `protectedLiveClaimConflict` in the PreToolUse hook used `listTasks(1_000_000)` to find conflicting protected-branch claims and then linearly filtered the result by `repo_root` and `isProtectedBranch(branch)`. With the task table growing into the thousands across all agents, that scan dominated p95 latency on every editor tool call and violated the <150ms hook-handler budget.

  `@colony/storage` now exposes `listProtectedBranchTasksByRepo(repoRoot)`, a single index-backed query against the existing `UNIQUE(repo_root, branch)` constraint. The PreToolUse hook calls this in place of the unbounded scan; defensive `resolve()` and `isProtectedBranch()` checks remain inside the loop so storage path inconsistencies still get filtered out. No new migration is needed — the unique index already covers the new query shape.

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

- Updated dependencies [b6e2ad4]
- Updated dependencies [86a3d1a]
- Updated dependencies [7aba1eb]
- Updated dependencies [3b86d74]
- Updated dependencies [7770b58]
- Updated dependencies [60c3123]
- Updated dependencies [8a15958]
  - @colony/config@0.8.0

## 0.7.0

### Minor Changes

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

- 77c9e30: Make PreToolUse auto-claim coverage observable and surface hook-wiring problems instead of agent-discipline ones.

  - The Claude installer now scopes PreToolUse and PostToolUse to a write-tool matcher so the hook does not fire (or get blamed) for unrelated tools.
  - `colony hook run pre-tool-use` now writes its warning back through Claude Code's PreToolUse `permissionDecision: allow` so the agent sees the missing-claim warning instead of it being silently dropped on stderr.
  - The pre-tool-use warning embeds a concrete `next_call` (an exact `mcp__colony__task_claim_file({...})` invocation) and a multi-line actionable `message`, so an agent that hits ACTIVE_TASK_NOT_FOUND / AMBIGUOUS_ACTIVE_TASK / SESSION_NOT_FOUND knows exactly what to do.
  - `claimBeforeEditStats` adds a `pre_tool_use_signals` count of `claim-before-edit` telemetry rows in the window. `colony health` and `hivemind_context`'s claim-before-edit nudge use it to distinguish "hook is not firing" from "agent skipped the claim", and emit an install/restart hint in the former case.
  - `colony health` also reports explicit/manual vs auto-claim breakdown and reads "had a claim before edit" instead of "explicit claims first".

- c94ed35: Three colony-health fixes:

  - `claimBeforeEditStats` now strips the managed agent-worktree prefix (`.omx/agent-worktrees/<lane>/` and `.omc/agent-worktrees/<lane>/`) when comparing edit and claim file paths. Edits recorded inside a worktree now line up with claims posted on canonical repo-relative paths, so the claim-before-edit metric stops reporting `path_mismatch` for the same logical file.
  - `task_ready_for_agent` accepts a new opt-in `auto_claim` boolean. When set, the server claims the unambiguous ready sub-task in the same call and reports the outcome as `auto_claimed` so harnesses no longer have to call `task_plan_claim_subtask` as a follow-up. Skips the auto-claim when the candidate is routed to a different agent or when no claimable work is ready.
  - The plan auto-archive sweep now reconciles plans whose change directory was already moved to `openspec/changes/archive/<date>-<slug>/` on disk: it records a `plan-archived` observation referencing the archive path instead of looping forever as completed-but-unarchived. The sweep also strips a deleted agent-worktree segment from the parent task's `repo_root` before opening `SpecRepository`, so plans whose lane was pruned still archive cleanly.

- 211c646: `claimBeforeEditStats` now surfaces the _triggering_ claim in
  `nearest_claim_examples` instead of the closest-by-rank match. Previously a
  `path_mismatch` bucket could report a same-file claim that was 4+ days old
  (outside the 5-minute window) with `same_file_path: true`,
  `claim_before_edit: true`, contradicting the bucket label. The example now
  carries the in-window same-lane claim that actually triggered the
  `path_mismatch` (different file, recent timestamp). The same correction
  applies to `claim_after_edit` and the prior-same-file `*_mismatch` buckets;
  `pre_tool_use_missing` and `no_claim_for_file` keep the existing
  nearest-by-rank fallback.
- 2d84352: `colony queen archive` now resolves the plan by branch directly via
  `findTaskByBranch` instead of routing through `queenPlans()`. The queen
  listing only surfaces plans with a `queen` participant, so orphan plans
  published by codex/claude lanes (auto-plan-builder, ad-hoc spec lanes)
  were rejected with `queen plan not found` even though their parent
  task and sub-task rows existed in the DB. Add a public
  `countClaimedQueenPlanSubtasks` helper so the CLI can keep its
  `--force` safety check without reaching into the private `Storage.db`
  handle.
- 127fdf3: Add `colony queen archive <slug>` to dismiss orphan queen plans whose
  openspec change directory was never published. The existing `colony plan
close` and `mcp__colony__spec_archive` paths require a `CHANGE.md` and
  cannot reach DB-only plans (e.g. duplicate auto-plans), so health stayed
  red even after the work was abandoned. The new verb sets `status =
'archived'` on the parent task plus every `spec/<slug>/sub-N` row in one
  transaction, records a `plan-archived` observation, and refuses to run
  with claimed sub-tasks unless `--force` is set. Idempotent: re-running
  on an already-archived plan reports zero rows updated.
- 610d5c8: Wave 1 storage self-heal helpers — additive only:

  - `Storage.sweepStaleClaims({ stale_after_ms, now?, limit? })` bulk-demotes `state='active'` claims older than the cutoff to `state='weak_expired'` and returns the demoted rows. The attention_inbox already surfaces stale claims as a cleanup signal, but until something actually demotes them they keep blocking other agents who treat any 'active' row as live ownership. Pure data update; callers emit `claim-weakened` observations themselves if they want the demotion to surface in timelines.
  - `Storage.findCompletedQueenPlans(repo_root?)` returns queen-plan candidates whose every `spec/<slug>/sub-N` row has its latest `plan-subtask-claim` observation in `metadata.status='completed'` and whose parent `spec/<slug>` row isn't archived. The MCP plan tool's read-path sweep only fires for plans with `auto_archive=true`; this scan exposes the same candidate set so non-MCP callers (CLI, periodic sweep, autopilot) can archive them via `archiveQueenPlan` without the per-plan opt-in.
  - `isProtectedBranch(branch)` and the exported `PROTECTED_BRANCH_NAMES` set codify the worktree-discipline rule that protected base branches (`main`, `master`, `dev`, `develop`, `production`, `release`) should never carry agent file claims directly. Hooks, MCP, and CLI can share one definition instead of drifting copies.

- Updated dependencies [f769824]
- Updated dependencies [43ef76a]
- Updated dependencies [2a077ed]
  - @colony/config@0.7.0

## 0.6.0

### Minor Changes

- 90bc096: Add the foraging indexer and a storage-aware `scanExamples` wrapper.

  `indexFoodSource(food, store, opts)` converts a discovered `FoodSource`
  into 1–N `foraged-pattern` observations (manifest, README,
  entrypoints, filetree), scrubs env-assignment secrets through
  `redact`, and persists via `MemoryStore` so compression and the
  `<private>` tag stripper both run on the write path.

  `scanExamples({ repo_root, store, session_id, limits?, extra_secret_env_names? })`
  walks `<repo_root>/examples/*`, compares each discovered source's
  `content_hash` against `storage.getExample(...)`, and only re-indexes
  when the hash has shifted. Before re-indexing it calls the new
  `Storage.deleteForagedObservations(repo_root, example_name)` so the
  observation set never duplicates across scans.

  Two helpers on `Storage` to let the indexer (and the forthcoming MCP
  tool) work without opening the DB themselves:

  - `deleteForagedObservations(repo_root, example_name): number`
  - `listForagedObservations(repo_root, example_name): ObservationRow[]`

  New `settings.foraging` block (defaults: enabled, `maxDepth: 2`,
  `maxFileBytes: 200_000`, `maxFilesPerSource: 50`,
  `scanOnSessionStart: true`, `extraSecretEnvNames: []`). `colony config
show` and `settingsDocs()` pick it up automatically.

  No MCP tools, CLI commands, or hook wiring yet — those arrive in the
  next PR.

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

- beaf0f4: Add an `examples` table and `upsertExample` / `getExample` / `listExamples` /
  `deleteExample` methods to support the forthcoming `@colony/foraging`
  package. Each row caches the content hash and observation count for a
  `<repo_root>/examples/<name>` food source so repeat scans on
  `SessionStart` can skip unchanged directories without touching the
  observation table. Schema version bumped 6 → 7.
- 2f371d4: Add `Storage.rebuildFts()` so the CLI `reindex` command no longer
  reaches through the type system to poke `better-sqlite3`. Behavior is
  unchanged — `reindex` still runs the FTS5 `'rebuild'` statement — but
  the public API is now typed and callers do not cast through `unknown`.
- 2aec9a9: Add task-level embeddings — a per-task vector representing the task's
  "meaning" in the same embedding space the observations live in. This is
  the foundation sub-system for the predictive-suggestions layer
  (`task_suggest_approach`) and includes the core similarity scan used by
  later surface tools.

  `@colony/storage`:

  - New `task_embeddings` table (schema version 10). One row per task with
    `(task_id, model, dim, embedding, observation_count, computed_at)`.
    `observation_count` is the cache invalidation key — recomputation
    triggers when the actual count drifts more than 20% from the cached
    value.
  - New methods: `upsertTaskEmbedding(p)`, `getTaskEmbedding(task_id)`,
    `countTaskObservations(task_id)`, `hasEmbedding(observation_id, model?)`.
    All four are used by the core embedding-compute path; none are
    exposed to MCP yet.
  - `getTaskEmbedding`, `upsertTaskEmbedding`, and
    `countTaskObservations` use cached prepared statements for the
    similarity scan hot path.

  `@colony/core`:

  - New module `task-embeddings.ts` exporting `computeTaskEmbedding(store,
task_id, embedder)` and `getOrComputeTaskEmbedding(store, task_id,
embedder)`. The compute function is a kind-weighted centroid of the
    task's observation embeddings — handoffs and decisions count 2×, claims
    and messages 1×, tool-use 0.25× — normalized to unit length so cosine
    similarity reduces to a dot product.
  - Returns null when fewer than `MIN_EMBEDDED_OBSERVATIONS` (5) embeddings
    exist for the task. The honesty discipline: sparse data must produce
    honest no-results rather than invented vectors.
  - Cache invalidation triggers on observation-count drift > 20% OR model
    mismatch. `KIND_WEIGHTS`, `MIN_EMBEDDED_OBSERVATIONS`, and
    `CACHE_DRIFT_TOLERANCE` are all exported so the suggestion layer can
    reference them as the load-bearing constants they are.
  - New `findSimilarTasks(store, embedder, query_embedding, options)` scans
    up to 10,000 tasks, computes or reuses task embeddings, filters by repo,
    exclusions, and minimum cosine similarity, then returns top-N task
    summaries sorted by similarity.

### Patch Changes

- Remove stale `task_ack_wake` from coordination tool classification now that wake MCP tools are retired; pending wake observations remain visible while write/read ratios route agents to `task_message` / `task_post`.
- 5c9fa69: Add a `colony backfill ide` command that heals session rows whose stored `ide` is `'unknown'` by re-running the shared `inferIdeFromSessionId` helper against the row's session id. This is intended as a one-shot clean-up for databases populated before the hook-side inference learned to handle hyphen-delimited (`codex-...`) and Guardex-branch (`agent/<name>/...`) session ids. The underlying `Storage.backfillUnknownIde(mapper)` is idempotent, returns `{ scanned, updated }`, and skips any row the mapper cannot classify so it never invents an owner.
- 77b4e06: Add `Storage.toolInvocationDistribution(since_ts, limit?)` and surface it as Section 5 of `colony debrief` (the timeline becomes Section 6). Each `tool_use` observation already carries the tool name in `metadata.tool`, so this is a pure read-side aggregation — no new write path or worker state file. The output lists every tool that fired in the window with call count and percent share, sorted descending; `mcp__*` tools are tinted cyan so MCP-vs-builtin signal stands out at a glance. The point is empirical: if `mcp__colony__task_post` fires once and `mcp__colony__task_propose` fires zero times in a week, that's a real signal about which mechanism is doing the work.
- Updated dependencies [90bc096]
- Updated dependencies [b158138]
  - @colony/config@0.6.0

## 0.5.0

### Minor Changes

- Sync linked release with the 0.4.0 MCP heartbeat bump so `@imdeadpool/colony`
  and the supporting `@colony/*` workspace packages publish together.

### Patch Changes

- Updated dependencies
  - @colony/config@0.5.0

## 0.3.0

### Minor Changes

- 5f37e75: Add pheromone trails: ambient decaying activity signal per (task, file, session). `PostToolUse` deposits pheromone on every write-tool invocation; strength decays exponentially (10-minute half-life, cap 10.0). The new `UserPromptSubmit` preface warns when another session has a strong trail on a file the current session has also touched, complementing the existing claim-based preface with a graded intensity signal that doesn't fire for stale collisions. Schema bumped to version 4 — adds `pheromones` table with FK cascade on sessions and tasks.
- 4076133: Add proposal system: pre-tasks that auto-promote via collective reinforcement. Agents call `task_propose` to surface a candidate improvement; other agents call `task_reinforce` (kind `explicit` or `rediscovered`), and PostToolUse adds weak `adjacent` reinforcement whenever an edit touches a file listed in a pending proposal's `touches_files`. Total decayed strength (1-hour half-life, weights 1.0 / 0.7 / 0.3 by kind) is recomputed on every read; when it crosses `PROMOTION_THRESHOLD` (2.5), the proposal is auto-promoted to a real `TaskThread` on a synthetic branch `{branch}/proposal-{id}`. The new `task_foraging_report` MCP tool lists pending (above the 0.3 noise floor) and promoted proposals; `SessionStart` surfaces the same report in-preface. Schema bumped 4 → 5: adds `proposals` and `proposal_reinforcements`.
- 42dd222: Add response-threshold routing for broadcast (`to_agent: 'any'`) handoffs. Each agent identity (Claude, Codex, …) can register a capability profile (`ui_work`, `api_work`, `test_work`, `infra_work`, `doc_work`, each `0..1`) via the new `agent_upsert_profile` MCP tool; unknown agents default to `0.5` across all dimensions. When `TaskThread.handOff` runs with `to_agent: 'any'`, it snapshots a keyword-weighted ranking of every non-sender participant into `HandoffMetadata.suggested_candidates`. `SessionStart` preface surfaces the top match and the viewing agent's own score inline with each pending broadcast handoff, so receivers can see at a glance whether they are the best fit. New `agent_get_profile` MCP tool exposes read-only inspection. Schema bumped 5 → 6: adds `agent_profiles` table.

### Patch Changes

- eb4dad9: Rename the public CLI package and workspace package/import namespace from cavemem to Colony. The CLI binary is now `colony`, workspace imports use `@colony/*`, release scripts pack `colony`, and installed hook scripts call `colony`.
- f1d036a: Bind hook-created sessions back to their repository cwd so colony views can see live Codex/Claude work instead of orphan `cwd: null` sessions.
- Updated dependencies [eb4dad9]
  - @colony/config@0.3.0

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

- 99ca440: Fix the Claude Code hook integration end-to-end and harden the npm publish path. With these changes the memory system actually works after `npm install -g cavemem` — verified by the new `scripts/e2e-publish.sh` test that packs the artifact, installs it into an isolated prefix, and drives every hook event with realistic Claude Code payloads.

  **Hook protocol**

  - Handlers now read the field names Claude Code actually sends — `tool_name`, `tool_response`, `last_assistant_message`, `source`, `reason` — while keeping the legacy aliases (`tool`, `tool_output`, `turn_summary`) for non-Claude IDEs and existing tests.
  - The CLI no longer dumps internal telemetry JSON onto stdout. That JSON was being injected verbatim into the agent's context as `additionalContext` for `SessionStart` / `UserPromptSubmit`. Telemetry now goes to stderr; stdout carries Claude Code's `{ "hookSpecificOutput": { "hookEventName": "...", "additionalContext": "..." } }` shape only when there is real context to surface.
  - `Storage.createSession` is now `INSERT OR IGNORE`, and `SessionStart` skips the prior-session preface for non-startup sources, so resume / clear / compact no longer crash with PK conflicts.
  - The Claude Code installer writes `cavemem hook run <name> --ide claude-code`, and the CLI's `hook run` accepts `--ide` so handlers know who invoked them (Claude Code itself never sends an `ide` field).

  **Publishable artifact**

  - `cavemem` no longer lists the private `@colony/mcp-server` and `@colony/worker` packages as runtime dependencies. Tsup already bundles every `@colony/*` module via `noExternal`, so the workspace deps moved to `devDependencies` and `npm install cavemem` resolves cleanly.
  - The bin entrypoint guard (`isMainEntry()`) now compares realpaths via `pathToFileURL(realpathSync(...))`, so the binary works when invoked through npm's symlinked `bin/` shim — previously `--version` and every other command silently exited 0 with no output.
  - Tsup's `banner` option was producing two `#!/usr/bin/env node` lines in every dynamic-import chunk (one from the source file, one from the banner), which broke `cavemem mcp` with `SyntaxError: Invalid or unexpected token`. The banner is gone; the shebang lives in the source files that need it.
  - A new `prepublishOnly` script (`apps/cli/scripts/prepack.mjs`) stages `README.md`, `LICENSE`, and `hooks-scripts/` into `apps/cli/` so `changeset publish` produces a complete tarball. The script no-ops outside the source repo so installing the tarball never re-runs it.
  - The root workspace package was renamed from `cavemem` to `cavemem-monorepo` (still `private:true`) to remove a name collision that caused `pnpm --filter cavemem` to match the root instead of the publishable cli package.

  **CI**

  - The release workflow now runs all four gates (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`) and the new `bash scripts/e2e-publish.sh` end-to-end check before `changeset publish` is allowed to publish.

- 4af0d0d: Build, lint, and test-ecosystem fixes:

  - Drop `incremental: true` from the base tsconfig so `tsup --dts` stops failing with TS5074 and `pnpm build` is green again.
  - Resolve the full Biome lint backlog (organizeImports, useImportType) across every package. `pnpm lint` is now clean.
  - Fix a compression bug where `collapseWhitespace` would eat the single space between prose and preserved tokens (paths, inline code, URLs), producing unreadable output like `at/tmp/foo.txt`. Boundary spacing is now preserved on compress and round-tripped through expand.
  - Fix `Storage.timeline(sessionId, aroundId, limit)` — the previous single-UNION query let the "after" half swallow the whole window. Replaced with two bounded queries merged in JS so both halves are respected.
  - Remove a double `expand()` call in the MCP `get_observations` tool; expansion now happens exactly once inside `MemoryStore`.
  - `runHook()` now accepts an injected `MemoryStore` so tests (and other integrations) can avoid touching the user's real `~/.colony` data directory.

  Test ecosystem: brand-new suites for `@colony/hooks` (runner + all 5 handlers + hot-path budget check), `@colony/installers` (claude-code idempotency, settings preservation, cursor install/uninstall, registry, deepMerge), `@colony/mcp-server` (InMemory MCP client hitting every tool and asserting the progressive-disclosure shape), `@colony/worker` (Hono `app.request()` integration tests for every HTTP route), and the `cavemem` CLI (command registration smoke test). Total tests: 22 → 54.

  None of the new test directories are shipped — every published package keeps its `files` allowlist pointed at `dist` only.

- Updated dependencies [416957b]
  - @colony/config@0.2.0
