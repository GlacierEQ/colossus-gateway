import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

const TEAM_SLUG = "caseys-projects-d714883e";
const TEAM_ID = "team_H1szku6vjfHxo0rtPDSAZeee";
const PROJECT_NAME = "colossus-gateway";
const PROJECT_ID = "prj_fstQXOI5Kgw5omGnHE6Q1sHPndZq";
const HARDENING_BRANCH = "hardening/chunk-1-oidc-auth-20260726";
const ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;
const AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const NOTION_VERSION = "2026-03-11";
const MAX_BODY_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

const responseHeaders = {
  "content-type": "application/json",
  "cache-control": "no-store",
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
  const gitRef = stringClaim(payload, "git_ref");
  const subject = payload.sub || "";

  if (owner !== TEAM_SLUG || ownerId !== TEAM_ID || project !== PROJECT_NAME || projectId !== PROJECT_ID) {
    throw new Error("workload_identity_rejected");
  }

  const productionSubject = `owner:${TEAM_SLUG}:project:${PROJECT_NAME}:environment:production`;
  if (environment === "production" && subject === productionSubject) return { environment: "production" };

  const previewSubject = `owner:${TEAM_SLUG}:project:${PROJECT_NAME}:environment:preview`;
  if (environment === "preview" && subject === previewSubject && gitRef === HARDENING_BRANCH) {
    return { environment: "preview" };
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

function titleOf(item: any): string {
  const candidates = [
    item?.title,
    item?.properties?.title?.title,
    item?.properties?.Name?.title,
    item?.properties?.name?.title,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate[0]?.plain_text) return String(candidate[0].plain_text);
  }
  return "Untitled";
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

  const action = input.action;

  if (action === "connect") {
    const token = typeof input.token === "string" ? input.token.trim() : "";
    const capability = typeof input.capability === "string" ? input.capability : "";
    if (!/^ntn_[A-Za-z0-9_-]{16,508}$/.test(token) || !capability) {
      return json(400, { error: "token_and_capability_required" });
    }

    const { data, error } = await admin.rpc("store_apex_notion_token", {
      p_nonce: capability,
      p_token: token,
    });
    if (error) return json(401, { error: "notion_connect_failed" });
    return json(200, {
      ok: true,
      connected: true,
      storage: "supabase_vault",
      identity_environment: identity.environment,
      token_sha256: data?.token_sha256,
    });
  }

  if (action === "status") {
    const { data, error } = await admin.rpc("apex_notion_connection_status");
    if (error) return json(500, { error: "status_failed" });
    return json(200, { ...data, identity_environment: identity.environment });
  }

  if (action === "search") {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    const limit = Math.min(Math.max(Number(input.limit || 10), 1), 100);
    if (!query || query.length > 500) return json(400, { error: "query_required" });

    const { data: token, error: tokenError } = await admin.rpc("get_apex_notion_token");
    if (tokenError || !token) return json(401, { error: "notion_not_connected" });

    let notionResponse: Response;
    try {
      notionResponse = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "notion-version": NOTION_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          page_size: limit,
          sort: { direction: "descending", timestamp: "last_edited_time" },
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      return json(504, { error: "notion_api_timeout" });
    }

    const payload = await notionResponse.json().catch(() => ({}));
    if (!notionResponse.ok) {
      return json(notionResponse.status, {
        error: "notion_api_error",
        status: notionResponse.status,
        code: payload?.code,
      });
    }

    const results = Array.isArray(payload?.results)
      ? payload.results.slice(0, limit).map((item: any) => ({
          id: item?.id,
          object: item?.object,
          url: item?.url,
          last_edited_time: item?.last_edited_time,
          title: titleOf(item),
        }))
      : [];

    return json(200, {
      ok: true,
      provider: "notion",
      direct_api: true,
      identity_environment: identity.environment,
      query,
      result_count: results.length,
      results,
    });
  }

  return json(400, { error: "unsupported_action" });
});
