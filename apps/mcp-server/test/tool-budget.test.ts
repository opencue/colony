import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countTokens } from '@colony/compress';
import { defaultSettings } from '@colony/config';
import { MemoryStore } from '@colony/core';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

// Every registered tool's name + description + input schema is injected into
// every connected agent session's context. These budgets are the regression
// guard for that cost: they sit ~10% above the measured baseline so genuine
// additions force a deliberate bump here instead of silent context creep.
// Measured baseline 2026-06-12: lean ~3,810 tokens (20 tools), full ~13,658
// (79 tools). Budgets sit ~10% above so additions force a deliberate bump.
const LEAN_BUDGET_TOKENS = 4_200;
const FULL_BUDGET_TOKENS = 15_000;
// 540 accommodates attention_inbox, whose description carries eight
// test-pinned routing phrases (see message-descriptions.test.ts).
const DESCRIPTION_CHAR_CAP = 540;

interface ListedTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

async function listTools(profile: 'lean' | 'full'): Promise<ListedTool[]> {
  const dir = mkdtempSync(join(tmpdir(), `colony-mcp-budget-${profile}-`));
  const store = new MemoryStore({ dbPath: join(dir, 'data.db'), settings: defaultSettings });
  const server = buildServer(store, defaultSettings, { toolProfile: profile });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'budget-test', version: '0.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    return tools as ListedTool[];
  } finally {
    await client.close();
    await server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function registrationTokens(tools: ListedTool[]): number {
  return tools.reduce(
    (sum, tool) =>
      sum +
      countTokens(`${tool.name} ${tool.description ?? ''} ${JSON.stringify(tool.inputSchema)}`),
    0,
  );
}

describe('tool registration token budget', () => {
  it(`lean profile registration surface stays under ${LEAN_BUDGET_TOKENS} tokens`, async () => {
    const tools = await listTools('lean');
    const total = registrationTokens(tools);
    console.info(`[tool-budget] lean: ${tools.length} tools, ~${total} tokens`);
    expect(total).toBeLessThanOrEqual(LEAN_BUDGET_TOKENS);
  });

  it(`full profile registration surface stays under ${FULL_BUDGET_TOKENS} tokens`, async () => {
    const tools = await listTools('full');
    const total = registrationTokens(tools);
    console.info(`[tool-budget] full: ${tools.length} tools, ~${total} tokens`);
    expect(total).toBeLessThanOrEqual(FULL_BUDGET_TOKENS);
  });

  it(`no tool description exceeds ${DESCRIPTION_CHAR_CAP} chars`, async () => {
    const tools = await listTools('full');
    const offenders = tools
      .filter((t) => (t.description ?? '').length > DESCRIPTION_CHAR_CAP)
      .map((t) => `${t.name} (${(t.description ?? '').length})`);
    expect(offenders).toEqual([]);
  });
});
