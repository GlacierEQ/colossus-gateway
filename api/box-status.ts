import type { IncomingMessage, ServerResponse } from 'node:http';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({
    provider: 'box',
    direct_access_token_configured: Boolean(process.env.BOX_ACCESS_TOKEN),
    oauth_client_configured: Boolean(process.env.BOX_CLIENT_ID && process.env.BOX_CLIENT_SECRET),
    delegated_capability_supported: true,
    required_for_writes: 'BOX_ACCESS_TOKEN or x-box-access-token',
  }));
}
