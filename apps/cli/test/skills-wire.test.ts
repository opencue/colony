import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COLONY_CUE_SKILL_ID,
  COLONY_SKILL_INSTALL_FALLBACK,
  unwireColonySkill,
  wireColonySkill,
} from '../src/commands/skills.js';

// Cross-platform fake `cue`: a Node script plus a .cmd shim so Windows
// spawn (which cannot exec shebang scripts) resolves it too.
function writeFakeCue(dir: string): void {
  const cuePath = join(dir, 'cue');
  writeFileSync(
    cuePath,
    [
      '#!/usr/bin/env node',
      'const args = process.argv.slice(2);',
      "if (args[0] === '--version') { process.stdout.write('0.0.0\\n'); process.exit(0); }",
      "process.stdout.write('called: ' + args.join(' ') + '\\n');",
      'process.exit(0);',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

// The real `cue` CLI ships as a POSIX binary and the wirer spawns it via
// execFileSync without a shell, which Windows cannot satisfy for extension-
// less PATH stubs — run the cue-present integration tests on POSIX only.
const POSIX = process.platform !== 'win32';

describe('colony skills wire (cue auto-wiring)', () => {
  const originalPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it('targets the existing cue colony skill and a typo-free manual fallback', () => {
    // We wire the skill cue already ships (colony/colony) rather than vendoring
    // a divergent copy. The fallback path is `recodee` (not the old `recodeee`).
    expect(COLONY_CUE_SKILL_ID).toBe('colony/colony');
    expect(COLONY_SKILL_INSTALL_FALLBACK).toContain('recodee/colony/skills/colony-mcp');
    expect(COLONY_SKILL_INSTALL_FALLBACK).not.toContain('recodeee');
  });

  it('is a soft no-op with the manual fallback when cue is not on PATH', () => {
    // Empty PATH → `cue` is unresolvable → execFileSync throws ENOENT → caught.
    // Wiring must never block or fail an install: a missing cue just points the
    // user at the manual command.
    process.env.PATH = '';
    const result = wireColonySkill();
    expect(result.cueDetected).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(COLONY_SKILL_INSTALL_FALLBACK);
  });

  it('unwire is also a soft no-op when cue is absent (never fails uninstall)', () => {
    process.env.PATH = '';
    const result = unwireColonySkill();
    expect(result.cueDetected).toBe(false);
    expect(result.ok).toBe(false);
  });

  it.runIf(POSIX)('invokes `cue skills add-to-profile <id>` when cue is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-cue-'));
    // Stub cue: answer --version for detection, echo every other invocation so
    // the test can assert the exact subcommand the wirer shells out to.
    writeFakeCue(dir);
    try {
      process.env.PATH = `${dir}${delimiter}${originalPath ?? ''}`;
      const result = wireColonySkill();
      expect(result.cueDetected).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.message).toContain('called: skills add-to-profile colony/colony');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(POSIX)('passes --preview through in dry-run mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-cue-'));
    writeFakeCue(dir);
    try {
      process.env.PATH = `${dir}${delimiter}${originalPath ?? ''}`;
      const result = wireColonySkill({ dryRun: true });
      expect(result.message).toContain('add-to-profile colony/colony --preview');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
