import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "npm:jose@6";

const TEAM_SLUG = "caseys-projects-d714883e";
const TEAM_ID = "team_H1szku6vjfHxo0rtPDSAZeee";
const PROJECT_NAME = "colossus-gateway";
const PROJECT_ID = "prj_fstQXOI5Kgw5omGnHE6Q1sHPndZq";
const ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;
const AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const MAX_BODY_BYTES = 70 * 1024;
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const MAX_GITHUB_PAGES = 20;

const responseHeaders = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function stringClaim(payload: JWTPayload, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

async function verifyWorkloadIdentity(req: Request): Promise<{ environment: "production" | "preview" }> {
  const token = req.headers.get("x-vercel-oidc-token")?.trim() || "";
  if (!token) throw new Error("workload_identity_missing");

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["RS256"],
    clockTolerance: 5,
  });

  const owner = stringClaim(payload, "owner");
  const ownerId = stringClaim(payload, "owner_id");
  const project = stringClaim(payload, "project");
  const projectId = stringClaim(payload, "project_id");
  const environment = stringClaim(payload, "environment");
  const subject = payload.sub || "";

  if (owner !== TEAM_SLUG || ownerId !== TEAM_ID || project !== PROJECT_NAME || projectId !== PROJECT_ID) {
    throw new Error("workload_identity_rejected");
  }

  const expectedSubject = `owner:${TEAM_SLUG}:project:${PROJECT_NAME}:environment:${environment}`;
  if ((environment === "production" || environment === "preview") && subject === expectedSubject) {
    return { environment };
  }

  throw new Error("workload_identity_rejected");
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("request_body_too_large");
  const body = await req.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error("request_body_too_large");
  try {
    const parsed = JSON.parse(body || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    throw new Error("invalid_json");
  }
}

function text(input: unknown, max = 256): string {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value || value.length > max) throw new Error("invalid_text_field");
  return value;
}

function optionalText(input: unknown, max = 2048): string | null {
  if (input === null || input === undefined || input === "") return null;
  const value = typeof input === "string" ? input.trim() : "";
  if (!value || value.length > max) throw new Error("invalid_optional_text_field");
  return value;
}

function requestId(input: unknown): string {
  const value = text(input, 256);
  if (value.length < 8) throw new Error("invalid_request_id");
  return value;
}

function scope(input: unknown): unknown[] | Record<string, unknown> {
  if (Array.isArray(input)) return input.slice(0, 100);
  if (input && typeof input === "object") return input as Record<string, unknown>;
  throw new Error("invalid_scope");
}

