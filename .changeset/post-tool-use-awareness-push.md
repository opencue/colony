---
'@colony/hooks': minor
'colonyq': patch
---

Push awareness: when an edit touches a file another live session holds, the PostToolUse hook now injects a one-line `[Colony] session X recently claimed <file> …` note into the agent's context immediately (Claude Code `additionalContext`), instead of waiting for the next turn's preface. Debounced to once per 2 minutes per session via an `awareness-push` observation marker (hook processes are one-shot, so the marker doubles as audit trail). `autoClaimFromToolUse` now reports live-owner blocked takeovers in its `conflicts` result.
