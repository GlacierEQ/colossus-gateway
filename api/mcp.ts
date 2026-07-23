import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runBridgeContext } from '../src/bridge/context.js';
import { server } from '../src/server.js';

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function authorized(req: IncomingMessage): boolean {
  const expected = process.env.COLOSSUS_TOOL_KEY || process.env.COLOSSUS_KEY;
  if (!expected) return true;
  const supplied = header(req, 'authorization')?.replace(/^Bearer\s+/i, '') || header(req, 'x-colossus-key') || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'GET' && (req as any).url?.includes('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', gateway: 'colossus-gateway', version: '2.3.0', active_bridge: true, direct_notion_header_auth: true }));
    return;
  }

  if (!authorized(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  res.on('close', () => transport.close());
  await server.connect(transport);
  await runBridgeContext({
    boxAccessToken: header(req, 'x-box-access-token'),
    notionAccessToken: header(req, 'x-notion-token'),
    actor: header(req, 'x-colossus-actor') || 'mcp-client',
    requestId: header(req, 'x-request-id'),
    source: 'remote-mcp',
  }, () => transport.handleRequest(req, res));
}
