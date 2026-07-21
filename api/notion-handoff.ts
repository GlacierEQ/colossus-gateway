import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { auditLedger } from '../src/bridge/audit.js';

const MAX_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;

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
    if (size > Math.ceil(MAX_BYTES * 4 / 3) + 64 * 1024) throw new Error('request_body_too_large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function decodePayload(input: any): { bytes: Buffer; parsed: any; sha256: string } {
  const expected = String(input?.connector_sha256 || '').toLowerCase();
  const encoded = String(input?.connector_content_base64 || '').replace(/\s+/g, '');
  if (!SHA256.test(expected)) throw new Error('invalid_connector_sha256');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('invalid_connector_base64');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('connector_payload_size_invalid');
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error('connector_sha256_mismatch');
  const parsed = JSON.parse(bytes.toString('utf8'));
  const results = Array.isArray(parsed) ? parsed : parsed?.results;
  if (!Array.isArray(results) || results.length > 50) throw new Error('connector_results_invalid');
  return { bytes, parsed: Array.isArray(parsed) ? { results: parsed } : parsed, sha256: actual };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-apex-capability, x-colossus-actor, x-request-id',
    });
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const startedAt = new Date().toISOString();
  const requestId = header(req, 'x-request-id') || crypto.randomUUID();
  const actor = header(req, 'x-colossus-actor') || 'approved-notion-connector';
  const source = 'https-function-call:approved-notion-connector-handoff';

  try {
    const input = await readBody(req);
    const query = String(input?.query || '').trim();
    const connectorSource = String(input?.connector_source || '').trim();
    if (!query || query.length > 500) throw new Error('query_invalid');
    if (!connectorSource || connectorSource.length > 200) throw new Error('connector_source_invalid');

    const verified = decodePayload(input);
    const authorized = await auditLedger.consumeCapability(
      header(req, 'x-apex-capability') || '',
      'notion_handoff',
      verified.sha256,
    );
    if (!authorized) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    await auditLedger.record({
      requestId,
      action: 'notion_handoff',
      status: 'started',
      actor,
      source,
      target: { provider: 'notion', query },
      arguments: { connector_source: connectorSource, sha256: verified.sha256, size: verified.bytes.length },
      startedAt,
    });

    const results = Array.isArray(verified.parsed) ? verified.parsed : verified.parsed.results;
    const completedAt = new Date().toISOString();
    const audit = await auditLedger.record({
      requestId,
      action: 'notion_handoff',
      status: 'succeeded',
      actor,
      source,
      target: { provider: 'notion', query },
      arguments: { connector_source: connectorSource, sha256: verified.sha256, size: verified.bytes.length },
      result: { result_count: results.length, sha256: verified.sha256 },
      startedAt,
      completedAt,
    });

    send(res, 200, {
      ok: true,
      request_id: requestId,
      connector: 'notion',
      connector_handoff: true,
      connector_source: connectorSource,
      query,
      result_count: results.length,
      sha256: verified.sha256,
      results,
      audit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const audit = await auditLedger.record({
      requestId,
      action: 'notion_handoff',
      status: 'failed',
      actor,
      source,
      error: message,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    send(res, 400, { ok: false, error: message, request_id: requestId, audit });
  }
}
