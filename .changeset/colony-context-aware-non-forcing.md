---
"@colony/hooks": minor
"@colony/config": minor
---

Colony is context-aware by default, never forcing. The PreToolUse hook no
longer hard-denies a tool call on a protected-branch claim conflict under the
default `warn` policy — it warns and records telemetry but lets the edit
proceed. Repos that want the old hard block opt in with
`bridge.policyMode = "block-on-conflict"`. The per-turn Claude Code
read-before-edit reminder is dropped (the harness already enforces it), and the
compact session-start contract is reframed from imperative "claim/hand off
before X" mandates to availability framing ("coordination is available, pull it
when it helps"). No write-path persistence changes.
