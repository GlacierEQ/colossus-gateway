import type { IncomingMessage, ServerResponse } from 'node:http';
import { isToolCallAuthorized } from '../src/lib/requestAuth.js';

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    send(res, 405, { error: 'method_not_allowed' });
    return;
  }

  if (!isToolCallAuthorized(req.headers as Record<string, string | string[] | undefined>)) {
    send(res, 401, { error: 'unauthorized' });
    return;
  }

  send(res, 200, {
    provider: 'box',
    direct_access_token_configured: Boolean(process.env.BOX_ACCESS_TOKEN),
    keymaster_access_token_ref_configured: Boolean(process.env.BOX_ACCESS_TOKEN_REF),
    oauth_client_configured: Boolean(process.env.BOX_CLIENT_ID && process.env.BOX_CLIENT_SECRET),
    delegated_capability_supported: true,
    write_authorization_required: true,
  });
}
