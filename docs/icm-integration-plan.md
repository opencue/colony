# ICM Integration Plan

Status: draft, slice 1 in flight
Reference: <https://github.com/rtk-ai/icm.git>

## What ICM is

ICM (Infinite Context Memory) is a Rust single-binary memory system for AI
agents. SQLite + FTS5 + sqlite-vec, MCP-native. It exposes two memory models
plus a feedback loop:

- **Memories** — episodic store/recall with temporal decay weighted by
  importance (`critical | high | medium | low`).
- **Memoirs** — permanent knowledge graphs of typed concepts and relations
  (`part_of`, `depends_on`, `contradicts`, `superseded_by`, `refines`,
  `related_to`, `alternative_to`, `caused_by`, `instance_of`).
- **Feedback** — record corrections when an AI prediction was wrong; search
  past mistakes before making new ones.

## Mapping ICM → colony

Colony already has the things ICM calls "memories" (observations + FTS5 +
optional vector hybrid + MCP `search` / `get_observations`) and goes further
with deterministic prose compression and active task coordination
(`hivemind`, `task_*`). Three ICM ideas have no equivalent in colony today:

| ICM concept                          | Colony today                                 | Verdict          |
| ------------------------------------ | -------------------------------------------- | ---------------- |
| Episodic memory w/ FTS + vec hybrid  | `observations` + `observations_fts` + vector | **Already have** |
| **Memoirs (typed knowledge graph)**  | `task_links` is the only typed-edge pattern  | **Adopt**        |
| **Feedback / prediction-error loop** | None                                         | **Adopt**        |
| **Importance + temporal decay**      | None — observations never decay              | Adopt (slice 3)  |
| Auto-dedup on `>85%` similarity      | `cluster_observations` is post-hoc, not gate | Adopt (slice 4)  |
| Multi-IDE installer (17 tools)       | `packages/installers` covers main ones       | Skip             |
| Transcripts (verbatim capture)       | Sessions/observations already cover this     | Skip             |

The compression invariant must hold for every new write path: concept
descriptions and feedback bodies route through `prepareMemoryText` before
hitting storage, exactly like `addObservation`.

## Slice order

1. **Slice 1 — Memoirs (this PR)**. Storage migration, `Storage` CRUD,
   `MemoryStore` facade wrappers, MCP tools, tests. Progressive disclosure is
   preserved: `memoir_search` returns compact hits; `memoir_inspect` returns
   full neighbourhood.
2. **Slice 2 — Feedback**. `feedback` table keyed on a topic, MCP tools
   `feedback_record` / `feedback_search` / `feedback_stats`. Hook into
   pre-tool-use to surface relevant prior corrections.
3. **Slice 3 — Importance + decay**. Add `importance` column to observations
   (default `medium`), weight column updated lazily on read. Critical/high
   never pruned; medium/low decay with `decay / (1 + access_count * 0.1)`,
   matching ICM's access-aware formula.
4. **Slice 4 — Auto-dedup gate**. When `MemoryStore.addObservation` finds an
   embedding cosine > 0.85 in the same `kind` + `session_id` scope within the
   last N rows, update the existing row instead of inserting a new one.

## Slice 1 — concrete shape

### Tables (added to `SCHEMA_SQL`, version bumped to 15)

```sql
CREATE TABLE memoirs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  INTEGER NOT NULL,
  created_by  TEXT
);

CREATE TABLE memoir_concepts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memoir_id   INTEGER NOT NULL REFERENCES memoirs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,           -- compressed, via prepareMemoryText
  compressed  INTEGER NOT NULL DEFAULT 1,
  intensity   TEXT,
  labels      TEXT,                    -- JSON array of "k:v" strings
  confidence  REAL NOT NULL DEFAULT 1.0 CHECK(confidence BETWEEN 0 AND 1),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(memoir_id, name)
);

CREATE TABLE memoir_relations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  memoir_id     INTEGER NOT NULL REFERENCES memoirs(id) ON DELETE CASCADE,
  source_id     INTEGER NOT NULL REFERENCES memoir_concepts(id) ON DELETE CASCADE,
  target_id     INTEGER NOT NULL REFERENCES memoir_concepts(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK(relation_type IN (
    'part_of','depends_on','related_to','contradicts','refines',
    'alternative_to','caused_by','instance_of','superseded_by'
  )),
  note          TEXT,
  created_at    INTEGER NOT NULL,
  CHECK(source_id <> target_id),
  UNIQUE(source_id, target_id, relation_type)
);

CREATE VIRTUAL TABLE memoir_concepts_fts USING fts5(
  name, content, labels,
  content='memoir_concepts',
  content_rowid='id',
  tokenize='porter unicode61'
);
-- + the three obvious triggers (ai/ad/au) mirroring observations_fts.
```

### MCP tools (registered in `apps/mcp-server/src/server.ts`)

| Tool                | Shape                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| `memoir_create`     | `{ name, description?, created_by? }` → memoir row                                    |
| `memoir_list`       | `{ limit? }` → compact list                                                           |
| `memoir_add_concept`| `{ memoir, name, content, labels?, confidence? }` → concept row (compressed)          |
| `memoir_refine`     | `{ memoir, name, content?, labels?, confidence? }` → updated concept                  |
| `memoir_link`       | `{ memoir, from, to, relation, note? }` → relation row                                |
| `memoir_search`     | `{ memoir?, query, label?, limit? }` → compact hits `{ id, name, score, snippet }`    |
| `memoir_inspect`    | `{ memoir, name, depth? }` → full body + BFS neighbourhood out to `depth` (default 1) |

### Why this is worth doing

Colony stores flat observations. ICM-style memoirs add cheap structural
reasoning: "what depends on the Rust runtime proxy", "what supersedes the
old auth middleware", "what contradicts decision X". The graph is local,
single-file SQLite, no extra deps, and the same compression invariant
applies — so it composes cleanly with everything colony already does.
