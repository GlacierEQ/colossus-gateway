import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeTool } from '../src/bridge/toolBridge.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  const result = await executeTool('dropbox_to_box_native', {
    dropbox_id_or_path: 'id:Y9nAiJXSq-oAAAAAAABtDQ',
    box_parent_folder_id: '423686938856',
    file_name: 'cherry NEX 6.m4a',
    content_type: 'audio/mp4',
  }, {
    actor: 'operator-authorized-one-shot-native-evidence-migration',
    source: 'one-shot-fixed-route',
  });
  res.writeHead(result.ok ? 200 : 500, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(result));
}
