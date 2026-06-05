import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEMOIR_RELATION_TYPES, Storage } from '../src/index.js';

let dir: string;
let dbPath: string;
let storage: Storage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'colony-memoirs-'));
  dbPath = join(dir, 'test.db');
  storage = new Storage(dbPath);
});

afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Storage memoirs', () => {
  it('runs the migration cleanly and exposes the memoir tables', () => {
    const db = new Database(dbPath);
    try {
      const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as {
        version: number;
      }[];
      expect(versions.map((v) => v.version)).toContain(17);
      const fts = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memoir_concepts_fts'")
        .get();
      expect(fts).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('round-trips a memoir → concepts → relations → search → BFS inspect', () => {
    const memoir = storage.createMemoir({
      name: 'system-architecture',
      description: 'System design decisions',
      created_by: 'claude',
    });
    expect(memoir.id).toBeGreaterThan(0);
    expect(storage.getMemoirByName('system-architecture')?.id).toBe(memoir.id);

    const auth = storage.addMemoirConcept({
      memoir_id: memoir.id,
      name: 'auth-service',
      content: 'Handles JWT tokens and OAuth2 flows',
      labels: ['domain:auth', 'type:service'],
    });
    const gateway = storage.addMemoirConcept({
      memoir_id: memoir.id,
      name: 'api-gateway',
      content: 'Edge ingress, rate limits, header rewrites',
      labels: ['domain:edge'],
    });
    const session = storage.addMemoirConcept({
      memoir_id: memoir.id,
      name: 'session-store',
      content: 'Redis-backed session cache for auth tokens',
      labels: ['domain:auth', 'type:store'],
    });

    storage.linkMemoirConcepts({
      memoir_id: memoir.id,
      source_id: gateway.id,
      target_id: auth.id,
      relation_type: 'depends_on',
      note: 'gateway hands tokens to auth',
    });
    storage.linkMemoirConcepts({
      memoir_id: memoir.id,
      source_id: auth.id,
      target_id: session.id,
      relation_type: 'depends_on',
    });

    // Idempotency: same (source,target,type) is a no-op.
    storage.linkMemoirConcepts({
      memoir_id: memoir.id,
      source_id: gateway.id,
      target_id: auth.id,
      relation_type: 'depends_on',
    });
    const inspectDb = new Database(dbPath, { readonly: true });
    try {
      const edges = inspectDb
        .prepare('SELECT COUNT(*) AS n FROM memoir_relations WHERE memoir_id = ?')
        .get(memoir.id) as { n: number };
      expect(edges.n).toBe(2);
    } finally {
      inspectDb.close();
    }

    // Search ranks the auth-related concepts above gateway for "auth".
    const hits = storage.searchMemoirConcepts({ memoir_id: memoir.id, query: 'auth', limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.name).toMatch(/auth/);
    expect(hits[0]?.labels).toContain('domain:auth');

    // Label filter narrows to auth domain.
    const authOnly = storage.searchMemoirConcepts({
      memoir_id: memoir.id,
      query: 'service',
      label: 'domain:auth',
    });
    for (const h of authOnly) expect(h.labels).toContain('domain:auth');

    // BFS depth-1 from gateway: out -> auth, no incoming.
    const direct = storage.inspectMemoirConcept(gateway.id, 1);
    expect(direct.map((e) => e.other_name)).toContain('auth-service');
    expect(direct.every((e) => e.depth === 1)).toBe(true);

    // BFS depth-2 from gateway reaches session-store via auth.
    const two = storage.inspectMemoirConcept(gateway.id, 2);
    expect(two.map((e) => e.other_name)).toEqual(
      expect.arrayContaining(['auth-service', 'session-store']),
    );
  });

  it('rejects self-links and unknown relation types', () => {
    const m = storage.createMemoir({ name: 'm1', created_by: 'test' });
    const a = storage.addMemoirConcept({ memoir_id: m.id, name: 'a', content: 'A' });
    expect(() =>
      storage.linkMemoirConcepts({
        memoir_id: m.id,
        source_id: a.id,
        target_id: a.id,
        relation_type: 'depends_on',
      }),
    ).toThrow(/cannot link a concept to itself/);

    const b = storage.addMemoirConcept({ memoir_id: m.id, name: 'b', content: 'B' });
    expect(() =>
      storage.linkMemoirConcepts({
        memoir_id: m.id,
        source_id: a.id,
        target_id: b.id,
        // @ts-expect-error invalid relation type, CHECK constraint should reject
        relation_type: 'not-a-real-relation',
      }),
    ).toThrow();
  });

  it('refines a concept in place and updates timestamps', async () => {
    const m = storage.createMemoir({ name: 'm-refine', created_by: 'test' });
    const c = storage.addMemoirConcept({
      memoir_id: m.id,
      name: 'parser',
      content: 'uses recursive descent',
      labels: ['type:parser'],
      confidence: 0.5,
    });
    // ensure monotonic clock tick so updated_at differs
    await new Promise((r) => setTimeout(r, 2));
    const refined = storage.refineMemoirConcept(m.id, 'parser', {
      content: 'uses Pratt algorithm',
      labels: ['type:parser', 'kind:pratt'],
      confidence: 0.9,
    });
    expect(refined?.id).toBe(c.id);
    expect(refined?.confidence).toBe(0.9);
    expect(refined?.labels).toContain('kind:pratt');
    expect((refined?.updated_at ?? 0) >= c.updated_at).toBe(true);
  });

  it('exposes every ICM relation type via the public constant', () => {
    expect(MEMOIR_RELATION_TYPES).toEqual(
      expect.arrayContaining([
        'part_of',
        'depends_on',
        'related_to',
        'contradicts',
        'refines',
        'alternative_to',
        'caused_by',
        'instance_of',
        'superseded_by',
      ]),
    );
  });
});
