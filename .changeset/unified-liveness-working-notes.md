---
'@colony/core': minor
'@colony/mcp-server': minor
'@colony/hooks': minor
---

Cross-agent awareness: unified liveness + working-note "now lines". `readHivemind` accepts an optional `sqliteLiveness` source — sessions with stale heartbeat files but fresh SQLite observations are reclassified as working (`liveness_source: 'sqlite'`); every hivemind session now carries `liveness_source`. `attention_inbox` gains `active_working_notes` (latest task_note_working note per other live session, 30-min window) plus `summary.active_working_note_count`. The SessionStart task preface shows up to 3 co-participant "now:" lines so agents start each session knowing what everyone else is mid-flight on.
