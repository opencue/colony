---
'@colony/hooks': minor
'@colony/mcp-server': minor
'@colony/config': minor
'@colony/core': patch
---

Session-start preface now enforces a global token budget (`sessionStart.prefaceTokenBudget`, default 800): low-priority sections (scope check, foraging, suggestions, prior sessions) drop first with a one-line trailer naming the trim. Prior-session summaries are capped at 300 chars each. MCP `get_observations` stops forcing expansion — it now honors `compression.expandForModel` (default false), so model-facing reads stay compressed unless `expand: true` is passed. `@colony/core` re-exports `countTokens`.
