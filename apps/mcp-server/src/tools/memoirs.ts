import { MEMOIR_RELATION_TYPES, type MemoirRelationType } from '@colony/storage';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type ToolContext, defaultWrapHandler } from './context.js';

const RELATION_TYPE_ENUM = z.enum(MEMOIR_RELATION_TYPES as readonly [string, ...string[]]);

/**
 * ICM-inspired knowledge-graph tools. Memoirs are named containers of
 * concepts (nodes) connected by typed relations (edges). Bodies route
 * through MemoryStore so the compression invariant holds. Search is
 * compact (progressive disclosure); inspect is full + neighbourhood.
 */
export function register(server: McpServer, ctx: ToolContext): void {
  const wrapHandler = ctx.wrapHandler ?? defaultWrapHandler;
  const { store } = ctx;

  server.tool(
    'memoir_create',
    'Create a named knowledge graph (memoir). Idempotent on name: re-creating an existing memoir returns the existing row. Use this once per coherent domain (e.g. "system-architecture", "auth-flow") before adding concepts.',
    {
      name: z.string().min(1),
      description: z.string().optional(),
      created_by: z.string().optional(),
    },
    wrapHandler('memoir_create', async ({ name, description, created_by }) => {
      const row = store.createMemoir({
        name,
        description: description ?? null,
        created_by: created_by ?? null,
      });
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    }),
  );

  server.tool(
    'memoir_list',
    'List existing memoirs in reverse chronological order. Use to discover what knowledge graphs exist before adding to or searching them.',
    { limit: z.number().int().positive().max(200).optional() },
    wrapHandler('memoir_list', async ({ limit }) => {
      const rows = store.listMemoirs(limit ?? 50);
      const compact = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        created_at: r.created_at,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(compact) }] };
    }),
  );

  server.tool(
    'memoir_add_concept',
    'Add a concept (graph node) to a memoir. Content runs through colony’s redact → compress pipeline before persistence, exactly like an observation. Labels are an array of "k:v" strings (e.g. ["domain:auth","type:service"]); search can filter on them. Confidence defaults to 1.0.',
    {
      memoir: z.string().min(1),
      name: z.string().min(1),
      content: z.string().min(1),
      labels: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).optional(),
    },
    wrapHandler('memoir_add_concept', async ({ memoir, name, content, labels, confidence }) => {
      const row = store.addMemoirConcept({
        memoir,
        name,
        content,
        ...(labels !== undefined ? { labels } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    }),
  );

  server.tool(
    'memoir_refine',
    'Refine an existing concept in-place. Concepts are permanent (no decay); use this to update the definition, labels, or confidence as understanding improves. To mark obsolete knowledge instead of deleting it, link a newer concept with relation "superseded_by".',
    {
      memoir: z.string().min(1),
      name: z.string().min(1),
      content: z.string().optional(),
      labels: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).optional(),
    },
    wrapHandler('memoir_refine', async ({ memoir, name, content, labels, confidence }) => {
      const row = store.refineMemoirConcept({
        memoir,
        name,
        ...(content !== undefined ? { content } : {}),
        ...(labels !== undefined ? { labels } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      });
      if (!row) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `concept "${name}" not found in memoir "${memoir}"` }),
            },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    }),
  );

  server.tool(
    'memoir_link',
    `Create a typed edge between two concepts. Relation must be one of: ${MEMOIR_RELATION_TYPES.join(', ')}. Self-links are rejected. (source, target, relation) is unique, so re-linking the same edge is a no-op.`,
    {
      memoir: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
      relation: RELATION_TYPE_ENUM,
      note: z.string().optional(),
    },
    wrapHandler('memoir_link', async ({ memoir, from, to, relation, note }) => {
      const row = store.linkMemoirConcepts({
        memoir,
        from,
        to,
        relation: relation as MemoirRelationType,
        ...(note !== undefined ? { note } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    }),
  );

  server.tool(
    'memoir_search',
    'FTS5 search over a memoir’s concepts. Returns compact hits (id, name, score, snippet, labels). Omit `memoir` to search across all memoirs. Use `memoir_inspect` to fetch the full body of a concept and its graph neighbourhood.',
    {
      memoir: z.string().optional(),
      query: z.string().min(1),
      label: z.string().optional(),
      limit: z.number().int().positive().max(50).optional(),
    },
    wrapHandler('memoir_search', async ({ memoir, query, label, limit }) => {
      const hits = store.searchMemoirConcepts({
        ...(memoir !== undefined ? { memoir } : {}),
        query,
        ...(label !== undefined ? { label } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(hits) }] };
    }),
  );

  server.tool(
    'memoir_inspect',
    'Show a concept’s full (expanded) body plus its BFS neighbourhood out to `depth` (default 1, max 5). Use after `memoir_search` returns interesting hits.',
    {
      memoir: z.string().min(1),
      name: z.string().min(1),
      depth: z.number().int().min(1).max(5).optional(),
      expand: z.boolean().optional(),
    },
    wrapHandler('memoir_inspect', async ({ memoir, name, depth, expand: expandOpt }) => {
      const result = store.inspectMemoirConcept({
        memoir,
        name,
        ...(depth !== undefined ? { depth } : {}),
        ...(expandOpt !== undefined ? { expand: expandOpt } : {}),
      });
      if (!result) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `concept "${name}" not found in memoir "${memoir}"` }),
            },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }),
  );
}
