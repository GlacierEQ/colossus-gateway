import type { IncomingMessage, ServerResponse } from 'node:http';
import { authorizeRequest } from '../src/lib/operatorAuth.js';
import { executeNotionSearch } from '../src/tools/notionDirect.js';

const CANONICAL_ORIGIN = 'https://colossus-gateway.vercel.app';

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function responseHeaders(req: IncomingMessage) {
  const origin = header(req, 'origin');
  return {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...(origin === CANONICAL_ORIGIN ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
  };
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 32 * 1024) throw new Error('request_body_too_large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    const origin = header(req, 'origin');
    if (origin !== CANONICAL_ORIGIN) {
      res.writeHead(403, responseHeaders(req));
      res.end(JSON.stringify({ error: 'origin_not_allowed' }));
      return;
    }
    res.writeHead(204, {
      ...responseHeaders(req),
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, x-notion-token, x-request-id',
      'access-control-max-age': '600',
    });
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, responseHeaders(req));
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const auth = authorizeRequest(req.headers);
  if (!auth.authorized) {
    res.writeHead(401, { ...responseHeaders(req), 'www-authenticate': 'Bearer' });
    res.end(JSON.stringify({ error: auth.message }));
    return;
  }

  try {
    const input = await readBody(req);
    const query = typeof input?.arguments?.query === 'string' ? input.arguments.query.trim() : '';
    if (input?.name !== 'notion_search' || !query) {
      res.writeHead(400, responseHeaders(req));
      res.end(JSON.stringify({ error: 'body must contain name=notion_search and a non-empty arguments.query' }));
      return;
    }

    const result = await executeNotionSearch(
      {
        query,
        limit: Number.isInteger(input.arguments.limit) ? input.arguments.limit : 10,
      },
      {
        notionAccessToken: header(req, 'x-notion-token'),
        vercelOidcToken: header(req, 'x-vercel-oidc-token'),
        actor: auth.operatorId || 'https-notion-operator',
        requestId: header(req, 'x-request-id'),
        source: 'https-function-call:notion-direct',
      },
    );

    const status = result.ok ? 200 : result.error.status;
    res.writeHead(status, responseHeaders(req));
    res.end(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(message === 'request_body_too_large' ? 413 : 400, responseHeaders(req));
    res.end(JSON.stringify({ error: message }));
  }
}
