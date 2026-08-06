import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SUPABASE_URL = process.env.APEX_CAPABILITY_SUPABASE_URL || 'https://dyhprklicgewmrimecey.supabase.co';
const CANONICAL_ORIGIN = 'https://colossus-gateway.vercel.app';
const BROKER_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 70 * 1024;

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
  const expected = process.env.COLOSSUS_OPERATOR_CODE || '';
  return secureMatch(provided, expected);
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

async function broker(input: Record<string, unknown>, oidcToken: string) {
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

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Colossus Keymaster</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark;background:#090b0f;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:28px}.shell{width:min(1050px,100%);margin:auto}.card{background:#14171d;border:1px solid #303640;border-radius:18px;padding:24px;box-shadow:0 24px 80px #0008}h1{margin:0 0 8px;font-size:30px}h2{font-size:18px;margin:26px 0 10px}p{color:#b7bdc8;line-height:1.55}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.full{grid-column:1/-1}label{display:block;color:#cbd0da;font-size:13px;margin-bottom:5px}input,textarea,select{width:100%;background:#0b0e13;border:1px solid #3b424d;color:#fff;border-radius:10px;padding:12px;font:inherit}textarea{min-height:96px;resize:vertical}.buttons{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}button{background:#fff;color:#111;border:0;border-radius:10px;padding:11px 15px;font-weight:750;cursor:pointer}button.secondary{background:#2b313b;color:#fff}button.danger{background:#5e2025;color:#fff}.status{white-space:pre-wrap;background:#0b0e13;border:1px solid #303640;border-radius:10px;padding:14px;margin-top:16px;min-height:60px;overflow:auto}.ok{color:#7ee787}.bad{color:#ff7b72}.inventory{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;max-height:360px}.note{font-size:13px}.badge{display:inline-block;border:1px solid #3b424d;border-radius:999px;padding:4px 8px;margin:3px;color:#cbd0da}@media(max-width:700px){.grid{grid-template-columns:1fr}.full{grid-column:auto}}
</style>
</head>
<body><main class="shell"><section class="card">
<h1>Colossus Keymaster</h1>
<p>Enter a credential once. The browser clears the operator code and secret before transmission completes. Supabase Vault stores the secret; Colossus retains only an opaque reference and audit metadata.</p>
<div class="grid">
<div class="full"><label for="operator">Colossus operator code</label><input id="operator" type="password" autocomplete="off" spellcheck="false"></div>
<div><label for="provider">Provider</label><input id="provider" placeholder="jefs, smithery, github, browserbase" autocomplete="off"></div>
<div><label for="account">Account label</label><input id="account" value="default" autocomplete="off"></div>
<div><label for="purpose">Purpose</label><input id="purpose" placeholder="api_token, username, password, oauth_refresh_token" autocomplete="off"></div>
<div><label for="rotation">Rotation due</label><input id="rotation" type="datetime-local"></div>
<div class="full"><label for="scope">Scope — comma list or JSON</label><input id="scope" placeholder="read,docket-download or [\"read\",\"write\"]" autocomplete="off"></div>
<div class="full"><label for="secret">Secret value</label><textarea id="secret" autocomplete="new-password" spellcheck="false"></textarea></div>
<div><label for="secretRef">Existing secret_ref — replace/revoke only</label><input id="secretRef" placeholder="km_…" autocomplete="off"></div>
<div><label for="reason">Revocation reason</label><input id="reason" placeholder="rotated, compromised, no longer needed" autocomplete="off"></div>
</div>
<div class="buttons"><button id="connect">Store new secret</button><button id="replace" class="secondary">Replace existing</button><button id="inventory" class="secondary">Refresh inventory</button><button id="revoke" class="danger">Revoke existing</button></div>
<p class="note"><span class="badge">No localStorage</span><span class="badge">No sessionStorage</span><span class="badge">No raw secret response</span><span class="badge">Append-only receipts</span></p>
<div id="status" class="status">Ready.</div>
<h2>Inventory</h2><div id="inventoryView" class="status inventory">Not loaded.</div>
</section></main>
<script>
const $=id=>document.getElementById(id);
const statusEl=$('status');
const inventoryEl=$('inventoryView');
function show(message,ok){statusEl.textContent=message;statusEl.className='status '+(ok===true?'ok':ok===false?'bad':'');}
function requestId(){return 'keymaster-'+crypto.randomUUID();}
function common(action){
  const operator_code=$('operator').value;
  $('operator').value='';
  const payload={action,operator_code,request_id:requestId()};
  if(action==='connect'){
    payload.provider=$('provider').value;payload.account_label=$('account').value;payload.purpose=$('purpose').value;payload.scope=$('scope').value;payload.rotation_due_at=$('rotation').value?new Date($('rotation').value).toISOString():null;payload.secret=$('secret').value;
    $('secret').value='';
  }
  if(action==='replace'){
    payload.secret_ref=$('secretRef').value;payload.rotation_due_at=$('rotation').value?new Date($('rotation').value).toISOString():null;payload.secret=$('secret').value;
    $('secret').value='';
  }
  if(action==='revoke'){payload.secret_ref=$('secretRef').value;payload.reason=$('reason').value;}
  return payload;
}
async function call(action){
  const payload=common(action);
  show('Processing securely…');
  try{
    const response=await fetch('/keymaster/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),cache:'no-store',credentials:'same-origin'});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Keymaster request failed');
    show(JSON.stringify(data,null,2),true);
    if(action!=='inventory')await loadInventory();
    else renderInventory(data.inventory||[]);
  }catch(error){show(String(error.message||error),false);}
}
function renderInventory(items){inventoryEl.textContent=JSON.stringify(items,null,2);}
async function loadInventory(){
  const operator_code=$('operator').value;
  if(!operator_code){inventoryEl.textContent='Enter the operator code, then press Refresh inventory.';return;}
  $('operator').value='';
  try{
    const response=await fetch('/keymaster/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'inventory',operator_code,request_id:requestId()}),cache:'no-store',credentials:'same-origin'});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Inventory failed');
    renderInventory(data.inventory||[]);
  }catch(error){inventoryEl.textContent=String(error.message||error);}
}
$('connect').onclick=()=>call('connect');
$('replace').onclick=()=>call('replace');
$('revoke').onclick=()=>call('revoke');
$('inventory').onclick=()=>call('inventory');
window.addEventListener('pageshow',()=>{$('operator').value='';$('secret').value='';});
window.addEventListener('beforeunload',()=>{$('operator').value='';$('secret').value='';});
</script></body></html>`;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'GET') {
    res.writeHead(200, responseHeaders('text/html; charset=utf-8'));
    res.end(page);
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

  const oidcToken = requestHeader(req, 'x-vercel-oidc-token') || '';
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
    const request_id = text(input.request_id || `keymaster-${randomUUID()}`, 256);
    const actor = 'owner-keymaster-page';
    let brokerInput: Record<string, unknown>;

    if (action === 'connect') {
      const secret = typeof input.secret === 'string' ? input.secret : '';
      if (!secret || Buffer.byteLength(secret, 'utf8') > 65536) throw new Error('invalid_secret_size');
      brokerInput = {
        action,
        provider: text(input.provider, 64).toLowerCase(),
        account_label: text(input.account_label, 256, 'default'),
        purpose: text(input.purpose, 256),
        scope: parseScope(input.scope),
        secret,
        rotation_due_at: optionalText(input.rotation_due_at, 64),
        verification_status: 'unverified',
        verification_detail: {},
        request_id,
        actor,
      };
    } else if (action === 'replace') {
      const secret = typeof input.secret === 'string' ? input.secret : '';
      if (!secret || Buffer.byteLength(secret, 'utf8') > 65536) throw new Error('invalid_secret_size');
      brokerInput = {
        action,
        secret_ref: text(input.secret_ref, 64),
        secret,
        rotation_due_at: optionalText(input.rotation_due_at, 64),
        verification_status: 'unverified',
        verification_detail: {},
        request_id,
        actor,
      };
    } else if (action === 'revoke') {
      brokerInput = {
        action,
        secret_ref: text(input.secret_ref, 64),
        reason: optionalText(input.reason, 2048),
        request_id,
        actor,
      };
    } else if (action === 'inventory') {
      brokerInput = { action, request_id, actor };
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
