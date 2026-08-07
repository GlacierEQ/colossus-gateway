import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "npm:jose@6";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const OWNER = "GlacierEQ";
const MAX_PAGES = 20;
const ACTOR = "repo-atlas-seed";

const headers = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers }); }
function validState(v: string) { return v.length >= 32 && v.length <= 512 && /^[A-Za-z0-9_-]+$/.test(v); }
async function sha256Hex(v: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2,"0")).join(""); }
function concat(...arrays: Uint8Array[]) { const out = new Uint8Array(arrays.reduce((n,a)=>n+a.length,0)); let o=0; for (const a of arrays) { out.set(a,o); o+=a.length; } return out; }
function derLength(n: number) { if (n < 0x80) return Uint8Array.of(n); const b:number[]=[]; while(n>0){b.unshift(n&255);n=Math.floor(n/256);} return Uint8Array.of(0x80|b.length,...b); }
function b64bytes(v:string){const s=atob(v);return Uint8Array.from(s,(c)=>c.charCodeAt(0));}
function bytesb64(v:Uint8Array){let s="";for(let i=0;i<v.length;i+=0x8000)s+=String.fromCharCode(...v.subarray(i,i+0x8000));return btoa(s);}
function normalizeKey(pem:string){const p=pem.trim();if(p.includes("-----BEGIN PRIVATE KEY-----"))return `${p}\n`;if(!p.includes("-----BEGIN RSA PRIVATE KEY-----"))throw new Error("unsupported_private_key_format");const raw=p.replace("-----BEGIN RSA PRIVATE KEY-----","").replace("-----END RSA PRIVATE KEY-----","").replace(/\s+/g,"");const pkcs1=b64bytes(raw);const version=Uint8Array.of(0x02,0x01,0x00);const alg=Uint8Array.of(0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00);const oct=concat(Uint8Array.of(0x04),derLength(pkcs1.length),pkcs1);const body=concat(version,alg,oct);const pkcs8=concat(Uint8Array.of(0x30),derLength(body.length),body);const encoded=bytesb64(pkcs8);return `-----BEGIN PRIVATE KEY-----\n${encoded.match(/.{1,64}/g)?.join("\n")||""}\n-----END PRIVATE KEY-----\n`;}
async function makeJwt(appId:number,pem:string){const key=await importPKCS8(normalizeKey(pem),"RS256");const now=Math.floor(Date.now()/1000);return await new SignJWT({}).setProtectedHeader({alg:"RS256"}).setIssuer(String(appId)).setIssuedAt(now-30).setExpirationTime(now+540).sign(key);}
async function github(path:string,token:string,init:RequestInit={}){const r=await fetch(`${GITHUB_API}${path}`,{...init,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${token}`,"x-github-api-version":GITHUB_API_VERSION,"content-type":"application/json",...(init.headers||{})}});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`github_http_${r.status}`);return p;}

function family(name:string,description:string){const s=`${name} ${description}`.toLowerCase();if(/1fdv|1fda|legal|court|case|docket|law|brief|motion|evidence|litigation|tro|family/.test(s))return "legal_evidence";if(/colossus|control.?plane|orchestr|mastermind|monolith|\bakos\b|\baeon\b|\bapex\b|gateway|omni/.test(s))return "control_plane";if(/memory|mem0|supermemory|recall|vector|embed|rag|knowledge/.test(s))return "memory_retrieval";if(/pdf|document|ocr|office|word|docx/.test(s))return "document_intelligence";if(/file|filesystem|\bfs\b|sorter|navigator|commander|storage/.test(s))return "file_operations";if(/runner|actions|worker|daemon|deploy|vercel|supabase|runtime/.test(s))return "runtime_deployment";if(/browser|extension|selenium|playwright|web.?agent/.test(s))return "browser_automation";if(/security|cyber|forensic|antivirus|defense|osint/.test(s))return "security_forensics";if(/agent|assistant|autogpt|crew|swarm|claw|aider|cline/.test(s))return "agents";if(/research|scientist|deepseek|\bllm\b|\bgpt\b|claude|gemma|kimi|minimax|model/.test(s))return "research_models";if(/frontend|dashboard|\bui\b|website|mobile|android|swift/.test(s))return "interfaces";return "other";}
function lifecycle(repo:any){const n=String(repo.name||"").toLowerCase();if(repo.archived)return "archived";if(/^z[-_]?backup|backup|archive|old[-_]|legacy/.test(n))return "backup";if(repo.fork)return "reference";const pushed=repo.pushed_at?Date.parse(repo.pushed_at):0;const age=(Date.now()-pushed)/86400000;if(!pushed||age>365)return "dormant";if(age>90)return "cool";return "active";}
function signature(name:string){return name.toLowerCase().replace(/z[-_]?backup[-_]?/g,"").replace(/\b(main|master|backup|archive|legacy|unified|pro|max|plus|source|public|private)\b/g,"").replace(/[-_.]+v?\d+(?:\.\d+)*/g,"").replace(/[^a-z0-9]+/g,"").slice(0,120)||name.toLowerCase().replace(/[^a-z0-9]+/g,"").slice(0,120);}
function score(repo:any,fam:string,life:string){let s=0;const reasons:string[]=[];const pushed=repo.pushed_at?Date.parse(repo.pushed_at):0;const age=pushed?(Date.now()-pushed)/86400000:99999;if(age<=7){s+=45;reasons.push("pushed_within_7_days");}else if(age<=30){s+=35;reasons.push("pushed_within_30_days");}else if(age<=90){s+=20;reasons.push("pushed_within_90_days");}if(!repo.fork){s+=20;reasons.push("original_repository");}else{s-=30;reasons.push("fork_reference");}if(Number(repo.size||0)>=100){s+=10;reasons.push("substantive_repository");}if(repo.description){s+=5;reasons.push("described");}if(["control_plane","runtime_deployment","legal_evidence","memory_retrieval","document_intelligence","file_operations"].includes(fam)){s+=10;reasons.push("strategic_family");}if(/colossus|control|mastermind|monolith|akos|aeon|apex|gateway|canonical|unified/i.test(String(repo.name||""))){s+=15;reasons.push("canonical_signal");}if(life==="backup"||life==="archived"){s-=50;reasons.push("backup_or_archived");}if(life==="dormant"){s-=10;reasons.push("dormant");}return {score:s,reasons};}

Deno.serve(async(request:Request)=>{
  if(request.method!=="GET")return json(405,{ok:false,error:"method_not_allowed"});
  const state=new URL(request.url).searchParams.get("state")?.trim()||"";
  if(!validState(state))return json(400,{ok:false,error:"invalid_state"});
  const supabaseUrl=Deno.env.get("SUPABASE_URL"), serviceRoleKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl||!serviceRoleKey)return json(500,{ok:false,error:"configuration_missing"});
  const admin=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const stateHash=await sha256Hex(state);let privateKey="",appJwt="",installToken="",snapshotId:string|null=null;
  try{
    const {data:session,error}=await admin.from("apex_github_bootstrap_sessions").select("*").eq("state_hash",stateHash).single();
    if(error||!session)throw new Error("bootstrap_session_not_found");
    if(session.status!=="completed")throw new Error("github_app_not_completed");
    if(new Date(session.expires_at).getTime()<=Date.now())throw new Error("atlas_seed_capability_expired");
    if(String(session.owner_login)!==OWNER||session.verification_detail?.installation_scope!=="all")throw new Error("all_repository_installation_not_verified");
    const resolved=await admin.rpc("resolve_apex_keymaster_secret_for_broker",{p_secret_ref:session.app_private_key_ref,p_provider:"github",p_request_id:`atlas-${crypto.randomUUID()}`.slice(0,256),p_actor:ACTOR,p_operation:"metadata_only_repository_atlas"});
    if(resolved.error||typeof resolved.data?.secret!=="string")throw new Error(resolved.error?.message||"private_key_resolution_failed");
    privateKey=resolved.data.secret;appJwt=await makeJwt(Number(session.app_id),privateKey);privateKey="";
    const minted=await github(`/app/installations/${Number(session.installation_id)}/access_tokens`,appJwt,{method:"POST",body:JSON.stringify({permissions:{contents:"read"}})});
    if(typeof minted?.token!=="string")throw new Error("inventory_token_invalid");installToken=minted.token;
    const repos:any[]=[];
    for(let page=1;page<=MAX_PAGES;page+=1){const payload=await github(`/installation/repositories?per_page=100&page=${page}`,installToken);const items=Array.isArray(payload?.repositories)?payload.repositories:[];repos.push(...items);if(items.length<100)break;if(page===MAX_PAGES)throw new Error("repository_inventory_exceeds_page_limit");}
    installToken="";
    const dedup=[...new Map(repos.filter((r)=>Number.isSafeInteger(Number(r?.id))&&typeof r?.full_name==="string").map((r)=>[Number(r.id),r])).values()];
    const snap=await admin.from("apex_repo_atlas_snapshots").insert({installation_id:Number(session.installation_id),repository_count:dedup.length,metadata:{owner:OWNER,installation_scope:"all",scan_mode:"metadata_only",github_content_fetch:false,inventory_token_permissions:{contents:"read"},inventory_token_persisted:false}}).select("snapshot_id").single();
    if(snap.error||!snap.data?.snapshot_id)throw new Error(snap.error?.message||"snapshot_create_failed");snapshotId=snap.data.snapshot_id;
    const rows=dedup.map((repo:any)=>{const fam=family(String(repo.name||""),String(repo.description||""));const life=lifecycle(repo);const scored=score(repo,fam,life);return {snapshot_id:snapshotId,repository_id:Number(repo.id),full_name:String(repo.full_name),name:String(repo.name),visibility:repo.visibility??null,is_private:Boolean(repo.private),is_fork:Boolean(repo.fork),is_archived:Boolean(repo.archived),default_branch:repo.default_branch??null,size_kb:Number(repo.size||0),language:repo.language??null,description:repo.description??null,homepage:repo.homepage??null,pushed_at:repo.pushed_at??null,updated_at:repo.updated_at??null,family:fam,lifecycle:life,name_signature:signature(String(repo.name)),ignition_score:scored.score,metadata:{html_url:repo.html_url??null,has_issues:repo.has_issues??null,has_projects:repo.has_projects??null,has_discussions:repo.has_discussions??null,reasons:scored.reasons}};});
    for(let i=0;i<rows.length;i+=100){const inserted=await admin.from("apex_repo_atlas_repositories").insert(rows.slice(i,i+100));if(inserted.error)throw new Error(inserted.error.message||"atlas_repository_insert_failed");}
    const candidates=rows.filter((r:any)=>!r.is_archived&&r.lifecycle!=="backup").sort((a:any,b:any)=>b.ignition_score-a.ignition_score||String(b.pushed_at||"").localeCompare(String(a.pushed_at||""))).slice(0,25);
    const queueRows=candidates.map((r:any,index:number)=>({snapshot_id:snapshotId,full_name:r.full_name,priority:index+1,score:r.ignition_score,family:r.family,reasons:r.metadata.reasons,status:"queued"}));
    if(queueRows.length){const q=await admin.from("apex_repo_ignition_queue").insert(queueRows);if(q.error)throw new Error(q.error.message||"ignition_queue_insert_failed");}
    const famCounts:Record<string,number>={};const lifeCounts:Record<string,number>={};for(const r of rows){famCounts[r.family]=(famCounts[r.family]||0)+1;lifeCounts[r.lifecycle]=(lifeCounts[r.lifecycle]||0)+1;}
    return json(200,{ok:true,snapshot_id:snapshotId,repository_count:rows.length,families:famCounts,lifecycle:lifeCounts,ignition_queue_count:queueRows.length,top_ignition:candidates.slice(0,10).map((r:any)=>({repository:r.full_name,score:r.ignition_score,family:r.family,reasons:r.metadata.reasons})),scan_mode:"metadata_only",github_writes:0});
  }catch(error){if(snapshotId)await admin.from("apex_repo_atlas_snapshots").delete().eq("snapshot_id",snapshotId);const message=error instanceof Error?error.message:"atlas_seed_failed";return json(400,{ok:false,error:message.slice(0,512)});}finally{privateKey="";appJwt="";installToken="";}
});
