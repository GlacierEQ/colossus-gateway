import { randomUUID } from "node:crypto";
import { handleSigmaDispatch } from "../src/lib/sigmaDispatchReceiver.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runBridgeContext } from "../src/bridge/context.js";
import { authorizeRequest } from "../src/lib/operatorAuth.js";
import { hydrateOwnedContext, invokeOwnedModel } from "../src/lib/ownedInvocation.js";
import {
  productionInvocationDependencies,
  resolveGatewayModelPlan,
} from "../src/lib/ownedInvocationRuntime.js";
import { server } from "../src/server.js";

const ALLOWED_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com"]);

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function securityHeaders(contentType = "application/json") {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, x-colossus-operator, x-box-access-token, x-notion-token, x-vercel-oidc-token, x-request-id",
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function reject(res: ServerResponse, message: string) {
  res.writeHead(401, {
    ...securityHeaders(),
    "WWW-Authenticate": "Bearer",
  });
  res.end(JSON.stringify({ ok: false, error: message }));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1024 * 1024) throw new Error("request body too large");
  }
  const parsed = raw ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be an object");
  }
  return parsed as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, securityHeaders());
  res.end(JSON.stringify(payload));
}

const operatorHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<title>GlacierEQ Operator</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:#0a0a0a;color:#f4f4f5;min-height:100vh}
main{max-width:880px;margin:0 auto;padding:max(18px,env(safe-area-inset-top)) 16px max(28px,env(safe-area-inset-bottom))}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
h1{font-size:20px;margin:0;letter-spacing:.01em}.badge{font-size:12px;border:1px solid #3f3f46;border-radius:999px;padding:6px 9px;color:#a1a1aa}
.panel{border:1px solid #27272a;border-radius:16px;background:#111113;padding:14px;margin-bottom:14px}
label{display:block;font-size:12px;color:#a1a1aa;margin:0 0 6px}
input,textarea,button{font:inherit}input,textarea{width:100%;border:1px solid #3f3f46;border-radius:11px;background:#09090b;color:#fafafa;padding:11px 12px;outline:none}
input:focus,textarea:focus{border-color:#71717a}textarea{min-height:140px;resize:vertical}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stack{display:grid;gap:10px}
button{border:0;border-radius:11px;padding:12px 15px;font-weight:700;background:#f4f4f5;color:#09090b;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}.secondary{background:#27272a;color:#f4f4f5}
.status{font-size:12px;color:#a1a1aa;min-height:18px;margin-top:8px}
.message{border:1px solid #27272a;border-radius:14px;padding:12px;margin:10px 0;white-space:pre-wrap;line-height:1.48}
.user{background:#18181b}.assistant{background:#10151a}.meta{font-size:11px;color:#71717a;margin-top:8px}
@media(max-width:640px){.grid{grid-template-columns:1fr}main{padding-left:12px;padding-right:12px}}
</style>
</head>
<body>
<main>
<header><h1>GlacierEQ Operator</h1><span class="badge">owned invocation</span></header>
<section class="panel stack">
<div class="grid">
<div><label for="token">Operator credential</label><input id="token" type="password" autocomplete="off" placeholder="Bearer credential"></div>
<div><label for="model">Model route</label><input id="model" placeholder="optional; runtime default if blank" autocapitalize="off"></div>
</div>
<div><label for="system">Optional task-specific system note</label><input id="system" placeholder="Leave blank unless this task needs an extra instruction"></div>
</section>
<section id="messages"></section>
<section class="panel">
<label for="prompt">Operator message</label>
<textarea id="prompt" autofocus placeholder="Tell GlacierEQ what to do."></textarea>
<div style="display:flex;gap:8px;margin-top:10px">
<button id="send">Execute</button><button class="secondary" id="clear" type="button">Clear</button>
</div>
<div class="status" id="status">GlacierEQ recovers context before model invocation.</div>
</section>
</main>
<script>
const token=document.getElementById('token'),model=document.getElementById('model'),system=document.getElementById('system'),prompt=document.getElementById('prompt'),send=document.getElementById('send'),clear=document.getElementById('clear'),status=document.getElementById('status'),messages=document.getElementById('messages');
function add(role,text,meta=''){const el=document.createElement('div');el.className='message '+role;const body=document.createElement('div');body.textContent=text;el.append(body);if(meta){const m=document.createElement('div');m.className='meta';m.textContent=meta;el.append(m)}messages.append(el);el.scrollIntoView({behavior:'smooth',block:'end'})}
async function execute(){
 const operator=token.value.trim(), task=prompt.value.trim(); if(!operator||!task){status.textContent='Operator credential and message are required.';return}
 send.disabled=true;status.textContent='Recovering context → routing model → invoking…';add('user',task);prompt.value='';
 try{
  const payload={prompt:task};
  if(model.value.trim())payload.model=model.value.trim();
  if(system.value.trim())payload.system=system.value.trim();
  const r=await fetch('/v1/invoke',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+operator},body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||('HTTP '+r.status));
  add('assistant',data.response||'',(data.model||'model')+' · context '+(data.context_mode||'unknown')+' · invocation '+(data.invocation_owned?'owned':'unverified'));
  status.textContent='Completed through GlacierEQ-owned invocation.';
 }catch(e){add('assistant','ERROR: '+String(e&&e.message||e),'request failed');status.textContent='Invocation failed; native-model bypass was not used.'}
 finally{send.disabled=false;prompt.focus()}
}
send.addEventListener('click',execute);clear.addEventListener('click',()=>{messages.textContent='';status.textContent='Cleared. Runtime remains owned.'});
prompt.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();execute()}});
</script>
</body>
</html>`;

async function handleHydrate(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const requireProvider = body.require_provider === true || body.requireProvider === true;
  const hydrated = await hydrateOwnedContext(
    { prompt, requireProvider },
    productionInvocationDependencies(),
  );
  sendJson(res, 200, {
    schema: "glaciereq.pre-response-hydration.v2",
    status: "hydrated",
    provider_expected: true,
    provider_required: requireProvider,
    provider_retrieved: hydrated.providerRetrieved,
    context_mode: hydrated.contextMode,
    original_prompt: hydrated.prompt,
    hydrated_prompt: hydrated.hydratedPrompt,
    context: { lanes: hydrated.lanes, errors: hydrated.errors },
  });
}

async function handleInvoke(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const requestedModel = typeof body.model === "string" && body.model.trim()
    ? body.model.trim()
    : undefined;
  const requestedFallbacks = Array.isArray(body.fallback_models)
    ? body.fallback_models.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : undefined;
  const requestedProviderOrder = Array.isArray(body.provider_order)
    ? body.provider_order.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : undefined;
  const modelPlan = await resolveGatewayModelPlan({
    model: requestedModel,
    fallbackModels: requestedFallbacks,
    providerOrder: requestedProviderOrder,
  });
  const system = typeof body.system === "string" ? body.system : undefined;
  const requireProvider = body.require_provider === true || body.requireProvider === true;
  const result = await invokeOwnedModel(
    {
      prompt,
      model: modelPlan.primary,
      fallbackModels: modelPlan.models.slice(1),
      providerOrder: modelPlan.providerOrder,
      system,
      requireProvider,
    },
    productionInvocationDependencies(),
  );
  sendJson(res, 200, {
    ...result,
    model_plan: modelPlan,
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url || "/", "https://colossus-gateway.invalid").pathname;

  if (path === "/v1/dispatch") {
    await handleSigmaDispatch(req, res);
    return;
  }


  if (req.method === "GET" && path === "/operator") {
    res.writeHead(200, {
      ...securityHeaders("text/html; charset=utf-8"),
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(operatorHtml);
    return;
  }

  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (path === "/v1/hydrate" || path === "/v1/invoke") {
    setCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204, securityHeaders());
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { status: "method_not_allowed" });
      return;
    }

    const auth = authorizeRequest(req.headers);
    if (!auth.authorized) {
      reject(res, auth.message);
      return;
    }

    try {
      if (path === "/v1/hydrate") await handleHydrate(req, res);
      else await handleInvoke(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const explicitContextFailure = message.includes(
        "explicit provider context requirement",
      );
      sendJson(res, explicitContextFailure ? 409 : 502, {
        status: explicitContextFailure ? "context_required" : "runtime_failed",
        error: message,
      });
    }
    return;
  }

  const auth = authorizeRequest(req.headers);
  if (!auth.authorized) {
    reject(res, auth.message);
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  res.on("close", () => transport.close());
  await server.connect(transport);
  await runBridgeContext({
    boxAccessToken: header(req, "x-box-access-token"),
    notionAccessToken: header(req, "x-notion-token"),
    vercelOidcToken: header(req, "x-vercel-oidc-token"),
    actor: auth.operatorId || "mcp-operator",
    requestId: header(req, "x-request-id"),
    source: "remote-mcp",
  }, () => transport.handleRequest(req, res));
}
