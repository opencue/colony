---
"@colony/storage": minor
"@colony/core": minor
"@colony/mcp-server": minor
---

ICM slice 1 — memoirs (typed knowledge graphs).

A memoir is a named container of typed concepts (graph nodes) connected
by typed relations (graph edges). Concept content routes through the
same `prepareMemoryText` redact → compress pipeline used for
observations, so the compression invariant holds at the write boundary.
The nine relation types
(`part_of`, `depends_on`, `related_to`, `contradicts`, `refines`,
`alternative_to`, `caused_by`, `instance_of`, `superseded_by`) mirror
ICM's taxonomy and let agents express "what supersedes X", "what
contradicts decision Y", and similar structural reasoning without
abandoning the flat-observations primary store.

Schema bump 14 → 15 adds three tables (`memoirs`,
`memoir_concepts`, `memoir_relations`) and one virtual table
(`memoir_concepts_fts`) with `(ai, ad, au)` triggers mirroring
`observations_fts`. Migrations are forward-only.

`MemoryStore` exposes `createMemoir`, `listMemoirs`, `addConcept`,
`refineConcept`, `linkConcepts`, `searchConcepts`, and `inspectConcept`.
Seven MCP tools (`memoir_create`, `memoir_list`, `memoir_add_concept`,
`memoir_refine`, `memoir_link`, `memoir_search`, `memoir_inspect`) wrap
them with progressive disclosure — `memoir_search` returns compact hits
and `memoir_inspect` is the only path that returns full bodies plus a
BFS neighbourhood.
