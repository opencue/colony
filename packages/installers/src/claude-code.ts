import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson, shellQuote, writeJson } from './fs-utils.js';
import {
  type McpServersConfig,
  detectedOmxLayerMessages,
  installDetectedOmxLayer,
} from './omx-layer.js';
import type {
  InstallContext,
  InstallValidationIssue,
  InstallValidationResult,
  Installer,
} from './types.js';
import { missingDetectedOmxServers, sameArgs, validationIssue } from './validation.js';

const REQUIRED_MCP_SERVER = 'colony';

interface ClaudeSettings {
  hooks?: Record<
    string,
    Array<{
      matcher?: string;
      hooks: Array<{ type: string; command: string; [key: string]: unknown }>;
    }>
  >;
  mcpServers?: McpServersConfig;
}

const HOOK_NAMES: Array<[string, string]> = [
  ['SessionStart', 'session-start'],
  ['UserPromptSubmit', 'user-prompt-submit'],
  ['PreToolUse', 'pre-tool-use'],
  ['PostToolUse', 'post-tool-use'],
  ['Stop', 'stop'],
  ['SessionEnd', 'session-end'],
];

// Scope tool-use hooks to the write-family tools that actually drive the
// auto-claim path. Bash/apply_patch are included because the auto-claim layer
// parses shell redirects/sed and patch headers into file writes.
const FILE_WRITE_TOOL_MATCHER =
  'Edit|Write|MultiEdit|NotebookEdit|Bash|apply_patch|ApplyPatch|Patch';

function matcherForHook(hookId: string): string | undefined {
  if (hookId === 'pre-tool-use' || hookId === 'post-tool-use') return FILE_WRITE_TOOL_MATCHER;
  return undefined;
}

// The exact hook command install() writes — kept in one place so verify()
// compares against the same string. nodeBin + cliPath are shell-quoted because
// Windows npm installs land under paths with spaces (C:\Users\...\AppData);
// both cmd.exe and sh treat "..." as one argv token.
function commandForHook(ctx: InstallContext, hookId: string): string {
  return `${shellQuote(ctx.nodeBin)} ${shellQuote(ctx.cliPath)} hook run ${hookId} --ide claude-code`;
}

function settingsFile(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function isColonyHookCommand(command: string, hookId: string): boolean {
  const normalized = command.replace(/["']/g, ' ').replace(/\s+/g, ' ').trim();
  return /\bcolony(?:\.js)?\b/.test(normalized) && normalized.includes(` hook run ${hookId}`);
}

function installColonyHook(
  existing: NonNullable<ClaudeSettings['hooks']>[string] | undefined,
  command: string,
  hookId: string,
): NonNullable<ClaudeSettings['hooks']>[string] {
  const filtered = removeColonyHook(existing, hookId);
  const matcher = matcherForHook(hookId);
  return [
    ...filtered,
    {
      ...(matcher !== undefined ? { matcher } : {}),
      hooks: [
        {
          type: 'command',
          command,
        },
      ],
    },
  ];
}

function removeColonyHook(
  existing: NonNullable<ClaudeSettings['hooks']>[string] | undefined,
  hookId: string,
): NonNullable<ClaudeSettings['hooks']>[string] {
  return (existing ?? [])
    .map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((hook) => !isColonyHookCommand(hook.command, hookId)),
    }))
    .filter((entry) => entry.hooks.length > 0);
}

