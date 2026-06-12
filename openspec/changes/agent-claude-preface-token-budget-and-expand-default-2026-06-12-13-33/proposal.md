## Why

- The SessionStart preface had per-section caps but no global bound — one verbose prior-session summary could dominate an agent's opening context. Separately, MCP `get_observations` hardcoded `expand ?? true`, overriding the existing `compression.expandForModel` setting (default false) and paying expansion cost on every default read.

## What Changes

- `applyPrefaceTokenBudget` in `packages/hooks/src/handlers/session-start.ts`: sections carry trim priorities (contract → task → ready-claim → attention → proposals → prior → suggestions → foraging → scope-check); when the joined preface exceeds `sessionStart.prefaceTokenBudget` (new setting, default 800), lowest-priority sections drop first and a one-line trailer names what was trimmed. Display order is unchanged. Budget 0 disables trimming.
- Prior-session summaries in the preface are capped at 300 chars each (3 max).
- MCP `get_observations` no longer forces expansion: omitted `expand` falls through to `MemoryStore`, which honors `compression.expandForModel` (default false → compressed stored form; technical tokens preserved byte-for-byte regardless).
- `@colony/core` re-exports `countTokens` so hooks budget text without a new package dependency.

## Impact

- Soft-breaking: default `get_observations` output is now the compressed caveman form. Callers wanting prose pass `expand: true` or set `compression.expandForModel: true`. docs/mcp.md updated.
- Preface trimming is never silent (trailer line lists dropped sections).
