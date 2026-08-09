import type { IncomingMessage, ServerResponse } from 'node:http';
import { TOOL_DEFINITIONS } from '../src/bridge/toolBridge.js';
import { NOTION_SEARCH_DEFINITION } from '../src/tools/notionDirect.js';
// @ts-expect-error Exact proof host module is intentionally JavaScript to preserve executable source boundaries.
import { runMergeAuthorityOperabilityProof } from '../src/proof/operable-handler.mjs';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'https://colossus-gateway.invalid');
  if (url.searchParams.get('proof') === 'merge-authority-operable') {
    return runMergeAuthorityOperabilityProof(req, res);
  }

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
  res.end(JSON.stringify({
    gateway: 'colossus-gateway',
    transport: 'https-function-calling',
    tools: [...TOOL_DEFINITIONS, NOTION_SEARCH_DEFINITION],
  }, null, 2));
}
