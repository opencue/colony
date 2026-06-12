## ADDED Requirements

### Requirement: Unified session liveness
Hivemind snapshots SHALL reconcile heartbeat-file liveness with SQLite observation freshness when a `sqliteLiveness` source is provided, exposing `liveness_source` per session.

#### Scenario: SQLite-fresh session resurrected
- **WHEN** a session's heartbeat is stale but its last observation is within the heartbeat window
- **THEN** the session reports `activity: working` and `liveness_source: 'sqlite'`.

#### Scenario: Best-effort on storage failure
- **WHEN** the liveness source throws
- **THEN** the snapshot still returns with heartbeat-derived activity.

### Requirement: Working-note awareness surface
`attention_inbox` SHALL surface the latest working note per other live session per in-scope task within a 30-minute window, and the SessionStart task preface SHALL render up to 3 such notes.

#### Scenario: Inbox working notes
- **WHEN** another session posted a `working_note` observation within 30 minutes
- **THEN** `active_working_notes` contains one entry for that session with task_id, observation_id, agent, ts, and a 120-char preview
- **AND** the caller's own notes and non-working notes are excluded.
