import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "npm:jose@6";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_PAGES = 20;
const ACTOR = "github-bootstrap-resume";

const headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function page(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark;background:#090b0f;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(760px,100%);background:#14171d;border:1px solid #303640;border-radius:18px;padding:28px;box-shadow:0 24px 80px #0008}h1{margin:0 0 10px}p,li{color:#b7bdc8;line-height:1.55}.ok{color:#7ee787}.bad{color:#ff7b72}.warning{color:#f2cc60}code{word-break:break-all}a{display:inline-block;background:#fff;color:#111;border-radius:10px;padding:12px 16px;font-weight:750;text-decoration:none;margin-top:12px}</style></head><body><main class="card">${body}</main></body></html>`, { status, headers });
}

function validState(value: string): boolean {
  return value.length >= 32 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const size = arrays.reduce((sum, array) => sum + array.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

function derLength(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error("invalid_der_length");
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < value.length; index += chunkSize) {
    binary += String.fromCharCode(...value.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function normalizeRsaPrivateKey(pem: string): { pem: string; sourceFormat: "pkcs8" | "pkcs1" } {
  const normalized = pem.trim();
  if (/-----BEGIN PRIVATE KEY-----/.test(normalized)) {
    return { pem: `${normalized}\n`, sourceFormat: "pkcs8" };
  }
  if (!/-----BEGIN RSA PRIVATE KEY-----/.test(normalized)) {
    throw new Error("unsupported_private_key_format");
  }

  const base64 = normalized
    .replace("-----BEGIN RSA PRIVATE KEY-----", "")
    .replace("-----END RSA PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const pkcs1 = base64ToBytes(base64);
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithm = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  );
  const privateKey = concatBytes(Uint8Array.of(0x04), derLength(pkcs1.length), pkcs1);
  const body = concatBytes(version, rsaAlgorithm, privateKey);
  const pkcs8 = concatBytes(Uint8Array.of(0x30), derLength(body.length), body);
  const encoded = bytesToBase64(pkcs8);
  const lines = encoded.match(/.{1,64}/g)?.join("\n") || "";
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`,
    sourceFormat: "pkcs1",
  };
}

async function createAppJwt(appId: number, privateKeyPem: string): Promise<{ jwt: string; sourceFormat: string }> {
  if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error("invalid_github_app_id");
  const normalized = normalizeRsaPrivateKey(privateKeyPem);
  const key = await importPKCS8(normalized.pem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(String(appId))
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 540)
    .sign(key);
  return { jwt, sourceFormat: normalized.sourceFormat };
}

async function githubJson(path: string, token: string, init: RequestInit = {}): Promise<any> {
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

async function listAppInstallations(appJwt: string): Promise<any[]> {
  const installations: any[] = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const items = await githubJson(`/app/installations?per_page=100&page=${pageNumber}`, appJwt);
    if (!Array.isArray(items)) throw new Error("github_installations_invalid");
    installations.push(...items);
    if (items.length < 100) break;
    if (pageNumber === MAX_PAGES) throw new Error("github_installations_too_many");
  }
  return installations;
}

async function createInstallationToken(appJwt: string, installationId: number): Promise<{ token: string; expiresAt: string; permissions: Record<string, string> }> {
  const payload = await githubJson(`/app/installations/${installationId}/access_tokens`, appJwt, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (typeof payload?.token !== "string" || typeof payload?.expires_at !== "string") {
    throw new Error("github_installation_token_invalid");
  }
  return {
    token: payload.token,
    expiresAt: payload.expires_at,
    permissions: payload.permissions && typeof payload.permissions === "object" ? payload.permissions : {},
  };
}

async function listRepositories(token: string): Promise<string[]> {
  const repositories: string[] = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const payload = await githubJson(`/installation/repositories?per_page=100&page=${pageNumber}`, token);
    const items = Array.isArray(payload?.repositories) ? payload.repositories : [];
    for (const item of items) if (typeof item?.full_name === "string") repositories.push(item.full_name);
    if (items.length < 100) break;
    if (pageNumber === MAX_PAGES) throw new Error("github_repositories_too_many");
  }
  return [...new Set(repositories)].sort();
}

function uniqueSorted(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("invalid_expected_repositories");
  return [...new Set(input.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))].sort();
}

function permissionSatisfied(actual: unknown, required: "read" | "write"): boolean {
  return actual === "write" || (required === "read" && actual === "read");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return page("Method not allowed", "<h1 class=\"bad\">Method not allowed</h1>", 405);

  const url = new URL(request.url);
  const state = (url.searchParams.get("state") || "").trim();
  if (!validState(state)) return page("Invalid recovery link", "<h1 class=\"bad\">Invalid recovery link</h1><p>The recovery capability is missing or malformed.</p>", 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return page("Configuration error", "<h1 class=\"bad\">Recovery service unavailable</h1>", 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const stateHash = await sha256Hex(state);
  const requestId = `github-bootstrap-resume-${crypto.randomUUID()}`;

  let privateKeyPem = "";
  let appJwt = "";
  let installationToken = "";

  try {
    const sessionResult = await admin
      .from("apex_github_bootstrap_sessions")
      .select("*")
      .eq("state_hash", stateHash)
      .single();
    if (sessionResult.error || !sessionResult.data) throw new Error("bootstrap_session_not_found");
    const session = sessionResult.data as any;

    if (session.status === "completed") {
      const repositories = uniqueSorted(session.observed_repositories);
      return page("Colossus GitHub App active", `<h1 class="ok">Colossus GitHub App is active</h1><p>The installation was already completed and verified.</p><ul>${repositories.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
    }
    if (session.status !== "registered") throw new Error(`bootstrap_session_not_resumable:${session.status}`);
    if (new Date(session.expires_at).getTime() <= Date.now()) throw new Error("bootstrap_session_expired");
    if (!session.app_private_key_ref || !session.app_id || !session.owner_login) throw new Error("bootstrap_app_identity_missing");

    const resolved = await admin.rpc("resolve_apex_keymaster_secret_for_broker", {
      p_secret_ref: session.app_private_key_ref,
      p_provider: "github",
      p_request_id: `${requestId}-resolve`.slice(0, 256),
      p_actor: ACTOR,
      p_operation: "resume_github_app_installation",
    });
    if (resolved.error || typeof resolved.data?.secret !== "string") throw new Error(resolved.error?.message || "private_key_resolution_failed");
    privateKeyPem = resolved.data.secret;

    const signed = await createAppJwt(Number(session.app_id), privateKeyPem);
    appJwt = signed.jwt;
    privateKeyPem = "";

    const installations = await listAppInstallations(appJwt);
    const matches = installations.filter((item) =>
      Number(item?.app_id) === Number(session.app_id) &&
      String(item?.account?.login || "") === String(session.owner_login)
    );
    if (matches.length !== 1) throw new Error(matches.length === 0 ? "github_installation_not_found" : "github_installation_ambiguous");
    const installation = matches[0];
    const installationId = Number(installation.id);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("invalid_installation_id");

    const requiredPermissions: Record<string, "write"> = {
      actions: "write",
      contents: "write",
      issues: "write",
      workflows: "write",
    };
    const missingPermissions = Object.entries(requiredPermissions)
      .filter(([name, required]) => !permissionSatisfied(installation?.permissions?.[name], required))
      .map(([name]) => name);
    if (missingPermissions.length) throw new Error(`github_installation_permissions_missing:${missingPermissions.join(",")}`);

    const minted = await createInstallationToken(appJwt, installationId);
    installationToken = minted.token;
    const observed = await listRepositories(installationToken);
    const expected = uniqueSorted(session.expected_repositories);
    const missing = expected.filter((repository) => !observed.includes(repository));
    const extras = observed.filter((repository) => !expected.includes(repository));

    if (missing.length || extras.length) {
      await admin.rpc("apex_github_bootstrap_write_receipt", {
        p_bootstrap_ref: session.bootstrap_ref,
        p_request_id: requestId,
        p_action: "installation_verified",
        p_actor: ACTOR,
        p_outcome: "blocked",
        p_metadata: { installation_id: installationId, missing, extras, recovery: true },
      });
      return page("Repository selection needs correction", `<h1 class="warning">Repository selection needs correction</h1><p>No activation was recorded because the installed repository set did not exactly match the approved set.</p><p><strong>Missing:</strong> ${escapeHtml(missing.join(", ") || "none")}</p><p><strong>Unexpected:</strong> ${escapeHtml(extras.join(", ") || "none")}</p><a href="https://github.com/settings/installations/${installationId}">Correct repository access</a>`, 409);
    }

    const readChecks: Array<Record<string, unknown>> = [];
    for (const repository of expected) {
      const response = await fetch(`${GITHUB_API}/repos/${repository}`, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${installationToken}`,
          "x-github-api-version": GITHUB_API_VERSION,
        },
      });
      readChecks.push({ repository, status: response.status, ok: response.ok });
      if (!response.ok) throw new Error(`repository_read_verification_failed:${repository}`);
    }

    await admin.rpc("verify_apex_keymaster_secret", {
      p_secret_ref: session.app_private_key_ref,
      p_verification_status: "verified",
      p_verification_detail: {
        provider: "github",
        app_id: session.app_id,
        app_slug: session.app_slug,
        source_format: signed.sourceFormat,
        normalized_in_memory: signed.sourceFormat === "pkcs1",
        app_jwt_verified: true,
      },
      p_request_id: `${requestId}-key-verified`.slice(0, 256),
      p_actor: ACTOR,
    });

    await admin.rpc("apex_github_bootstrap_write_receipt", {
      p_bootstrap_ref: session.bootstrap_ref,
      p_request_id: requestId,
      p_action: "installation_verified",
      p_actor: ACTOR,
      p_outcome: "succeeded",
      p_metadata: {
        installation_id: installationId,
        exact_repository_allowlist: true,
        repository_count: observed.length,
        source_format: signed.sourceFormat,
        recovery: true,
      },
    });

    const completed = await admin.rpc("complete_apex_github_bootstrap_session", {
      p_state_hash: stateHash,
      p_installation_id: installationId,
      p_observed_repositories: observed,
      p_verification_detail: {
        owner_login: session.owner_login,
        app_id: session.app_id,
        app_slug: session.app_slug,
        exact_repository_allowlist: true,
        live_read_checks: readChecks,
        token_persisted: false,
        private_key_source_format: signed.sourceFormat,
        private_key_normalized_in_memory: signed.sourceFormat === "pkcs1",
        resumed_after_format_mismatch: true,
      },
      p_request_id: requestId,
      p_actor: ACTOR,
    });
    if (completed.error) throw new Error(completed.error.message || "bootstrap_completion_failed");

    return page("Colossus GitHub App activated", `<h1 class="ok">Colossus GitHub App activated</h1><p>The original GitHub installation was recovered. Its PKCS#1 private key was normalized only in memory, verified against GitHub, and remains stored solely in Vault.</p><p><strong>Verified repositories:</strong></p><ul>${observed.map((repository) => `<li>${escapeHtml(repository)}</li>`).join("")}</ul><p><strong>Live read checks:</strong> ${readChecks.length} passed.</p><p>No key was displayed, downloaded, copied, or committed.</p>`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "bootstrap_resume_failed";
    return page("Bootstrap recovery stopped", `<h1 class="bad">Bootstrap recovery stopped safely</h1><p>No unsupported success was recorded.</p><p><code>${escapeHtml(message.slice(0, 512))}</code></p>`, 400);
  } finally {
    privateKeyPem = "";
    appJwt = "";
    installationToken = "";
  }
});
