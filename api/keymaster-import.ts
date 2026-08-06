import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SUPABASE_URL = process.env.APEX_CAPABILITY_SUPABASE_URL || 'https://dyhprklicgewmrimecey.supabase.co';
const CANONICAL_ORIGIN = 'https://colossus-gateway.vercel.app';
const BROKER_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 8 * 1024;

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

function headers(contentType = 'application/json') {
  return {
    'content-type': contentType,
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, headers());
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

async function broker(input: Record<string, unknown>, oidcToken: string): Promise<any> {
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
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `broker_http_${response.status}`);
  return payload;
}

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Import Vercel Secrets — Colossus Keymaster</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark;background:#090b0f;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(760px,100%);background:#14171d;border:1px solid #303640;border-radius:18px;padding:28px;box-shadow:0 24px 80px #0008}h1{margin:0 0 10px}p{color:#b7bdc8;line-height:1.55}input{width:100%;background:#0b0e13;border:1px solid #3b424d;color:#fff;border-radius:10px;padding:13px;font:inherit;margin:10px 0}button{background:#fff;color:#111;border:0;border-radius:10px;padding:12px 16px;font-weight:750;cursor:pointer}.status{white-space:pre-wrap;background:#0b0e13;border:1px solid #303640;border-radius:10px;padding:14px;margin-top:16px;min-height:70px;max-height:420px;overflow:auto}.ok{color:#7ee787}.bad{color:#ff7b72}.warning{color:#f2cc60}</style></head><body><main class="card"><h1>Vercel → Supabase Vault</h1><p>This imports only the exact credential variable allowlist built into Colossus. It skips missing variables and active Vault bindings. Raw values never return to the browser.</p><input id="operator" type="password" autocomplete="off" spellcheck="false" placeholder="Colossus operator code"><button id="import">Import known Vercel credentials</button><div id="status" class="status warning">No credentials have been submitted.</div><script>const operator=document.getElementById('operator'),statusEl=document.getElementById('status');function show(message,state){statusEl.textContent=message;statusEl.className='status '+state;}document.getElementById('import').onclick=async()=>{const operator_code=operator.value;operator.value='';show('Importing exact-allowlist credentials…','warning');try{const response=await fetch('/keymaster/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operator_code,request_id:'keymaster-import-'+crypto.randomUUID()}),cache:'no-store',credentials:'same-origin'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Import failed');show(JSON.stringify(data,null,2),'ok');}catch(error){show(String(error.message||error),'bad');}};window.addEventListener('pageshow',()=>operator.value='');window.addEventListener('beforeunload',()=>operator.value='');</script></main></body></html>`;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'GET') {
    res.writeHead(200, headers('text/html; charset=utf-8'));
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

    const requestId = typeof input.request_id === 'string' && input.request_id.length >= 8
      ? input.request_id.slice(0, 256)
      : `keymaster-import-${randomUUID()}`;
    const inventoryPayload = await broker({ action: 'inventory', request_id: requestId, actor: 'owner-keymaster-import' }, oidcToken);
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
        const stored = await broker({
          action: 'connect',
          provider: binding.provider,
          account_label: binding.account,
          purpose: binding.purpose,
          scope: binding.scope,
          secret,
          rotation_due_at: null,
          verification_status: 'unverified',
          verification_detail: { source: 'vercel_env', env_name: binding.env },
          request_id: `${requestId}-${binding.env}`.slice(0, 256),
          actor: 'owner-keymaster-import',
        }, oidcToken);
        active.add(key);
        results.push({
          env_name: binding.env,
          provider: binding.provider,
          purpose: binding.purpose,
          status: 'imported',
          secret_ref: stored.secret_ref,
          receipt_id: stored.receipt_id,
        });
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

    send(res, 200, {
      ok: true,
      request_id: requestId,
      counts,
      results,
      next_action: 'Verify each imported reference through its provider adapter, then delete the former Vercel variable.',
      excluded_bootstrap: ['COLOSSUS_OPERATOR_CODE', 'VERCEL_OIDC_TOKEN', 'APEX_CAPABILITY_SUPABASE_URL'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'keymaster_import_failed';
    send(res, message === 'request_body_too_large' ? 413 : 400, { error: message.slice(0, 256) });
  }
}
