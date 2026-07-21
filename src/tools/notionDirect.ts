import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { auditLedger } from '../bridge/audit.js';
import { getBridgeContext, type BridgeRequestContext } from '../bridge/context.js';

export const NOTION_SEARCH_DEFINITION = {
  type: 'function' as const,
  name: 'notion_search',
  description: 'Search the authenticated Notion workspace directly using a per-request Notion integration token supplied through a protected request header.',
  strict: true as const,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['query', 'limit'],
  },
};

export async function executeNotionSearch(
  args: { query: string; limit?: number },
  context: BridgeRequestContext = {},
) {
  const requestId = context.requestId || crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const token = context.notionAccessToken;

  await auditLedger.record({
    requestId,
    action: 'notion_search',
    status: 'started',
    actor: context.actor,
    source: context.source,
    target: { provider: 'notion', query: args.query },
    arguments: { query: args.query, limit: args.limit || 10 },
    startedAt,
  });

  if (!token) {
    const audit = await auditLedger.record({
      requestId,
      action: 'notion_search',
      status: 'blocked',
      actor: context.actor,
      source: context.source,
      target: { provider: 'notion', query: args.query },
      arguments: { query: args.query, limit: args.limit || 10 },
      error: 'missing_notion_token',
      startedAt,
      completedAt: new Date().toISOString(),
    });
    return { ok: false as const, request_id: requestId, tool: 'notion_search', error: { status: 401, message: 'missing_notion_token' }, audit };
  }

  try {
    const results = await auditLedger.retrieveNotion(args.query, args.limit || 10, token);
    const audit = await auditLedger.record({
      requestId,
      action: 'notion_search',
      status: 'succeeded',
      actor: context.actor,
      source: context.source,
      target: { provider: 'notion', query: args.query },
      arguments: { query: args.query, limit: args.limit || 10 },
      result: { result_count: results.length, results },
      startedAt,
      completedAt: new Date().toISOString(),
    });
    return { ok: true as const, request_id: requestId, tool: 'notion_search', result: { query: args.query, result_count: results.length, results }, audit };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const audit = await auditLedger.record({
      requestId,
      action: 'notion_search',
      status: 'failed',
      actor: context.actor,
      source: context.source,
      target: { provider: 'notion', query: args.query },
      arguments: { query: args.query, limit: args.limit || 10 },
      error: message,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    return { ok: false as const, request_id: requestId, tool: 'notion_search', error: { status: 502, message }, audit };
  }
}

export function registerNotionDirectTools(server: McpServer) {
  server.tool(
    'notion_search',
    'Search the authenticated Notion workspace directly. Configure the MCP connection with an x-notion-token secret header.',
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(10),
    },
    async (args) => {
      const result = await executeNotionSearch(args, { ...getBridgeContext(), source: 'mcp:notion-direct' });
      return {
        isError: !result.ok,
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
