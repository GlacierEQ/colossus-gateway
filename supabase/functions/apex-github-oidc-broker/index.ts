import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "npm:jose@6";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const AUDIENCE = "apex-keymaster-public-runner";
const TRUSTED_REPOSITORY = "GlacierEQ/public-actions-runner-host";
const TRUSTED_REPOSITORY_ID = "1265621488";
const TRUSTED_OWNER = "GlacierEQ";
const TRUSTED_OWNER_ID = "194243768";
const TRUSTED_ACTOR = "GlacierEQ";
const TRUSTED_ACTOR_ID = "194243768";
const TRUSTED_WORKFLOW_REF = "GlacierEQ/public-actions-runner-host/.github/workflows/apex-pillar-runner.yml@refs/heads/main";
const ALLOWED_EVENTS = new Set(["push", "workflow_dispatch", "repository_dispatch", "issues", "pull_request"]);
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_BODY_BYTES = 16 * 1024;

const headers = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers });
}

function claim(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

async function verifyGithubOidc(req: Request): Promise<Record<string, unknown>> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("oidc_token_missing");
  const { payload } = await jwtVerify(auth.slice(7).trim(), GITHUB_OIDC_JWKS, {
    issuer: GITHUB_OIDC_ISSUER,
    audience: AUDIENCE,
    algorithms: ["RS256"],
    clockTolerance: 5,
  });
  const p = payload as Record<string, unknown>;
  const event = claim(p, "event_name");
  const ref = claim(p, "ref");
  if (
    claim(p, "repository") !== TRUSTED_REPOSITORY ||
    claim(p, "repository_id") !== TRUSTED_REPOSITORY_ID ||
    claim(p, "repository_owner") !== TRUSTED_OWNER ||
    claim(p, "repository_owner_id") !== TRUSTED_OWNER_ID ||
    claim(p, "repository_visibility") !== "public" ||
    claim(p, "actor") !== TRUSTED_ACTOR ||
    claim(p, "actor_id") !== TRUSTED_ACTOR_ID ||
    claim(p, "workflow_ref") !== TRUSTED_WORKFLOW_REF ||
    !ALLOWED_EVENTS.has(event)
  ) throw new Error("oidc_identity_rejected");
  if (event !== "pull_request" && ref !== "refs/heads/main") throw new Error("oidc_ref_rejected");
  if (event === "pull_request" && !ref.startsWith("refs/pull/")) throw new Error("oidc_ref_rejected");
  return p;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("request_body_too_large");
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error("request_body_too_large");
  const parsed = JSON.parse(raw || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_json");
  return parsed as Record<string, unknown>;
}

function text(value: unknown, max = 256): string {
  const output = typeof value === "string" ? value.trim() : "";
  if (!output || output.length > max) throw new Error("invalid_text_field");
  return output;
}

function normalizePermissions(input: unknown): Record<string, "read" | "write"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { contents: "read" };
  const allowed = new Set(["contents", "actions"]);
  const output: Record<string, "read" | "write"> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.has(key)) throw new Error("permission_not_allowed");
    if (value !== "read" && value !== "write") throw new Error("invalid_permission_level");
    output[key] = value;
  }
  return Object.keys(output).length ? output : { contents: "read" };
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

