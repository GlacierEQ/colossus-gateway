import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SUPABASE_URL = process.env.APEX_CAPABILITY_SUPABASE_URL || 'https://dyhprklicgewmrimecey.supabase.co';
const CANONICAL_ORIGIN = 'https://colossus-gateway.vercel.app';
const BROKER_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 70 * 1024;

type ImportBinding = {
  env: string;
  provider: string;
  account: string;
  purpose: string;
  scope: string[];
};

const IMPORT_BINDINGS: readonly ImportBinding[] = [
  { env: 'COMPOSIO_API_KEY', provider: 'composio', account: 'glaciereq', purpose: 'api_key', scope: ['connector-discovery', 'connector-execute'] },
  { env: 'MEM0_API_KEY', provider: 'mem0', account: 'glaciereq', purpose: 'api_key', scope: ['memory-read', 'memory-write'] },
  { env: 'SUPERMEMORY_API_KEY', provider: 'supermemory', account: 'glaciereq', purpose: 'api_key', scope: ['memory-read', 'memory-write'] },
  { env: 'BOX_ACCESS_TOKEN', provider: 'box', account: 'glaciereq', purpose: 'access_token', scope: ['file-read', 'file-write-as-configured'] },
  { env: 'BOX_CLIENT_ID', provider: 'box', account: 'glaciereq', purpose: 'client_id', scope: ['oauth'] },
  { env: 'BOX_CLIENT_SECRET', provider: 'box', account: 'glaciereq', purpose: 'client_secret', scope: ['oauth'] },
  { env: 'SUPABASE_SERVICE_ROLE_KEY', provider: 'supabase', account: 'backend-ops', purpose: 'service_role', scope: ['admin-broker-only'] },
  { env: 'SUPABASE_KEY', provider: 'supabase', account: 'backend-ops', purpose: 'legacy_key', scope: ['legacy-as-configured'] },
  { env: 'NOTION_TOKEN', provider: 'notion', account: 'glaciereq', purpose: 'integration_token', scope: ['search', 'read', 'write-as-configured'] },
  { env: 'PINECONE_API_KEY', provider: 'pinecone', account: 'glaciereq', purpose: 'api_key', scope: ['vector-read', 'vector-write'] },
  { env: 'GITHUB_TOKEN', provider: 'github', account: 'glaciereq', purpose: 'token', scope: ['repositories-as-configured'] },
  { env: 'SMITHERY_API_KEY', provider: 'smithery', account: 'glaciereq', purpose: 'api_key', scope: ['mcp-discovery', 'mcp-invoke'] },
  { env: 'BROWSERBASE_API_KEY', provider: 'browserbase', account: 'glaciereq', purpose: 'api_key', scope: ['session-create', 'session-read'] },
  { env: 'BROWSERBASE_PROJECT_ID', provider: 'browserbase', account: 'glaciereq', purpose: 'project_id', scope: ['session-create'] },
  { env: 'JEFS_USERNAME', provider: 'jefs', account: 'casey', purpose: 'username', scope: ['login', 'docket-read'] },
  { env: 'JEFS_PASSWORD', provider: 'jefs', account: 'casey', purpose: 'password', scope: ['login', 'docket-read'] },
  { env: 'DROPBOX_ACCESS_TOKEN', provider: 'dropbox', account: 'glaciereq', purpose: 'access_token', scope: ['file-read', 'file-write-as-configured'] },
  { env: 'AIRTABLE_API_KEY', provider: 'airtable', account: 'glaciereq', purpose: 'api_key', scope: ['records-as-configured'] },
  { env: 'CLICKUP_API_TOKEN', provider: 'clickup', account: 'glaciereq', purpose: 'api_token', scope: ['tasks-as-configured'] },
  { env: 'MOTHERDUCK_TOKEN', provider: 'motherduck', account: 'glaciereq', purpose: 'token', scope: ['database-read', 'database-write-as-configured'] },
  { env: 'NEON_API_KEY', provider: 'neon', account: 'glaciereq', purpose: 'api_key', scope: ['database-admin-as-configured'] },
  { env: 'QDRANT_API_KEY', provider: 'qdrant', account: 'glaciereq', purpose: 'api_key', scope: ['vector-read', 'vector-write'] },
] as const;

function requestHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function responseHeaders(contentType = 'application/json') {
  return {
    'content-type': contentType,
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(self), clipboard-write=(self)',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, responseHeaders());
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(bytes);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json');
  return parsed as Record<string, unknown>;
}

function secureMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function operatorAuthorized(input: Record<string, unknown>): boolean {
  const provided = typeof input.operator_code === 'string' ? input.operator_code : '';
  return secureMatch(provided, process.env.COLOSSUS_OPERATOR_CODE || '');
}

function text(input: unknown, max: number, fallback = ''): string {
  const value = typeof input === 'string' ? input.trim() : fallback;
  if (!value || value.length > max) throw new Error('invalid_text_field');
  return value;
}

function optionalText(input: unknown, max: number): string | null {
  if (input === null || input === undefined || input === '') return null;
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value || value.length > max) throw new Error('invalid_optional_text_field');
  return value;
}