function detail(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  throw new Error("invalid_detail");
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

function sortedUniqueStrings(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("invalid_repository_list");
  const values = input.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  return [...new Set(values)].sort();
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function githubFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${GITHUB_API}${path}`, {
    ...init,
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
  const response = await githubFetch(path, token, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const accepted = response.headers.get("x-accepted-github-permissions");
    throw new Error(accepted ? `github_http_${response.status}:permissions=${accepted}` : `github_http_${response.status}`);
  }
  return payload;
}

async function resolveSecret(
  admin: SupabaseClient,
  secretRef: string,
  provider: string,
  operation: string,
  requestIdValue: string,
  actor: string,
): Promise<string> {
  const { data, error } = await admin.rpc("resolve_apex_keymaster_secret_for_broker", {
    p_secret_ref: secretRef,
    p_provider: provider,
    p_request_id: requestIdValue,
    p_actor: actor,
    p_operation: operation,
  });
  if (error || typeof data?.secret !== "string" || !data.secret) {
    throw new Error(error?.message || "secret_resolution_failed");
  }
  return data.secret;
}

async function createAppJwt(appId: number, privateKeyPem: string): Promise<string> {
  if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error("invalid_github_app_id");
  if (!privateKeyPem.includes("PRIVATE KEY")) throw new Error("invalid_github_private_key");
  const key = await importPKCS8(privateKeyPem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(String(appId))
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 540)
    .sign(key);
}

async function createInstallationToken(
  appJwt: string,
  installationId: number,
  options: { repositories?: string[]; permissions?: Record<string, "read" | "write"> } = {},
): Promise<{ token: string; expires_at: string; permissions: Record<string, string> }> {
  const body: Record<string, unknown> = {};
  if (options.repositories?.length) body.repositories = options.repositories;
  if (options.permissions && Object.keys(options.permissions).length) body.permissions = options.permissions;
  const payload = await githubJson(`/app/installations/${installationId}/access_tokens`, appJwt, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (typeof payload?.token !== "string" || typeof payload?.expires_at !== "string") {
    throw new Error("github_installation_token_invalid");
  }
  return {
    token: payload.token,
    expires_at: payload.expires_at,
    permissions: payload.permissions && typeof payload.permissions === "object" ? payload.permissions : {},
  };
}

async function listInstallationRepositories(token: string): Promise<string[]> {
  const repositories: string[] = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const payload = await githubJson(`/installation/repositories?per_page=100&page=${page}`, token);
    const items = Array.isArray(payload?.repositories) ? payload.repositories : [];
    for (const item of items) {
      if (typeof item?.full_name === "string") repositories.push(item.full_name);
    }
    if (items.length < 100) break;
    if (page === MAX_GITHUB_PAGES) throw new Error("github_repository_listing_too_large");
  }
  return [...new Set(repositories)].sort();
}

function boundedGithubPermissions(input: unknown): Record<string, "read" | "write"> {
  const allowed: Record<string, "read" | "write"> = {
    actions: "write",
    contents: "write",
    issues: "write",
    workflows: "write",
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { contents: "read" };
  const result: Record<string, "read" | "write"> = {};
  for (const [name, requested] of Object.entries(input as Record<string, unknown>)) {
    if (!(name in allowed)) throw new Error("github_permission_not_allowed");
    if (requested !== "read" && requested !== "write") throw new Error("invalid_github_permission_level");
    if (allowed[name] === "read" && requested === "write") throw new Error("github_permission_escalation_blocked");
    result[name] = requested;
  }
  return Object.keys(result).length ? result : { contents: "read" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let identity: { environment: "production" | "preview" };
  try {
    identity = await verifyWorkloadIdentity(req);
  } catch {
    return json(401, { error: "workload_identity_rejected" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "broker_configuration_missing" });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let input: Record<string, unknown>;
  try {
    input = await readJson(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_request";
    return json(message === "request_body_too_large" ? 413 : 400, { error: message });
  }

  const action = typeof input.action === "string" ? input.action : "";
  const actor = typeof input.actor === "string" && input.actor.trim()
    ? input.actor.trim().slice(0, 256)
    : `colossus-${identity.environment}`;

  try {
    if (action === "connect") {
      const secret = typeof input.secret === "string" ? input.secret : "";
      if (!secret || new TextEncoder().encode(secret).byteLength > 65536) throw new Error("invalid_secret_size");
      const { data, error } = await admin.rpc("store_apex_keymaster_secret", {
        p_provider: text(input.provider, 64).toLowerCase(),
        p_account_label: text(input.account_label ?? "default", 256),
        p_purpose: text(input.purpose, 256),
        p_scope: scope(input.scope ?? []),
        p_secret: secret,
        p_rotation_due_at: optionalText(input.rotation_due_at, 64),
        p_request_id: requestId(input.request_id),
        p_actor: actor,
        p_verification_status: optionalText(input.verification_status, 32) || "unverified",
        p_verification_detail: detail(input.verification_detail),
      });
      if (error) throw new Error(error.message || "connect_failed");
      return json(200, { ok: true, ...data, identity_environment: identity.environment });
    }

    if (action === "replace") {
      const secret = typeof input.secret === "string" ? input.secret : "";
      if (!secret || new TextEncoder().encode(secret).byteLength > 65536) throw new Error("invalid_secret_size");
      const { data, error } = await admin.rpc("replace_apex_keymaster_secret", {
        p_secret_ref: text(input.secret_ref, 64),
        p_secret: secret,
        p_rotation_due_at: optionalText(input.rotation_due_at, 64),
        p_request_id: requestId(input.request_id),
        p_actor: actor,
        p_verification_status: optionalText(input.verification_status, 32) || "unverified",
        p_verification_detail: detail(input.verification_detail),
      });
      if (error) throw new Error(error.message || "replace_failed");
      return json(200, { ok: true, ...data, identity_environment: identity.environment });
    }

    if (action === "revoke") {
      const { data, error } = await admin.rpc("revoke_apex_keymaster_secret", {
        p_secret_ref: text(input.secret_ref, 64),
        p_request_id: requestId(input.request_id),
        p_actor: actor,
        p_reason: optionalText(input.reason, 2048),
      });
      if (error) throw new Error(error.message || "revoke_failed");
      return json(200, { ok: true, ...data, identity_environment: identity.environment });
    }

    if (action === "verify") {
      const { data, error } = await admin.rpc("verify_apex_keymaster_secret", {
        p_secret_ref: text(input.secret_ref, 64),
        p_verification_status: text(input.verification_status, 32),
        p_verification_detail: detail(input.verification_detail),
        p_request_id: requestId(input.request_id),
        p_actor: actor,
      });
      if (error) throw new Error(error.message || "verify_failed");
      return json(200, { ok: true, ...data, identity_environment: identity.environment });
    }

    if (action === "inventory") {
      const { data, error } = await admin.rpc("apex_keymaster_inventory");
      if (error) throw new Error(error.message || "inventory_failed");
      return json(200, {
        ok: true,
        inventory: Array.isArray(data) ? data : [],
        identity_environment: identity.environment,
      });
    }

    if (action === "resolve") {
      const { data, error } = await admin.rpc("resolve_apex_keymaster_secret_for_broker", {
        p_secret_ref: text(input.secret_ref, 64),
        p_provider: text(input.provider, 64).toLowerCase(),
        p_request_id: requestId(input.request_id),
        p_actor: actor,
        p_operation: text(input.operation, 256),
      });
      if (error) throw new Error(error.message || "resolve_failed");
      return json(200, { ok: true, ...data, identity_environment: identity.environment });
    }

    if (action === "record_use") {
      const outcome = text(input.outcome, 32);
      if (!["succeeded", "failed", "blocked"].includes(outcome)) throw new Error("invalid_outcome");
      const { data, error } = await admin.rpc("record_apex_keymaster_use", {
        p_secret_ref: text(input.secret_ref, 64),
        p_request_id: requestId(input.request_id),
        p_actor: actor,
        p_operation: text(input.operation, 256),
        p_outcome: outcome,
        p_metadata: detail(input.metadata),
      });
      if (error) throw new Error(error.message || "record_use_failed");
      return json(200, { ok: true, ...data, identity_environment: identity.environment });
    }

    if (action === "github_bootstrap_begin") {
      const state = text(input.state, 512);
      const stateHash = await sha256Hex(state);
      const { data, error } = await admin.rpc("begin_apex_github_bootstrap_session", {
        p_state_hash: stateHash,
        p_request_id: requestId(input.request_id),
        p_actor: actor,
      });
      if (error) throw new Error(error.message || "github_bootstrap_begin_failed");
      return json(200, { ok: true, ...data, identity_environment: identity.environment });
    }

    if (action === "github_bootstrap_register") {
      const state = text(input.state, 512);
      const stateHash = await sha256Hex(state);
      const appId = Number(input.app_id);
      const appSlug = text(input.app_slug, 100);
      const clientId = typeof input.app_client_id === "string" ? input.app_client_id.trim().slice(0, 256) : "";
      let privateKey = typeof input.private_key === "string" ? input.private_key : "";
      if (!Number.isSafeInteger(appId) || appId <= 0 || !privateKey.includes("PRIVATE KEY")) {
        throw new Error("invalid_github_manifest_conversion");
      }

      let privateKeyRef = "";
      try {
        const stored = await admin.rpc("store_apex_keymaster_secret", {
          p_provider: "github",
          p_account_label: "glaciereq",
          p_purpose: "app_private_key",
          p_scope: ["mint-installation-token", "approved-repositories-only"],
          p_secret: privateKey,
          p_rotation_due_at: null,
          p_request_id: `${requestId(input.request_id)}-private-key`.slice(0, 256),
          p_actor: actor,
          p_verification_status: "unverified",
          p_verification_detail: { source: "github_app_manifest", app_id: appId, app_slug: appSlug },
        });
        if (stored.error || typeof stored.data?.secret_ref !== "string") {
          throw new Error(stored.error?.message || "github_private_key_store_failed");
        }
        privateKeyRef = stored.data.secret_ref;
        privateKey = "";

        const registered = await admin.rpc("register_apex_github_bootstrap_session", {
          p_state_hash: stateHash,
          p_app_id: appId,
          p_app_slug: appSlug,
          p_app_client_id: clientId || null,
          p_private_key_ref: privateKeyRef,
          p_client_secret_ref: null,
          p_request_id: requestId(input.request_id),
          p_actor: actor,
        });
        if (registered.error) throw new Error(registered.error.message || "github_bootstrap_register_failed");
        return json(200, { ok: true, ...registered.data, identity_environment: identity.environment });
      } catch (error) {
        if (privateKeyRef) {
          await admin.rpc("revoke_apex_keymaster_secret", {
            p_secret_ref: privateKeyRef,
            p_request_id: `${requestId(input.request_id)}-rollback`.slice(0, 256),
            p_actor: actor,
            p_reason: "github_bootstrap_registration_rollback",
          });
        }
        throw error;
      } finally {
        privateKey = "";
      }
    }

    if (action === "github_bootstrap_verify_installation") {
      const state = text(input.state, 512);
      const stateHash = await sha256Hex(state);
      const installationId = Number(input.installation_id);
      if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("invalid_installation_id");

      const sessionResult = await admin
        .from("apex_github_bootstrap_sessions")
        .select("*")
        .eq("state_hash", stateHash)
        .single();
      if (sessionResult.error || !sessionResult.data) throw new Error("bootstrap_session_not_found");
      const session = sessionResult.data as any;
      if (session.status !== "registered") throw new Error("bootstrap_session_not_verifiable");
      if (!session.app_private_key_ref || !session.app_id) throw new Error("bootstrap_app_identity_missing");

      let privateKey = await resolveSecret(
        admin,
        session.app_private_key_ref,
        "github",
        "verify_app_installation",
        `${requestId(input.request_id)}-resolve`.slice(0, 256),
        actor,
      );
      try {
        const appJwt = await createAppJwt(Number(session.app_id), privateKey);
        const installation = await githubJson(`/app/installations/${installationId}`, appJwt);
        if (Number(installation?.app_id) !== Number(session.app_id)) throw new Error("installation_app_mismatch");
        if (String(installation?.account?.login || "") !== String(session.owner_login)) {
          throw new Error("installation_owner_mismatch");
        }

        let minted = await createInstallationToken(appJwt, installationId);
        try {
          const observed = await listInstallationRepositories(minted.token);
          const expected = sortedUniqueStrings(session.expected_repositories);
          const missing = expected.filter((repo) => !observed.includes(repo));
          const extras = observed.filter((repo) => !expected.includes(repo));

          if (!sameStrings(expected, observed)) {
            await admin.rpc("apex_github_bootstrap_write_receipt", {
              p_bootstrap_ref: session.bootstrap_ref,
              p_request_id: requestId(input.request_id),
              p_action: "installation_verified",
              p_actor: actor,
              p_outcome: "blocked",
              p_metadata: { installation_id: installationId, missing, extras },
            });
            return json(409, {
              ok: false,
              error: "repository_allowlist_mismatch",
              missing,
              extras,
              configure_url: `https://github.com/settings/installations/${installationId}`,
            });
          }

          const readChecks: Array<Record<string, unknown>> = [];
          for (const repository of expected) {
            const response = await githubFetch(`/repos/${repository}`, minted.token);
            readChecks.push({ repository, status: response.status, ok: response.ok });
            if (!response.ok) throw new Error(`repository_read_verification_failed:${repository}`);
          }

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
            },
            p_request_id: requestId(input.request_id),
            p_actor: actor,
          });
          if (completed.error) throw new Error(completed.error.message || "github_bootstrap_complete_failed");
          return json(200, { ok: true, ...completed.data, live_read_checks: readChecks });
        } finally {
          minted.token = "";
        }
      } finally {
        privateKey = "";
      }
    }

    if (action === "github_mint_repository_token") {
      const repository = text(input.repository, 256);
      const [owner, repoName, extra] = repository.split("/");
      if (!owner || !repoName || extra) throw new Error("invalid_repository");
      const permissions = boundedGithubPermissions(input.permissions);
      const operation = text(input.operation, 256);
      const rid = requestId(input.request_id);

      const sessionResult = await admin
        .from("apex_github_bootstrap_sessions")
        .select("*")
        .eq("status", "completed")
        .order("installed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sessionResult.error || !sessionResult.data) throw new Error("github_app_not_bootstrapped");
      const session = sessionResult.data as any;
      const allowed = sortedUniqueStrings(session.expected_repositories);
      if (!allowed.includes(repository)) throw new Error("repository_not_allowlisted");

      let privateKey = await resolveSecret(
        admin,
        session.app_private_key_ref,
        "github",
        operation,
        `${rid}-resolve`.slice(0, 256),
        actor,
      );
      try {
        const appJwt = await createAppJwt(Number(session.app_id), privateKey);
        const minted = await createInstallationToken(appJwt, Number(session.installation_id), {
          repositories: [repoName],
          permissions,
        });
        const receipt = await admin.rpc("apex_github_bootstrap_write_receipt", {
          p_bootstrap_ref: session.bootstrap_ref,
          p_request_id: rid,
          p_action: "token_minted",
          p_actor: actor,
          p_outcome: "succeeded",
          p_metadata: { repository, permissions, operation, expires_at: minted.expires_at },
        });
        if (receipt.error) throw new Error(receipt.error.message || "github_token_receipt_failed");
        return json(200, {
          ok: true,
          token: minted.token,
          expires_at: minted.expires_at,
          repository,
          permissions,
          bootstrap_ref: session.bootstrap_ref,
          receipt_id: receipt.data,
          identity_environment: identity.environment,
        });
      } finally {
        privateKey = "";
      }
    }

    return json(400, { error: "unsupported_action" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "keymaster_request_failed";
    return json(400, { error: message.slice(0, 512) });
  }
});
