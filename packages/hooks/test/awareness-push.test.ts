import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '@colony/config';
import { MemoryStore, TaskThread } from '@colony/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContentionAwarenessNote, postToolUse } from '../src/handlers/post-tool-use.js';

let dir: string;
let repo: string;
let store: MemoryStore;

function fakeGitCheckout(path: string, branch: string): void {
  mkdirSync(join(path, '.git'), { recursive: true });
  writeFileSync(join(path, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'colony-awareness-push-'));
  store = new MemoryStore({ dbPath: join(dir, 'data.db'), settings: defaultSettings });
  repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  fakeGitCheckout(repo, 'feat/awareness');
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('buildContentionAwarenessNote', () => {
  it('emits one line on conflict and records the debounce marker', () => {
    store.startSession({ id: 'me', ide: 'claude-code', cwd: repo });
    const note = buildContentionAwarenessNote(store, { session_id: 'me' }, [
      { file_path: 'src/shared.ts', other_session: 'other-session-1234' },
    ]);
    expect(note).toContain('[Colony]');
    expect(note).toContain('src/shared.ts');
    expect(note).toContain('other-se');
    const marker = store.storage
      .timeline('me', undefined, 10)
      .find((row) => row.kind === 'awareness-push');
    expect(marker).toBeTruthy();
  });

  it('debounces within the 2-minute window and recovers after it', () => {
    store.startSession({ id: 'me', ide: 'claude-code', cwd: repo });
    const conflicts = [{ file_path: 'src/shared.ts', other_session: 'other-session-1234' }];
    const t0 = Date.now();
    expect(buildContentionAwarenessNote(store, { session_id: 'me' }, conflicts, t0)).toBeTruthy();
    expect(
      buildContentionAwarenessNote(store, { session_id: 'me' }, conflicts, t0 + 30_000),
    ).toBeNull();
    expect(
      buildContentionAwarenessNote(store, { session_id: 'me' }, conflicts, t0 + 3 * 60_000),
    ).toBeTruthy();
  });

  it('returns null without conflicts', () => {
    store.startSession({ id: 'me', ide: 'claude-code', cwd: repo });
    expect(buildContentionAwarenessNote(store, { session_id: 'me' }, [])).toBeNull();
  });
});

describe('postToolUse contention push', () => {
  it('returns context when the edit takes over another live session claim', async () => {
    store.startSession({ id: 'owner', ide: 'claude-code', cwd: repo });
    store.startSession({ id: 'me', ide: 'codex', cwd: repo });
    const thread = TaskThread.open(store, {
      repo_root: repo,
      branch: 'feat/awareness',
      session_id: 'owner',
    });
    thread.join('owner', 'claude');
    thread.join('me', 'codex');
    thread.claimFile({ session_id: 'owner', file_path: 'src/contended.ts' });

    const result = await postToolUse(store, {
      session_id: 'me',
      cwd: repo,
      tool_name: 'Edit',
      tool_input: { file_path: join(repo, 'src/contended.ts') },
    });

    expect(result.context).toContain('[Colony]');
    expect(result.context).toContain('src/contended.ts');
  });

  it('returns no context for uncontended edits', async () => {
    store.startSession({ id: 'solo', ide: 'codex', cwd: repo });
    const thread = TaskThread.open(store, {
      repo_root: repo,
      branch: 'feat/awareness',
      session_id: 'solo',
    });
    thread.join('solo', 'codex');

    const result = await postToolUse(store, {
      session_id: 'solo',
      cwd: repo,
      tool_name: 'Edit',
      tool_input: { file_path: join(repo, 'src/own.ts') },
    });

    expect(result.context).toBeUndefined();
  });
});
