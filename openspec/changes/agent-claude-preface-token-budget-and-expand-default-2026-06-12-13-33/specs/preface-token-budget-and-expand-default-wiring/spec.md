## ADDED Requirements

### Requirement: SessionStart preface respects a global token budget
The SessionStart hook SHALL trim the assembled preface to `sessionStart.prefaceTokenBudget` tokens by dropping lowest-priority sections first, keeping display order for survivors, always retaining the highest-priority non-empty section, and appending a trailer naming dropped sections.

#### Scenario: Over-budget preface trims low-priority sections
- **WHEN** the joined sections exceed the budget
- **THEN** sections drop in reverse priority order and the output ends with a `(preface trimmed …)` trailer naming them.

#### Scenario: Budget disabled
- **WHEN** `prefaceTokenBudget` is 0
- **THEN** no trimming occurs.

### Requirement: get_observations honors expandForModel
`get_observations` SHALL NOT force expansion when `expand` is omitted; the result SHALL follow `settings.compression.expandForModel` (default false).

#### Scenario: Default read returns compressed stored form
- **WHEN** `get_observations` is called without `expand`
- **THEN** content is the compressed stored form with technical tokens intact
- **AND** `expand: true` returns the expanded form.
