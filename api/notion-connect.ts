import type { IncomingMessage, ServerResponse } from 'node:http';
import { auditLedger } from '../src/bridge/audit.js';

const SUPABASE_URL = process.env.APEX_CAPABILITY_SUPABASE_URL || 'https://dyhprklicgewmrimecey.supabase.co';
const SUPABASE_KEY = process.env.APEX_CAPABILITY_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5aHBya2xpY2dld21yaW1lY2V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5NTkxMjUsImV4cCI6MjA2ODUzNTEyNX0.KSddhx8HBzWFM73hdM-p_IChuI8bdb5UitmehQYXRtI';

function headers(contentType = 'application/json') {
  return {
    'content-type': contentType,
    'cache-control': 'no-store, max-age=0',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  };
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 16 * 1024) throw new Error('request_body_too_large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function broker(input: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/apex-notion-broker`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Notion — Colossus Gateway</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark;background:#0c0d10;color:#f4f4f5}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}.card{width:min(680px,100%);background:#15171c;border:1px solid #30333b;border-radius:18px;padding:28px;box-shadow:0 24px 80px #0008}h1{margin:0 0 10px;font-size:28px}p{color:#b6bac5;line-height:1.5}.row{display:flex;gap:10px;flex-wrap:wrap}input{width:100%;box-sizing:border-box;background:#0d0f13;border:1px solid #3b3f49;color:#fff;border-radius:10px;padding:13px;font:inherit;margin:10px 0}button{background:#fff;color:#111;border:0;border-radius:10px;padding:12px 16px;font-weight:700;cursor:pointer}button.secondary{background:#292d35;color:#fff}.status{white-space:pre-wrap;background:#0d0f13;border:1px solid #2e323b;border-radius:10px;padding:14px;margin-top:16px;min-height:48px;color:#cdd1dc}.ok{color:#7ee787}.bad{color:#ff7b72}code{color:#d2a8ff}</style>
</head>
<body><main class="card">
<h1>Connect Notion to Colossus</h1>
<p>This stores the integration token once in Supabase Vault, consumes the one-use setup capability, and immediately proves a direct Notion API search through the deployed gateway. The token is never written to GitHub, browser storage, or logs.</p>
<input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="ntn_…">
<div class="row"><button id="clipboard">Connect from clipboard</button><button id="connect" class="secondary">Connect entered token</button></div>
<div id="status" class="status">Ready.</div>
<script>
const statusEl=document.getElementById('status');
const tokenEl=document.getElementById('token');
const capability=new URLSearchParams(location.hash.slice(1)).get('capability')||'';
location.hash='';
function show(message,ok){statusEl.textContent=message;statusEl.className='status '+(ok===true?'ok':ok===false?'bad':'');}
async function connect(token){
  if(!capability){show('Missing or expired setup capability.',false);return;}
  if(!token||!token.startsWith('ntn_')){show('A valid Notion integration token is required.',false);return;}
  show('Connecting, storing in Vault, and running the live search…');
  try{
    const response=await fetch('/notion/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,capability})});
    tokenEl.value='';
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||data.detail||'Connection failed');
    show('CONNECTED\n\nDirect API: '+data.test.direct_api+'\nResult count: '+data.test.result_count+'\nFirst result: '+(data.test.results?.[0]?.title||'No matching page')+'\nAudit: '+data.audit.supabase,true);
  }catch(error){show(String(error.message||error),false);}
}
document.getElementById('connect').onclick=()=>connect(tokenEl.value.trim());
document.getElementById('clipboard').onclick=async()=>{try{const value=(await navigator.clipboard.readText()).trim();tokenEl.value=value;await connect(value);}catch(error){show('Clipboard access failed. Paste the token into the field and press Connect entered token.',false);}};
</script></main></body></html>`;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'GET') {
    res.writeHead(200, headers('text/html; charset=utf-8'));
    res.end(page);
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, headers());
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  try {
    const input = await readBody(req);
    const token = typeof input?.token === 'string' ? input.token.trim() : '';
    const capability = typeof input?.capability === 'string' ? input.capability : '';
    if (!token.startsWith('ntn_') || token.length < 20 || !capability) {
      res.writeHead(400, headers());
      res.end(JSON.stringify({ error: 'token_and_capability_required' }));
      return;
    }

    const connected = await broker({ action: 'connect', token, capability });
    if (!connected.response.ok) {
      res.writeHead(connected.response.status, headers());
      res.end(JSON.stringify({ error: connected.payload?.error || 'connect_failed', detail: connected.payload?.detail }));
      return;
    }

    const tested = await broker({ action: 'search', query: 'APEX Deployment Assets', limit: 5 });
    if (!tested.response.ok) {
      res.writeHead(tested.response.status, headers());
      res.end(JSON.stringify({ error: tested.payload?.error || 'test_failed', detail: tested.payload?.message }));
      return;
    }

    const audit = await auditLedger.record({
      requestId: crypto.randomUUID(),
      action: 'notion_connect',
      status: 'succeeded',
      actor: 'owner-setup-page',
      source: 'https:notion-connect',
      target: { provider: 'notion', storage: 'supabase_vault' },
      arguments: { capability_consumed: true },
      result: { direct_api: tested.payload?.direct_api, result_count: tested.payload?.result_count },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    res.writeHead(200, headers());
    res.end(JSON.stringify({ ok: true, connected: connected.payload, test: tested.payload, audit }));
  } catch (error) {
    res.writeHead(400, headers());
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
