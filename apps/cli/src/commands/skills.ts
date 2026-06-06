import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';
import kleur from 'kleur';

/**
 * The Colony coordination skill, as a cue (cue-ai) profile-manager skill id.
 * Wiring this into the active cue profile is how the agent *discovers* Colony:
 * it loads on a real trigger ("Colony", "coordinate", "claim files") and lets
 * the agent PULL the coordination loop + MCP surface when it helps, instead of
 * Colony pushing a mandatory ritual through hooks/contract every session.
 */
export const COLONY_CUE_SKILL_ID = 'colony/colony';

/**
 * Fallback when cue is not installed: `npx skills add` materialises the repo's
 * colony-mcp skill straight into ~/.claude/skills. Note the source path is
 * `recodee/colony` (the repo lives at ~/Documents/recodee/colony) — the old
 * hint had a `recodeee` typo.
 */
export const COLONY_SKILL_INSTALL_FALLBACK = 'npx skills add recodee/colony/skills/colony-mcp';

export interface CueWireResult {
  cueDetected: boolean;
  ok: boolean;
  message: string;
}

/**
 * Best-effort cue detection. We never want skill-wiring to block or fail an
 * install, so a missing cue is a soft no-op, not an error.
 */
function cueOnPath(): boolean {
  try {
    execFileSync('cue', ['--version'], { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function cueStderr(err: unknown): string {
  const e = err as { stderr?: Buffer | string; message?: string };
  const stderr = e?.stderr?.toString().trim();
  return stderr || e?.message || 'unknown error';
}

/**
 * Add the Colony skill to the active cue profile via cue's own public CLI
 * (`cue skills add-to-profile`). cue owns profile resolution (.cue-profile →
 * repo-default → global default) and the write; we just ask it to register the
 * skill. Idempotent: cue returns success if the skill is already present.
 */
export function wireColonySkill(
  opts: { skill?: string | undefined; dryRun?: boolean | undefined } = {},
): CueWireResult {
  const skill = opts.skill ?? COLONY_CUE_SKILL_ID;
  if (!cueOnPath()) {
    return {
      cueDetected: false,
      ok: false,
      message: `cue not found — load the skill yourself with: ${COLONY_SKILL_INSTALL_FALLBACK}`,
    };
  }
  try {
    const args = ['skills', 'add-to-profile', skill, ...(opts.dryRun ? ['--preview'] : [])];
    const out = execFileSync('cue', args, { encoding: 'utf8', timeout: 15_000 }).trim();
    return {
      cueDetected: true,
      ok: true,
      message: out || `wired ${skill} into the active cue profile`,
    };
  } catch (err) {
    return { cueDetected: true, ok: false, message: cueStderr(err) };
  }
}

/** Remove the Colony skill from the active cue profile. Symmetric with wire. */
export function unwireColonySkill(opts: { skill?: string | undefined } = {}): CueWireResult {
  const skill = opts.skill ?? COLONY_CUE_SKILL_ID;
  if (!cueOnPath()) {
    return { cueDetected: false, ok: false, message: 'cue not found — nothing to unwire' };
  }
  try {
    const out = execFileSync('cue', ['skills', 'remove-from-profile', skill], {
      encoding: 'utf8',
      timeout: 15_000,
    }).trim();
    return {
      cueDetected: true,
      ok: true,
      message: out || `unwired ${skill} from the active cue profile`,
    };
  } catch (err) {
    return { cueDetected: true, ok: false, message: cueStderr(err) };
  }
}

/** Print a wire/unwire result with the house glyph set (✓ done, · soft no-op). */
export function printCueWireResult(result: CueWireResult): void {
  const glyph = result.ok ? kleur.green('✓') : kleur.yellow('·');
  process.stdout.write(`${glyph} ${result.message}\n`);
}

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command('skills')
    .description('Wire Colony coordination skills into the active cue profile');

  skills
    .command('wire')
    .description(
      'Add the Colony skill to the active cue profile so the agent can pull coordination context on demand',
    )
    .option('--skill <id>', 'cue skill id to wire', COLONY_CUE_SKILL_ID)
    .option('--dry-run', 'preview the change without writing')
    .action((opts: { skill?: string; dryRun?: boolean }) => {
      printCueWireResult(wireColonySkill({ skill: opts.skill, dryRun: opts.dryRun }));
    });

  skills
    .command('unwire')
    .description('Remove the Colony skill from the active cue profile')
    .option('--skill <id>', 'cue skill id to unwire', COLONY_CUE_SKILL_ID)
    .action((opts: { skill?: string }) => {
      printCueWireResult(unwireColonySkill({ skill: opts.skill }));
    });
}