function derLength(length: number): Uint8Array {
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
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < value.length; i += 0x8000) {
    binary += String.fromCharCode(...value.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function normalizeRsaPrivateKey(pem: string): string {
  const normalized = pem.trim();
  if (normalized.includes("-----BEGIN PRIVATE KEY-----")) return `${normalized}\n`;
  if (!normalized.includes("-----BEGIN RSA PRIVATE KEY-----")) throw new Error("unsupported_private_key_format");
  const raw = normalized
    .replace("-----BEGIN RSA PRIVATE KEY-----", "")
    .replace("-----END RSA PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const pkcs1 = base64ToBytes(raw);
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithm = Uint8Array.of(0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00);
  const octet = concatBytes(Uint8Array.of(0x04), derLength(pkcs1.length), pkcs1);
  const body = concatBytes(version, rsaAlgorithm, octet);
  const pkcs8 = concatBytes(Uint8Array.of(0x30), derLength(body.length), body);
  const encoded = bytesToBase64(pkcs8);
  const lines = encoded.match(/.{1,64}/g)?.join("\n") || "";
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

async function appJwt(appId: number, privateKey: string): Promise<string> {
  const key = await importPKCS8(normalizeRsaPrivateKey(privateKey), "RS256");
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(String(appId))
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 540)
    .sign(key);
}

async function githubResponse(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${GITHUB_API}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": GITHUB_API_VERSION,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function githubJson(path: string, token: string, init: RequestInit = {}): Promise<any> {
  const response = await githubResponse(path, token, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  return payload;
}

async function revokeInstallationToken(token: string): Promise<void> {
  const response = await githubResponse("/installation/token", token, { method: "DELETE" });
  if (response.status !== 204) throw new Error(`github_token_revoke_${response.status}`);
}

async function mintInstallationToken(
  appToken: string,
  installationId: number,
  body: Record<string, unknown>,
): Promise<any> {
  return await githubJson(`/app/installations/${installationId}/access_tokens`, appToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function permissionSatisfied(actual: unknown, requested: "read" | "write"): boolean {
  if (actual === "write") return true;
  return actual === "read" && requested === "read";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let oidc: Record<string, unknown>;
  try {
    oidc = await verifyGithubOidc(req);
  } catch {
    return json(401, { error: "oidc_identity_rejected" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "broker_configuration_missing" });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let privateKey = "";
  let resolverToken = "";
  let workloadToken = "";
  let workloadTokenReturned = false;
  try {
    const input = await readJson(req);
    const repository = text(input.repository, 256);
    const [owner, repoName, extra] = repository.split("/");
    if (owner !== TRUSTED_OWNER || !repoName || extra) throw new Error("repository_rejected");
    const permissions = normalizePermissions(input.permissions);
    const operation = text(input.operation, 256);
    const requestId = text(input.request_id, 256);

    const sessionResult = await admin
      .from("apex_github_bootstrap_sessions")
      .select("*")
      .eq("status", "completed")
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sessionResult.error || !sessionResult.data) throw new Error("github_app_not_bootstrapped");
    const session = sessionResult.data as any;
    const allowed = Array.isArray(session.expected_repositories)
      ? session.expected_repositories.filter((v: unknown) => typeof v === "string")
      : [];
    if (!allowed.includes(repository)) throw new Error("repository_not_allowlisted");
    if (!session.app_private_key_ref || !session.app_id || !session.installation_id) {
      throw new Error("github_app_identity_incomplete");
    }

    const resolved = await admin.rpc("resolve_apex_keymaster_secret_for_broker", {
      p_secret_ref: session.app_private_key_ref,
      p_provider: "github",
      p_request_id: `${requestId}-resolve`.slice(0, 256),
      p_actor: `github-oidc:${claim(oidc, "run_id")}`,
      p_operation: operation,
    });
    if (resolved.error || typeof resolved.data?.secret !== "string") {
      throw new Error(resolved.error?.message || "private_key_resolution_failed");
    }

    privateKey = resolved.data.secret;
    const jwt = await appJwt(Number(session.app_id), privateKey);
    privateKey = "";
    const installationId = Number(session.installation_id);

    const installation = await githubJson(`/app/installations/${installationId}`, jwt);
    if (
      Number(installation?.id) !== installationId ||
      Number(installation?.app_id) !== Number(session.app_id) ||
      String(installation?.account?.login || "") !== TRUSTED_OWNER ||
      String(installation?.account?.id || "") !== TRUSTED_OWNER_ID ||
      installation?.suspended_at
    ) throw new Error("github_installation_binding_rejected");

    const repositoryInstallation = await githubJson(`/repos/${owner}/${repoName}/installation`, jwt);
    if (Number(repositoryInstallation?.id) !== installationId) {
      throw new Error("repository_not_in_live_installation");
    }

    const resolver = await mintInstallationToken(jwt, installationId, {
      permissions: { metadata: "read" },
    });
    if (typeof resolver?.token !== "string" || !resolver.token) {
      throw new Error("resolver_token_invalid");
    }
    resolverToken = resolver.token;
    const repoMetadata = await githubJson(`/repos/${owner}/${repoName}`, resolverToken);
    const repositoryId = Number(repoMetadata?.id);
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0 || String(repoMetadata?.full_name || "") !== repository) {
      throw new Error("repository_identity_resolution_failed");
    }
    await revokeInstallationToken(resolverToken);
    resolverToken = "";

    const minted = await mintInstallationToken(jwt, installationId, {
      repository_ids: [repositoryId],
      permissions,
    });
    if (typeof minted?.token !== "string" || !minted.token || typeof minted?.expires_at !== "string") {
      throw new Error("github_installation_token_invalid");
    }
    workloadToken = minted.token;

    const granted = minted.permissions && typeof minted.permissions === "object" ? minted.permissions : {};
    for (const [name, level] of Object.entries(permissions)) {
      if (!permissionSatisfied((granted as Record<string, unknown>)[name], level)) {
        throw new Error("github_installation_token_permission_mismatch");
      }
    }
    if (Array.isArray(minted.repositories)) {
      const exact = minted.repositories.some(
        (repo: any) => Number(repo?.id) === repositoryId && String(repo?.full_name || "") === repository,
      );
      if (!exact || minted.repositories.length !== 1) {
        throw new Error("github_installation_token_repository_scope_mismatch");
      }
    }

    const readback = await githubResponse(`/repos/${owner}/${repoName}`, workloadToken);
    if (!readback.ok) throw new Error(`scoped_token_repository_readback_${readback.status}`);

    const receipt = await admin.rpc("apex_github_bootstrap_write_receipt", {
      p_bootstrap_ref: session.bootstrap_ref,
      p_request_id: requestId,
      p_action: "token_minted",
      p_actor: `github-oidc:${claim(oidc, "run_id")}`,
      p_outcome: "succeeded",
      p_metadata: {
        credential_path: "github_oidc",
        repository,
        repository_id: repositoryId,
        permissions,
        operation,
        expires_at: minted.expires_at,
        workflow_ref: claim(oidc, "workflow_ref"),
        workflow_sha: claim(oidc, "workflow_sha"),
        run_id: claim(oidc, "run_id"),
        run_attempt: claim(oidc, "run_attempt"),
        event_name: claim(oidc, "event_name"),
        installation_id: installationId,
        installation_scope: installation?.repository_selection || null,
        resolver_token_scope: "installation_metadata_read",
        resolver_token_revoked: true,
        workload_scope_method: "repository_ids",
        scoped_repository_readback: "verified",
        token_persisted: false,
      },
    });
    if (receipt.error) throw new Error(receipt.error.message || "receipt_failed");

    workloadTokenReturned = true;
    return json(200, {
      ok: true,
      token: workloadToken,
      expires_at: minted.expires_at,
      repository,
      repository_id: repositoryId,
      permissions,
      bootstrap_ref: session.bootstrap_ref,
      receipt_id: receipt.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "broker_failed";
    return json(message === "request_body_too_large" ? 413 : 400, { error: message.slice(0, 512) });
  } finally {
    privateKey = "";
    if (resolverToken) {
      try { await revokeInstallationToken(resolverToken); } catch { /* expires quickly; do not expose token */ }
      resolverToken = "";
    }
    if (workloadToken && !workloadTokenReturned) {
      try { await revokeInstallationToken(workloadToken); } catch { /* expires quickly; do not expose token */ }
    }
    workloadToken = "";
  }
});