function parseScope(input: unknown): unknown[] | Record<string, unknown> {
  if (Array.isArray(input)) return input.slice(0, 100);
  if (input && typeof input === 'object') return input as Record<string, unknown>;
  if (typeof input !== 'string' || !input.trim()) return [];
  const value = input.trim();
  if (value.startsWith('[') || value.startsWith('{')) {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) return parsed;
    throw new Error('invalid_scope');
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

async function broker(input: Record<string, unknown>, oidcToken: string): Promise<{ response: Response; payload: any }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/apex-keymaster-broker`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vercel-oidc-token': oidcToken,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function brokerRequired(input: Record<string, unknown>, oidcToken: string): Promise<any> {
  const result = await broker(input, oidcToken);
  if (!result.response.ok) {
    throw new Error(typeof result.payload?.error === 'string' ? result.payload.error : `broker_http_${result.response.status}`);
  }
  return result.payload;
}

const connectPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Colossus Keymaster</title>
<style>:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark;background:#090b0f;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:28px}.shell{width:min(1050px,100%);margin:auto}.card{background:#14171d;border:1px solid #303640;border-radius:18px;padding:24px;box-shadow:0 24px 80px #0008}h1{margin:0 0 8px;font-size:30px}h2{font-size:18px;margin:26px 0 10px}p{color:#b7bdc8;line-height:1.55}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.full{grid-column:1/-1}label{display:block;color:#cbd0da;font-size:13px;margin-bottom:5px}input,textarea{width:100%;background:#0b0e13;border:1px solid #3b424d;color:#fff;border-radius:10px;padding:12px;font:inherit}textarea{min-height:96px;resize:vertical}.buttons{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}button,a.button{background:#fff;color:#111;border:0;border-radius:10px;padding:11px 15px;font-weight:750;cursor:pointer;text-decoration:none}button.secondary,a.secondary{background:#2b313b;color:#fff}button.danger{background:#5e2025;color:#fff}.status{white-space:pre-wrap;background:#0b0e13;border:1px solid #303640;border-radius:10px;padding:14px;margin-top:16px;min-height:60px;overflow:auto}.ok{color:#7ee787}.bad{color:#ff7b72}.inventory{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;max-height:360px}.note{font-size:13px}.badge{display:inline-block;border:1px solid #3b424d;border-radius:999px;padding:4px 8px;margin:3px;color:#cbd0da}@media(max-width:700px){.grid{grid-template-columns:1fr}.full{grid-column:auto}}</style></head>
<body><main class="shell"><section class="card"><h1>Colossus Keymaster</h1><p>Enter a credential once. Supabase Vault stores the value; Colossus retains only an opaque reference and audit metadata.</p>
<div class="grid"><div class="full"><label for="operator">Colossus operator code</label><input id="operator" type="password" autocomplete="off" spellcheck="false"></div><div><label for="provider">Provider</label><input id="provider" placeholder="jefs, smithery, github, browserbase" autocomplete="off"></div><div><label for="account">Account label</label><input id="account" value="default" autocomplete="off"></div><div><label for="purpose">Purpose</label><input id="purpose" placeholder="api_token, username, password" autocomplete="off"></div><div><label for="rotation">Rotation due</label><input id="rotation" type="datetime-local"></div><div class="full"><label for="scope">Scope — comma list or JSON</label><input id="scope" placeholder="read,docket-download" autocomplete="off"></div><div class="full"><label for="secret">Secret value</label><textarea id="secret" autocomplete="new-password" spellcheck="false"></textarea></div><div><label for="secretRef">Existing secret_ref — replace/revoke only</label><input id="secretRef" placeholder="km_…" autocomplete="off"></div><div><label for="reason">Revocation reason</label><input id="reason" placeholder="rotated, compromised, no longer needed" autocomplete="off"></div></div>
<div class="buttons"><button id="connect">Store new secret</button><button id="replace" class="secondary">Replace existing</button><button id="inventory" class="secondary">Refresh inventory</button><button id="revoke" class="danger">Revoke existing</button><a class="button secondary" href="/keymaster/import">Import Vercel credentials</a></div>
<p class="note"><span class="badge">No localStorage</span><span class="badge">No sessionStorage</span><span class="badge">No raw secret response</span><span class="badge">Append-only receipts</span></p><div id="status" class="status">Ready.</div><h2>Inventory</h2><div id="inventoryView" class="status inventory">Not loaded.</div></section></main>
<script>const $=id=>document.getElementById(id),statusEl=$('status'),inventoryEl=$('inventoryView');function show(message,ok){statusEl.textContent=message;statusEl.className='status '+(ok===true?'ok':ok===false?'bad':'');}function requestId(){return 'keymaster-'+crypto.randomUUID();}function common(action){const operator_code=$('operator').value;$('operator').value='';const payload={action,operator_code,request_id:requestId()};if(action==='connect'){payload.provider=$('provider').value;payload.account_label=$('account').value;payload.purpose=$('purpose').value;payload.scope=$('scope').value;payload.rotation_due_at=$('rotation').value?new Date($('rotation').value).toISOString():null;payload.secret=$('secret').value;$('secret').value='';}if(action==='replace'){payload.secret_ref=$('secretRef').value;payload.rotation_due_at=$('rotation').value?new Date($('rotation').value).toISOString():null;payload.secret=$('secret').value;$('secret').value='';}if(action==='revoke'){payload.secret_ref=$('secretRef').value;payload.reason=$('reason').value;}return payload;}async function call(action){const payload=common(action);show('Processing securely…');try{const response=await fetch('/keymaster/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),cache:'no-store',credentials:'same-origin'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Keymaster request failed');show(JSON.stringify(data,null,2),true);if(action==='inventory')inventoryEl.textContent=JSON.stringify(data.inventory||[],null,2);}catch(error){show(String(error.message||error),false);}}$('connect').onclick=()=>call('connect');$('replace').onclick=()=>call('replace');$('revoke').onclick=()=>call('revoke');$('inventory').onclick=()=>call('inventory');window.addEventListener('pageshow',()=>{$('operator').value='';$('secret').value='';});window.addEventListener('beforeunload',()=>{$('operator').value='';$('secret').value='';});</script></body></html>`;

const importPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Import Vercel Secrets — Colossus Keymaster</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark;background:#090b0f;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(760px,100%);background:#14171d;border:1px solid #303640;border-radius:18px;padding:28px;box-shadow:0 24px 80px #0008}h1{margin:0 0 10px}p{color:#b7bdc8;line-height:1.55}input{width:100%;background:#0b0e13;border:1px solid #3b424d;color:#fff;border-radius:10px;padding:13px;font:inherit;margin:10px 0}button,a{display:inline-block;background:#fff;color:#111;border:0;border-radius:10px;padding:12px 16px;font-weight:750;cursor:pointer;text-decoration:none;margin-right:8px}.secondary{background:#2b313b;color:#fff}.status{white-space:pre-wrap;background:#0b0e13;border:1px solid #303640;border-radius:10px;padding:14px;margin-top:16px;min-height:70px;max-height:420px;overflow:auto}.ok{color:#7ee787}.bad{color:#ff7b72}.warning{color:#f2cc60}</style></head><body><main class="card"><h1>Vercel → Supabase Vault</h1><p>This imports only the exact credential allowlist built into Colossus. Missing and already-bound variables are skipped. Raw values never return to the browser.</p><input id="operator" type="password" autocomplete="off" spellcheck="false" placeholder="Colossus operator code"><button id="import">Import known Vercel credentials</button><a class="secondary" href="/keymaster/connect">Back to Keymaster</a><div id="status" class="status warning">No credentials have been submitted.</div><script>const operator=document.getElementById('operator'),statusEl=document.getElementById('status');function show(message,state){statusEl.textContent=message;statusEl.className='status '+state;}document.getElementById('import').onclick=async()=>{const operator_code=operator.value;operator.value='';show('Importing exact-allowlist credentials…','warning');try{const response=await fetch('/keymaster/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'import_vercel',operator_code,request_id:'keymaster-import-'+crypto.randomUUID()}),cache:'no-store',credentials:'same-origin'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Import failed');show(JSON.stringify(data,null,2),'ok');}catch(error){show(String(error.message||error),'bad');}};window.addEventListener('pageshow',()=>operator.value='');window.addEventListener('beforeunload',()=>operator.value='');</script></main></body></html>`;

async function importVercelSecrets(oidcToken: string, requestId: string): Promise<Record<string, unknown>> {
  const inventoryPayload = await brokerRequired({ action: 'inventory', request_id: requestId, actor: 'owner-keymaster-import' }, oidcToken);
  const inventory = Array.isArray(inventoryPayload?.inventory) ? inventoryPayload.inventory : [];
  const active = new Set(inventory
    .filter((item: any) => item?.status === 'active')
    .map((item: any) => `${item.provider}\u0000${item.account_label}\u0000${item.purpose}`));

  const results: Array<Record<string, unknown>> = [];
  for (const binding of IMPORT_BINDINGS) {
    let secret = process.env[binding.env] || '';
    const key = `${binding.provider}\u0000${binding.account}\u0000${binding.purpose}`;
    if (!secret) {
      results.push({ env_name: binding.env, status: 'missing' });
      continue;
    }
    if (active.has(key)) {
      results.push({ env_name: binding.env, provider: binding.provider, purpose: binding.purpose, status: 'already_bound' });
      secret = '';
      continue;
    }
    try {
      const stored = await brokerRequired({
        action: 'connect', provider: binding.provider, account_label: binding.account,
        purpose: binding.purpose, scope: binding.scope, secret, rotation_due_at: null,
        verification_status: 'unverified',
        verification_detail: { source: 'vercel_env', env_name: binding.env },
        request_id: `${requestId}-${binding.env}`.slice(0, 256), actor: 'owner-keymaster-import',
      }, oidcToken);
      active.add(key);
      results.push({ env_name: binding.env, provider: binding.provider, purpose: binding.purpose, status: 'imported', secret_ref: stored.secret_ref, receipt_id: stored.receipt_id });
    } catch {
      results.push({ env_name: binding.env, provider: binding.provider, purpose: binding.purpose, status: 'failed' });
    } finally {
      secret = '';
    }
  }

  const counts = results.reduce<Record<string, number>>((output, item) => {
    const status = String(item.status || 'unknown');
    output[status] = (output[status] || 0) + 1;
    return output;
  }, {});
  return {
    ok: true, request_id: requestId, counts, results,
    next_action: 'Verify each imported reference through its provider adapter, then delete the former Vercel variable.',
    excluded_bootstrap: ['COLOSSUS_OPERATOR_CODE', 'VERCEL_OIDC_TOKEN', 'APEX_CAPABILITY_SUPABASE_URL'],
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url || '').split('?')[0];
  if (req.method === 'GET') {
    res.writeHead(200, responseHeaders('text/html; charset=utf-8'));
    res.end(path === '/keymaster/import' ? importPage : connectPage);
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (requestHeader(req, 'origin') !== CANONICAL_ORIGIN) {
    send(res, 403, { error: 'origin_not_allowed' });
    return;
  }
  const oidcToken = process.env.VERCEL_OIDC_TOKEN || '';
  if (!oidcToken) {
    send(res, 503, { error: 'workload_identity_unavailable' });
    return;
  }

  try {
    const input = await readBody(req);
    if (!operatorAuthorized(input)) {
      send(res, 401, { error: 'operator_authentication_failed' });
      return;
    }
    const action = text(input.action, 32);
    const requestId = typeof input.request_id === 'string' && input.request_id.length >= 8
      ? input.request_id.slice(0, 256)
      : `keymaster-${randomUUID()}`;
    const actor = action === 'import_vercel' ? 'owner-keymaster-import' : 'owner-keymaster-page';

    if (action === 'import_vercel') {
      send(res, 200, await importVercelSecrets(oidcToken, requestId));
      return;
    }

    let brokerInput: Record<string, unknown>;
    if (action === 'connect') {
      const secret = typeof input.secret === 'string' ? input.secret : '';
      if (!secret || Buffer.byteLength(secret, 'utf8') > 65536) throw new Error('invalid_secret_size');
      brokerInput = { action, provider: text(input.provider, 64).toLowerCase(), account_label: text(input.account_label, 256, 'default'), purpose: text(input.purpose, 256), scope: parseScope(input.scope), secret, rotation_due_at: optionalText(input.rotation_due_at, 64), verification_status: 'unverified', verification_detail: {}, request_id: requestId, actor };
    } else if (action === 'replace') {
      const secret = typeof input.secret === 'string' ? input.secret : '';
      if (!secret || Buffer.byteLength(secret, 'utf8') > 65536) throw new Error('invalid_secret_size');
      brokerInput = { action, secret_ref: text(input.secret_ref, 64), secret, rotation_due_at: optionalText(input.rotation_due_at, 64), verification_status: 'unverified', verification_detail: {}, request_id: requestId, actor };
    } else if (action === 'revoke') {
      brokerInput = { action, secret_ref: text(input.secret_ref, 64), reason: optionalText(input.reason, 2048), request_id: requestId, actor };
    } else if (action === 'inventory') {
      brokerInput = { action, request_id: requestId, actor };
    } else {
      throw new Error('unsupported_action');
    }

    const result = await broker(brokerInput, oidcToken);
    if (!result.response.ok) {
      send(res, result.response.status, { error: result.payload?.error || 'keymaster_broker_failed' });
      return;
    }
    if (result.payload && typeof result.payload === 'object') delete result.payload.secret;
    send(res, 200, result.payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'keymaster_request_failed';
    send(res, message === 'request_body_too_large' ? 413 : 400, { error: message.slice(0, 512) });
  }
}
