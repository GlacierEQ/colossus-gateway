import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "npm:jose@6";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const OWNER = "GlacierEQ";
const MAX_INSTALLATION_PAGES = 100;
const ACTOR = "github-bootstrap-resume-v2";

const jsonHeaders = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function validState(value: string): boolean {
  return value.length >= 32 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const array of arrays) { output.set(array, offset); offset += array.length; }
  return output;
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) { bytes.unshift(value & 0xff); value = Math.floor(value / 256); }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < value.length; i += 0x8000) binary += String.fromCharCode(...value.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function normalizeRsaPrivateKey(pem: string): { pem: string; sourceFormat: "pkcs8" | "pkcs1" } {
  const normalized = pem.trim();
  if (normalized.includes("-----BEGIN PRIVATE KEY-----")) return { pem: `${normalized}\n`, sourceFormat: "pkcs8" };
  if (!normalized.includes("-----BEGIN RSA PRIVATE KEY-----")) throw new Error("unsupported_private_key_format");
  const raw = normalized.replace("-----BEGIN RSA PRIVATE KEY-----", "").replace("-----END RSA PRIVATE KEY-----", "").replace(/\s+/g, "");
  const pkcs1 = base64ToBytes(raw);
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithm = Uint8Array.of(0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00);
  const octet = concatBytes(Uint8Array.of(0x04), derLength(pkcs1.length), pkcs1);
  const body = concatBytes(version, rsaAlgorithm, octet);
  const pkcs8 = concatBytes(Uint8Array.of(0x30), derLength(body.length), body);
  const encoded = bytesToBase64(pkcs8);
  const lines = encoded.match(/.{1,64}/g)?.join("\n") || "";
  return { pem: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`, sourceFormat: "pkcs1" };
}

async function appJwt(appId: number, privateKey: string) {
  const normalized = normalizeRsaPrivateKey(privateKey);
  const key = await importPKCS8(normalized.pem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(String(appId)).setIssuedAt(now - 30).setExpirationTime(now + 540).sign(key);
  return { jwt, sourceFormat: normalized.sourceFormat };
}

async function github(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": GITHUB_API_VERSION,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  return payload;
}

async function listAppInstallations(token: string): Promise<any[]> {
  const installations: any[] = [];
  for (let page = 1; page <= MAX_INSTALLATION_PAGES; page += 1) {
    const payload = await github(`/app/installations?per_page=100&page=${page}`, token);
    if (!Array.isArray(payload)) throw new Error("github_installations_invalid");
    installations.push(...payload);
    if (payload.length < 100) return installations;
    if (page === MAX_INSTALLATION_PAGES) throw new Error("github_installations_exceed_page_limit");
  }
  throw new Error("github_installations_exceed_page_limit");
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean))].sort();
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return json(405, { ok: false, error: "method_not_allowed" });
  const state = new URL(request.url).searchParams.get("state")?.trim() || "";
  if (!validState(state)) return json(400, { ok: false, error: "invalid_state" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { ok: false, error: "broker_configuration_missing" });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const stateHash = await sha256Hex(state);
  const rid = `github-bootstrap-all-repos-${crypto.randomUUID()}`;

  let privateKey = "";
  let jwt = "";
  let token = "";
  try {
    const { data: session, error: sessionError } = await admin.from("apex_github_bootstrap_sessions").select("*").eq("state_hash", stateHash).single();
    if (sessionError || !session) throw new Error("bootstrap_session_not_found");
    if (session.status === "completed") return json(200, { ok: true, status: "completed", bootstrap_ref: session.bootstrap_ref });
    if (session.status !== "registered") throw new Error(`bootstrap_session_not_resumable:${session.status}`);
    if (!session.app_private_key_ref || !session.app_id) throw new Error("bootstrap_app_identity_missing");
    if (String(session.owner_login) !== OWNER) throw new Error("bootstrap_owner_rejected");

    const resolved = await admin.rpc("resolve_apex_keymaster_secret_for_broker", {
      p_secret_ref: session.app_private_key_ref,
      p_provider: "github",
      p_request_id: `${rid}-resolve`.slice(0, 256),
      p_actor: ACTOR,
      p_operation: "complete_all_repository_installation",
    });
    if (resolved.error || typeof resolved.data?.secret !== "string") throw new Error(resolved.error?.message || "private_key_resolution_failed");
    privateKey = resolved.data.secret;
    const signed = await appJwt(Number(session.app_id), privateKey);
    jwt = signed.jwt;
    privateKey = "";

    const installations = await listAppInstallations(jwt);
    const matches = installations.filter((item) => Number(item?.app_id) === Number(session.app_id) && String(item?.account?.login || "") === OWNER);
    if (matches.length !== 1) throw new Error(matches.length ? "github_installation_ambiguous" : "github_installation_not_found");
    const installation = matches[0];
    const installationId = Number(installation.id);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("invalid_installation_id");
    if (installation.repository_selection !== "all") throw new Error("installation_not_all_repositories");

    const required: Record<string, string> = { actions: "write", contents: "write", issues: "write", workflows: "write" };
    const missingPermissions = Object.keys(required).filter((name) => installation?.permissions?.[name] !== "write");
    if (missingPermissions.length) throw new Error(`installation_permissions_missing:${missingPermissions.join(",")}`);

    const anchors = uniqueStrings(session.expected_repositories);
    if (!anchors.length) throw new Error("anchor_repositories_missing");
    const repoNames = anchors.map((r) => {
      const [owner, name, extra] = r.split("/");
      if (owner !== OWNER || !name || extra) throw new Error("invalid_anchor_repository");
      return name;
    });

    const minted = await github(`/app/installations/${installationId}/access_tokens`, jwt, {
      method: "POST",
      body: JSON.stringify({ repositories: repoNames, permissions: { contents: "read" } }),
    });
    if (typeof minted?.token !== "string") throw new Error("github_installation_token_invalid");
    token = minted.token;

    const readChecks: Array<Record<string, unknown>> = [];
    for (const repository of anchors) {
      const response = await fetch(`${GITHUB_API}/repos/${repository}`, {
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": GITHUB_API_VERSION },
      });
      readChecks.push({ repository, status: response.status, ok: response.ok });
      if (!response.ok) throw new Error(`repository_read_verification_failed:${repository}`);
    }
    token = "";

    const verified = await admin.rpc("verify_apex_keymaster_secret", {
      p_secret_ref: session.app_private_key_ref,
      p_verification_status: "verified",
      p_verification_detail: { provider: "github", app_id: session.app_id, app_slug: session.app_slug, source_format: signed.sourceFormat, normalized_in_memory: signed.sourceFormat === "pkcs1", app_jwt_verified: true },
      p_request_id: `${rid}-key-verified`.slice(0, 256),
      p_actor: ACTOR,
    });
    if (verified.error) throw new Error(verified.error.message || "private_key_verification_failed");

    const receipt = await admin.rpc("apex_github_bootstrap_write_receipt", {
      p_bootstrap_ref: session.bootstrap_ref,
      p_request_id: rid,
      p_action: "installation_verified",
      p_actor: ACTOR,
      p_outcome: "succeeded",
      p_metadata: { installation_id: installationId, installation_scope: "all", owner_login: OWNER, verified_anchor_repositories: anchors, live_read_check_count: readChecks.length, token_scope: "anchors_only", source_format: signed.sourceFormat },
    });
    if (receipt.error) throw new Error(receipt.error.message || "verification_receipt_failed");

    const completed = await admin.rpc("complete_apex_github_bootstrap_session", {
      p_state_hash: stateHash,
      p_installation_id: installationId,
      p_observed_repositories: anchors,
      p_verification_detail: {
        owner_login: OWNER,
        app_id: session.app_id,
        app_slug: session.app_slug,
        installation_scope: "all",
        authorization_model: "global_installation_single_repository_tokens",
        verified_anchor_repositories: anchors,
        live_read_checks: readChecks,
        token_persisted: false,
        private_key_source_format: signed.sourceFormat,
        private_key_normalized_in_memory: signed.sourceFormat === "pkcs1",
      },
      p_request_id: rid,
      p_actor: ACTOR,
    });
    if (completed.error) throw new Error(completed.error.message || "bootstrap_completion_failed");

    return json(200, { ok: true, status: "completed", bootstrap_ref: session.bootstrap_ref, installation_id: installationId, installation_scope: "all", verified_anchor_repositories: anchors, live_read_checks: readChecks.length, token_persisted: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "bootstrap_resume_failed";
    return json(400, { ok: false, error: message.slice(0, 512) });
  } finally {
    privateKey = "";
    jwt = "";
    token = "";
  }
});
