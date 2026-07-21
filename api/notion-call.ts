import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeNotionSearch } from '../src/tools/notionDirect.js';

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 256 * 1024) throw new Error('request_body_too_large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-notion-token, x-colossus-actor, x-request-id',
      'cache-control': 'no-store',
    });
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  try {
    const input = await readBody(req);
    if (input?.name !== 'notion_search' || !input.arguments || typeof input.arguments.query !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'body must contain name=notion_search and arguments.query' }));
      return;
    }

    const result = await executeNotionSearch(
      {
        query: input.arguments.query,
        limit: Number.isInteger(input.arguments.limit) ? input.arguments.limit : 10,
      },
      {
        notionAccessToken: header(req, 'x-notion-token'),
        actor: header(req, 'x-colossus-actor') || 'https-notion-client',
        requestId: header(req, 'x-request-id'),
        source: 'https-function-call:notion-direct',
      },
    );

    const status = result.ok ? 200 : result.error.status;
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
