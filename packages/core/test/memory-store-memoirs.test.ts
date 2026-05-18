import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expand } from '@colony/compress';
import { defaultSettings } from '@colony/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory-store.js';

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'colony-memoirs-facade-'));
  store = new MemoryStore({ dbPath: join(dir, 'data.db'), settings: defaultSettings });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('MemoryStore memoirs', () => {
  it('compresses concept content and preserves technical tokens on round-trip', () => {
    store.createMemoir({ name: 'rust-runtime', description: 'proxy notes' });
    const content =
      'The runtime uses tokio v1.36.0 and `axum::serve()` to bind 0.0.0.0:8787. ' +
      'It is basically really important to keep `packages/storage/src/migrations/` migrations forward-only.';
    const concept = store.addMemoirConcept({
      memoir: 'rust-runtime',
      name: 'proxy-binding',
      content,
      labels: ['lang:rust', 'kind:invariant'],
      confidence: 0.9,
    });
    expect(concept.compressed).toBe(1);
    expect(concept.intensity).toBe(defaultSettings.compression.intensity);

    // The stored body is compressed (different from the raw input) but every
    // technical token survives. Expanding restores readable prose.
    const stored = concept.content;
    for (const tok of [
      'tokio',
      'v1.36.0',
      '`axum::serve()`',
      '0.0.0.0:8787',
      '`packages/storage/src/migrations/`',
    ]) {
      expect(stored).toContain(tok);
    }
    const expanded = expand(stored);
    expect(expanded).toContain('tokio');
    expect(expanded).toContain('axum::serve()');
  });

  it('inspect returns BFS neighbourhood with expanded concept body', () => {
    store.createMemoir({ name: 'arch' });
    store.addMemoirConcept({ memoir: 'arch', name: 'gateway', content: 'edge node' });
    store.addMemoirConcept({ memoir: 'arch', name: 'auth', content: 'JWT auth' });
    store.addMemoirConcept({ memoir: 'arch', name: 'session', content: 'Redis sessions' });
    store.linkMemoirConcepts({
      memoir: 'arch',
      from: 'gateway',
      to: 'auth',
      relation: 'depends_on',
    });
    store.linkMemoirConcepts({
      memoir: 'arch',
      from: 'auth',
      to: 'session',
      relation: 'depends_on',
    });

    const direct = store.inspectMemoirConcept({ memoir: 'arch', name: 'gateway', depth: 1 });
    expect(direct?.concept.name).toBe('gateway');
    expect(direct?.neighbours.map((n) => n.other_name)).toContain('auth');
    expect(direct?.neighbours.every((n) => n.depth === 1)).toBe(true);

    const two = store.inspectMemoirConcept({ memoir: 'arch', name: 'gateway', depth: 2 });
    expect(two?.neighbours.map((n) => n.other_name)).toEqual(
      expect.arrayContaining(['auth', 'session']),
    );
  });

  it('search returns compact label-filtered hits', () => {
    store.createMemoir({ name: 'svc' });
    store.addMemoirConcept({
      memoir: 'svc',
      name: 'auth-service',
      content: 'handles JWT tokens',
      labels: ['domain:auth'],
    });
    store.addMemoirConcept({
      memoir: 'svc',
      name: 'billing-service',
      content: 'handles invoices',
      labels: ['domain:billing'],
    });
    const auth = store.searchMemoirConcepts({
      memoir: 'svc',
      query: 'service',
      label: 'domain:auth',
    });
    expect(auth.map((h) => h.name)).toEqual(['auth-service']);
  });

  it('rejects empty content and unknown memoirs', () => {
    store.createMemoir({ name: 'x' });
    expect(() =>
      store.addMemoirConcept({ memoir: 'x', name: 'empty', content: '<private>secret</private>' }),
    ).toThrow(/empty content/);
    expect(() =>
      store.addMemoirConcept({ memoir: 'does-not-exist', name: 'a', content: 'hi' }),
    ).toThrow(/not found/);
  });

  it('idempotently re-creates a memoir by name', () => {
    const a = store.createMemoir({ name: 'idem' });
    const b = store.createMemoir({ name: 'idem' });
    expect(b.id).toBe(a.id);
  });
});
