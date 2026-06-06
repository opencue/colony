import {
  type McpServerConfig,
  type McpServersConfig,
  detectSystemOmxMcpServers,
} from './omx-layer.js';
import type { InstallValidationIssue } from './types.js';

// Generic install-validation helpers shared by every IDE installer's verify()
// path. They are intentionally IDE-agnostic: each installer supplies its own
// config paths + expected commands, and reuses these to compare/report.

export function sameArgs(actual: string[] | undefined, expected: string[]): boolean {
  const actualArgs = actual ?? [];
  if (actualArgs.length !== expected.length) return false;
  return expected.every((value, index) => actualArgs[index] === value);
}

function sameEnv(
  actual: Record<string, string> | undefined,
  expected: Record<string, string> | undefined,
): boolean {
  const actualEntries = Object.entries(actual ?? {}).sort();
  const expectedEntries = Object.entries(expected ?? {}).sort();
  return (
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(
      ([key, value], index) =>
        actualEntries[index]?.[0] === key && actualEntries[index]?.[1] === value,
    )
  );
}

export function sameMcpServer(actual: McpServerConfig, expected: McpServerConfig): boolean {
  if (actual.command !== expected.command || !sameArgs(actual.args, expected.args ?? [])) {
    return false;
  }
  return sameEnv(actual.env, expected.env);
}

export function missingDetectedOmxServers(current: McpServersConfig): string[] {
  const missing: string[] = [];
  for (const [name, expected] of Object.entries(detectSystemOmxMcpServers())) {
    const actual = current[name];
    if (!actual || !sameMcpServer(actual, expected)) missing.push(name);
  }
  return missing.sort((a, b) => a.localeCompare(b));
}

export function validationIssue(args: {
  file: string;
  missingHooks?: string[];
  staleHooks?: string[];
  missingMcpServers?: string[];
}): InstallValidationIssue {
  const parts: string[] = [];
  if (args.missingHooks && args.missingHooks.length > 0) {
    parts.push(`missing hooks: ${args.missingHooks.join(', ')}`);
  }
  if (args.staleHooks && args.staleHooks.length > 0) {
    parts.push(`stale hooks: ${args.staleHooks.join(', ')}`);
  }
  if (args.missingMcpServers && args.missingMcpServers.length > 0) {
    parts.push(`missing MCP servers: ${args.missingMcpServers.join(', ')}`);
  }
  return {
    file: args.file,
    message: parts.join('; '),
    ...(args.missingHooks && args.missingHooks.length > 0
      ? { missingHooks: args.missingHooks }
      : {}),
    ...(args.staleHooks && args.staleHooks.length > 0 ? { staleHooks: args.staleHooks } : {}),
    ...(args.missingMcpServers && args.missingMcpServers.length > 0
      ? { missingMcpServers: args.missingMcpServers }
      : {}),
  };
}
