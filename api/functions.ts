import type { IncomingMessage, ServerResponse } from 'node:http';
import { TOOL_DEFINITIONS } from '../src/bridge/toolBridge.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify({ gateway: 'colossus-gateway', transport: 'https-function-calling', tools: TOOL_DEFINITIONS }, null, 2));
}
