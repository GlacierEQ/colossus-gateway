import type { IncomingMessage, ServerResponse } from 'node:http';
import { TOOL_DEFINITIONS } from '../src/bridge/toolBridge.js';
import { NOTION_SEARCH_DEFINITION } from '../src/tools/notionDirect.js';
import { isToolCallAuthorized } from '../src/lib/requestAuth.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  if (!isToolCallAuthorized(req.headers as Record<string, string | string[] | undefined>)) {
    res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify({
    gateway: 'colossus-gateway',
    transport: 'https-function-calling',
    tools: [...TOOL_DEFINITIONS, NOTION_SEARCH_DEFINITION],
  }, null, 2));
}
