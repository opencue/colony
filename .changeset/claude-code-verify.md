---
"@colony/installers": minor
---

`colony install --ide claude-code --verify` now works. The claude-code installer
gained a `verify()` implementation (it previously threw "does not support
--verify" despite the flag being advertised): it validates ~/.claude/settings.json
for the colony MCP server, all six hooks, and any detected OMX-layer MCP servers,
reporting missing/stale hooks per the same contract codex uses. The generic
validation helpers (sameArgs, missingDetectedOmxServers, validationIssue) moved
to a shared `validation.ts` module so both installers reuse them.
