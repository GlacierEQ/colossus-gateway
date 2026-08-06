import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

const TEAM_SLUG = "caseys-projects-d714883e";
const TEAM_ID = "team_H1szku6vjfHxo0rtPDSAZeee";
const PROJECT_NAME = "colossus-gateway";
const PROJECT_ID = "prj_fstQXOI5Kgw5omGnHE6Q1sHPndZq";
const ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;
const AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const MAX_BODY_BYTES = 70 * 1024;

const responseHeaders = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
  "pragma": "no-cache",
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
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("request_body_too_large");
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
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

    // Internal broker primitive. It is reachable only with the bound Vercel workload identity.
    // Client-facing routes must never relay the `secret` field.
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
      if (!['succeeded', 'failed', 'blocked'].includes(outcome)) throw new Error("invalid_outcome");
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

    return json(400, { error: "unsupported_action" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "keymaster_request_failed";
    // Do not include request input or upstream details; they may contain secrets.
    return json(400, { error: message.slice(0, 512) });
  }
});
