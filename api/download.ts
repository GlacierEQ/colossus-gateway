import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BoxClient } from '../src/bridge/boxClient.js';

function value(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

function authorized(req: IncomingMessage): boolean {
  const expected = process.env.COLOSSUS_TOOL_KEY || process.env.COLOSSUS_KEY;
  if (!expected) return false;
  const supplied = value(req, 'authorization')?.replace(/^Bearer\s+/i, '') || value(req, 'x-colossus-key') || '';
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const url = new URL(req.url || '/', 'https://colossus-gateway.invalid');
  const fileId = url.searchParams.get('file_id');
  if (!fileId) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'file_id is required' }));
    return;
  }
  try {
    const client = new BoxClient(value(req, 'x-box-access-token'));
    const result = await client.downloadRaw(fileId, 50 * 1024 * 1024);
    res.writeHead(200, {
      'content-type': result.contentType,
      'content-length': result.bytes.length,
      'content-disposition': `attachment; filename="${result.fileName.replace(/["\r\n]/g, '_')}"`,
      'x-content-sha256': result.sha256,
      'cache-control': 'private, no-store',
    });
    res.end(result.bytes);
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