export const claudeCode: Installer = {
  id: 'claude-code',
  label: 'Claude Code',
  async detect(_ctx: InstallContext): Promise<boolean> {
    return existsSync(join(homedir(), '.claude'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const path = settingsFile();
    const current = readJson<ClaudeSettings>(path, {});
    const hooks: ClaudeSettings['hooks'] = { ...(current.hooks ?? {}) };
    for (const [claudeName, hookId] of HOOK_NAMES) {
      hooks[claudeName] = installColonyHook(hooks[claudeName], commandForHook(ctx, hookId), hookId);
    }
    const mcpServers: NonNullable<ClaudeSettings['mcpServers']> = { ...(current.mcpServers ?? {}) };
    delete mcpServers.cavemem;
    mcpServers.colony = {
      // Spawn node explicitly — if command is the .js file, Claude Code's
      // MCP launcher can't exec it on Windows (EFTYPE).
      command: ctx.nodeBin,
      args: [ctx.cliPath, 'mcp'],
    };
    const installedOmxServers = installDetectedOmxLayer(mcpServers);
    const next: ClaudeSettings = { ...current, hooks, mcpServers };
    writeJson(path, next);
    return [`wrote ${path}`, ...detectedOmxLayerMessages(installedOmxServers)];
  },
  async verify(ctx: InstallContext): Promise<InstallValidationResult> {
    return validateClaudeCodeInstall(ctx);
  },
  async uninstall(_ctx: InstallContext): Promise<string[]> {
    const path = settingsFile();
    const current = readJson<ClaudeSettings>(path, {});
    if (current.hooks) {
      for (const [claudeName, hookId] of HOOK_NAMES) {
        const remaining = removeColonyHook(current.hooks[claudeName], hookId);
        if (remaining.length > 0) current.hooks[claudeName] = remaining;
        else delete current.hooks[claudeName];
      }
    }
    if (current.mcpServers) {
      delete current.mcpServers.colony;
      delete current.mcpServers.cavemem;
    }
    writeJson(path, current);
    return [`updated ${path}`];
  },
};

type ClaudeHookStatus = 'ok' | 'missing' | 'stale';

// Mirror of codex's hook-status check: 'ok' when a hook with the exact expected
// command + matcher is present, 'stale' when a colony hook exists but is
// outdated (e.g. a moved cliPath), 'missing' when no colony hook is present.
function claudeCodeHookStatus(
  entries: NonNullable<ClaudeSettings['hooks']>[string] | undefined,
  ctx: InstallContext,
  hookId: string,
): ClaudeHookStatus {
  if (!entries || entries.length === 0) return 'missing';
  const expectedCommand = commandForHook(ctx, hookId);
  const expectedMatcher = matcherForHook(hookId);
  let sawColonyHook = false;
  for (const entry of entries) {
    for (const hook of entry.hooks) {
      const commandMatches = hook.command === expectedCommand;
      if (!isColonyHookCommand(hook.command, hookId) && !commandMatches) continue;
      sawColonyHook = true;
      if (commandMatches && hook.type === 'command' && entry.matcher === expectedMatcher) {
        return 'ok';
      }
    }
  }
  return sawColonyHook ? 'stale' : 'missing';
}

// Validate that ~/.claude/settings.json carries the colony MCP server + all six
// hooks (plus any detected OMX-layer MCP servers). Backs `colony install --ide
// claude-code --verify`, which previously threw because the installer had no
// verify() implementation.
export function validateClaudeCodeInstall(ctx: InstallContext): InstallValidationResult {
  const issues: InstallValidationIssue[] = [];
  const path = settingsFile();
  const settings = readJson<ClaudeSettings>(path, {});

  const colonyMcp = settings.mcpServers?.[REQUIRED_MCP_SERVER];
  if (colonyMcp?.command !== ctx.nodeBin || !sameArgs(colonyMcp.args, [ctx.cliPath, 'mcp'])) {
    issues.push(validationIssue({ file: path, missingMcpServers: [REQUIRED_MCP_SERVER] }));
  }
  const missingOmxServers = missingDetectedOmxServers(settings.mcpServers ?? {});
  if (missingOmxServers.length > 0) {
    issues.push(validationIssue({ file: path, missingMcpServers: missingOmxServers }));
  }

  const missingHooks: string[] = [];
  const staleHooks: string[] = [];
  for (const [claudeName, hookId] of HOOK_NAMES) {
    const status = claudeCodeHookStatus(settings.hooks?.[claudeName], ctx, hookId);
    if (status === 'missing') missingHooks.push(claudeName);
    else if (status === 'stale') staleHooks.push(claudeName);
  }
  if (missingHooks.length > 0 || staleHooks.length > 0) {
    issues.push(validationIssue({ file: path, missingHooks, staleHooks }));
  }

  return {
    ok: issues.length === 0,
    issues,
    messages:
      issues.length === 0
        ? [`verified ${path}: colony MCP + ${HOOK_NAMES.map(([name]) => name).join(', ')}`]
        : [],
  };
}
