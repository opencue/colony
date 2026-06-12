## ADDED Requirements

### Requirement: Mid-session contention push
The PostToolUse hook SHALL inject a one-line contention note into the agent's context when an edit touches a file held by another live session, debounced to once per 2 minutes per session.

#### Scenario: Contended edit pushes a note
- **WHEN** a session edits a file another live session claimed
- **THEN** the hook result carries a `[Colony] …` context line naming the other session and file
- **AND** an `awareness-push` observation records the emission.

#### Scenario: Debounce
- **WHEN** a second contended edit happens within 2 minutes
- **THEN** no context line is emitted until the window passes.

#### Scenario: Uncontended edits stay silent
- **WHEN** the touched files have no other-session claims
- **THEN** no context is emitted.
