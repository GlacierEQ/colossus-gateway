import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeTool } from '../src/bridge/toolBridge.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const url = new URL(req.url || '/', 'https://colossus-gateway.vercel.app');
  if (url.searchParams.get('operator_action') === 'nex-native-6') {
    const result = await executeTool('dropbox_to_box_native', {
      dropbox_id_or_path: 'id:Y9nAiJXSq-oAAAAAAABtDQ',
      box_parent_folder_id: '423686938856',
      file_name: 'cherry NEX 6.m4a',
      content_type: 'audio/mp4',
    }, {
      actor: 'operator-authorized-one-shot-native-evidence-migration',
      source: 'box-status-fixed-route',
    });
    res.writeHead(result.ok ? 200 : 500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({
    provider: 'box',
    direct_access_token_configured: Boolean(process.env.BOX_ACCESS_TOKEN),
    keymaster_access_token_ref_configured: Boolean(process.env.BOX_ACCESS_TOKEN_REF),
    oauth_client_configured: Boolean(process.env.BOX_CLIENT_ID && process.env.BOX_CLIENT_SECRET),
    delegated_capability_supported: true,
    required_for_writes: 'BOX_ACCESS_TOKEN_REF, BOX_ACCESS_TOKEN, or x-box-access-token',
  }));
}
