import { homedir } from 'node:os';
import { loadSettings, resolveDataDir, saveSettings } from '@colony/config';
import { type IdeName, getInstaller, installers } from '@colony/installers';
import type { Command } from 'commander';
import kleur from 'kleur';
import { resolveCliPath } from '../util/resolve.js';
import { unwireColonySkill } from './skills.js';

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Remove IDE integration')
    .option('--ide <name>', 'IDE to target', 'claude-code')
    .option('--no-skills', 'leave the Colony skill in the active cue profile')
    .action(async (opts: { ide: string; skills?: boolean }) => {
      const name = opts.ide as IdeName;
      if (!installers[name]) throw new Error(`Unknown --ide ${opts.ide}`);
      const settings = loadSettings();
      const installer = getInstaller(name);
      const msgs = await installer.uninstall({
        ideConfigDir: homedir(),
        cliPath: resolveCliPath(),
        nodeBin: process.execPath,
        dataDir: resolveDataDir(settings.dataDir),
      });
      for (const m of msgs) process.stdout.write(`${kleur.yellow('·')} ${m}\n`);
      // Symmetric with install: pull the Colony skill back out of the active
      // cue profile. Best-effort and idempotent — a missing cue or an
      // already-removed skill is a soft no-op, never an uninstall failure.
      if (opts.skills !== false && process.env.COLONY_SKILL_WIRE !== '0') {
        const unwired = unwireColonySkill();
        if (unwired.cueDetected) process.stdout.write(`${kleur.yellow('·')} ${unwired.message}\n`);
      }
      delete settings.ides[name];
      saveSettings(settings);
    });
}
