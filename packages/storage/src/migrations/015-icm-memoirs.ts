export const version = 15;
export const name = 'icm-memoirs';

export const sql = `
CREATE TABLE IF NOT EXISTS memoirs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  INTEGER NOT NULL,
  created_by  TEXT
);

CREATE TABLE IF NOT EXISTS memoir_concepts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memoir_id   INTEGER NOT NULL REFERENCES memoirs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,
  compressed  INTEGER NOT NULL DEFAULT 1,
  intensity   TEXT,
  labels      TEXT,
  confidence  REAL NOT NULL DEFAULT 1.0 CHECK(confidence BETWEEN 0 AND 1),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(memoir_id, name)
);

CREATE TABLE IF NOT EXISTS memoir_relations (
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
`;
