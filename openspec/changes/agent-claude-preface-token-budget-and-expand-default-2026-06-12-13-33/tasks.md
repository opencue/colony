## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-preface-token-budget-and-expand-default-2026-06-12-13-33`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-preface-token-budget-and-expand-default-2026-06-12-13-33` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-claude-preface-token-budget-and-expand-default-2026-06-12-13-33/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-preface-token-budget-and-expand-default-2026-06-12-13-33`.
- [x] 1.2 Define normative requirements in `specs/preface-token-budget-and-expand-default-wiring/spec.md`.

## 2. Implementation

- [x] 2.1 Implement scoped behavior changes. Evidence: session-start.ts applyPrefaceTokenBudget + PRIOR_SUMMARY_CHAR_CAP; search.ts get_observations expand fallthrough; schema.ts sessionStart.prefaceTokenBudget; core/index.ts countTokens re-export.
- [x] 2.2 Add/update focused regression coverage. Evidence: hooks session-start.test.ts applyPrefaceTokenBudget suite (5 tests); server.test.ts expand-default + expand=true tests.

## 3. Verification

- [x] 3.1 Run targeted project verification commands. Evidence: pnpm typecheck/lint/test/build all green (test exit 0, # fail 0).
- [x] 3.2 Run `openspec validate agent-claude-preface-token-budget-and-expand-default-2026-06-12-13-33 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
