## Why

- Colony had two disconnected liveness systems — `.omx/state/active-sessions/` heartbeat files and the SQLite observations DB — so a dead heartbeat writer hid a live agent. And there was no "what is everyone doing right now" surface: agents had to hydrate timelines to learn what co-participants were mid-flight on.

## What Changes

- `readHivemind` accepts `sqliteLiveness` (satisfied by `MemoryStore.storage`); heartbeat-stale sessions with a SQLite observation inside the heartbeat window reclassify to `working` with new field `liveness_source: 'sqlite'`. All sessions carry `liveness_source` (`heartbeat`/`sqlite`/`worktree-lock`/`file-lock`/`managed-worktree`). MCP `hivemind` + `hivemind_context` pass the store.
- `buildAttentionInbox` gains `active_working_notes[]` — the latest `task_note_working` note (kind `note` + `metadata.working_note`) per other session per in-scope task, 30-min window, 120-char preview — plus `summary.active_working_note_count`. Reuses `taskObservationsByKind`; **no storage migration**.
- SessionStart task preface renders up to 3 co-participant `now:` lines (80-char) after the Joined-with line.

## Impact

- All additive. The Rust/codex bridge consuming hivemind payloads sees a new field; non-strict parsers unaffected.
