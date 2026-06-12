## Why

- Mid-session contention was only visible at the NEXT turn (UserPromptSubmit conflict preface). An agent could spend a whole multi-edit turn colliding with another live session before learning about it.

## What Changes

- `postToolUse` returns optional `context`; the runner threads it into HookResult and `colony hook run post-tool-use` emits it as Claude Code `additionalContext` (PostToolUse hookSpecificOutput).
- `buildContentionAwarenessNote`: fires when `autoClaimFromToolUse` reports conflicts — both successful takeovers of recent claims and live-owner blocked takeovers (newly reported in `conflicts`). One line, ≤3 files, debounced 2 min/session via an `awareness-push` observation marker (one-shot hook processes can't hold in-memory state). Best-effort: storage failures return null.

## Impact

- Additive hook output; hook hot-path cost = one timeline(40) read + one observation write, within the 150ms budget. e2e-publish.sh re-run green (hook stdout contract touched).
