import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeTool } from '../src/bridge/toolBridge.js';

const DELEGATED_MAX_BYTES = 1024 * 1024;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function authorized(req: IncomingMessage): boolean {
  const expected = process.env.COLOSSUS_TOOL_KEY || process.env.COLOSSUS_KEY;
  if (!expected) return process.env.ALLOW_UNAUTHENTICATED_TOOL_CALLS === 'true';
  const bearer = header(req, 'authorization')?.replace(/^Bearer\s+/i, '') || header(req, 'x-colossus-key') || '';
  const a = Buffer.from(bearer);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function delegatedCapabilityRead(input: any): boolean {
  if (!input || !['box_get', 'box_download'].includes(input.name) || !input.arguments || typeof input.arguments !== 'object') return false;
  const capability = input.arguments.delegated_download_url;
  if (typeof capability !== 'string') return false;
  try {
    const url = new URL(capability);
    const boxHost = /(^|\.)boxcloud\.com$/.test(url.hostname) || /(^|\.)box\.com$/.test(url.hostname);
    const maxBytes = Number(input.arguments.max_bytes ?? DELEGATED_MAX_BYTES);
    return url.protocol === 'https:' && boxHost && Number.isFinite(maxBytes) && maxBytes > 0 && maxBytes <= DELEGATED_MAX_BYTES;
  } catch {
    return false;
  }
}

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 25 * 1024 * 1024) throw new Error('request_body_too_large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, x-box-access-token, x-colossus-actor, x-request-id',
    });
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  try {
    const input = await body(req);
    if (typeof input.name !== 'string' || !input.arguments || typeof input.arguments !== 'object') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'body must contain name and arguments' }));
      return;
    }
    const delegatedRead = delegatedCapabilityRead(input);
    if (!authorized(req) && !delegatedRead) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (delegatedRead) {
      const requested = Number(input.arguments.max_bytes ?? DELEGATED_MAX_BYTES);
      input.arguments.max_bytes = Math.min(requested, DELEGATED_MAX_BYTES);
    }

    const result = await executeTool(input.name, input.arguments, {
      boxAccessToken: header(req, 'x-box-access-token'),
      actor: header(req, 'x-colossus-actor') || (delegatedRead ? 'box-delegated-capability' : 'https-client'),
      requestId: header(req, 'x-request-id'),
      source: delegatedRead ? 'https-function-call:delegated-box-capability' : 'https-function-call',
    });
    const failure = result.ok ? undefined : result.error;
    res.writeHead(result.ok ? 200 : (failure?.status || 500), {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
