import type { IncomingMessage, ServerResponse } from 'node:http';

const html = `<!doctype html>
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
<div><label for="model">Model</label><input id="model" value="openai/gpt-5.6-sol" autocapitalize="off"></div>
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
 send.disabled=true;status.textContent='Recovering context → invoking model…';add('user',task);prompt.value='';
 try{
  const r=await fetch('/v1/invoke',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+operator},body:JSON.stringify({prompt:task,model:model.value.trim(),system:system.value.trim()||undefined})});
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

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'method_not_allowed' }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(html);
}
