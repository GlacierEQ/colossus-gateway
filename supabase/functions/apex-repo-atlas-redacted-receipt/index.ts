import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);
const AUDIENCE = "apex-repo-atlas-redacted-receipt";
const TRUSTED_REPOSITORY = "GlacierEQ/apex-control-plane";
const TRUSTED_REPOSITORY_ID = "1251740621";
const TRUSTED_OWNER = "GlacierEQ";
const TRUSTED_OWNER_ID = "194243768";
const TRUSTED_WORKFLOW_REF =
  "GlacierEQ/apex-control-plane/.github/workflows/daily_audit.yml@refs/heads/main";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

const headers = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
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
  if (
    claim(p, "repository") !== TRUSTED_REPOSITORY ||
    claim(p, "repository_id") !== TRUSTED_REPOSITORY_ID ||
    claim(p, "repository_owner") !== TRUSTED_OWNER ||
    claim(p, "repository_owner_id") !== TRUSTED_OWNER_ID ||
    claim(p, "repository_visibility") !== "public" ||
    claim(p, "workflow_ref") !== TRUSTED_WORKFLOW_REF ||
    claim(p, "ref") !== "refs/heads/main" ||
    !new Set(["schedule", "workflow_dispatch"]).has(claim(p, "event_name"))
  ) {
    throw new Error("oidc_identity_rejected");
  }
  return p;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return json(405, { ok: false, error: "method_not_allowed" });
  let oidc: Record<string, unknown>;
  try {
    oidc = await verifyGithubOidc(req);
  } catch {
    return json(401, { ok: false, error: "oidc_identity_rejected" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "receipt_configuration_missing" });
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const snapshotResult = await admin
      .from("apex_repo_atlas_snapshots")
      .select("snapshot_id,repository_count,created_at,metadata")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotResult.error) throw new Error("snapshot_lookup_failed");
    if (!snapshotResult.data) {
      return json(503, { ok: false, error: "repo_atlas_snapshot_missing" });
    }

    const snapshot = snapshotResult.data as Record<string, unknown>;
    const metadata =
      snapshot.metadata && typeof snapshot.metadata === "object"
        ? snapshot.metadata as Record<string, unknown>
        : {};
    const createdAt = String(snapshot.created_at || "");
    const createdMs = Date.parse(createdAt);
    const ageMs = Number.isFinite(createdMs) ? Math.max(0, Date.now() - createdMs) : null;
    const repositoryCount = Number(snapshot.repository_count || 0);

    const auditResult = await admin
      .from("apex_repo_atlas_audit")
      .select("action,outcome,created_at")
      .eq("snapshot_id", snapshot.snapshot_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (auditResult.error) throw new Error("audit_lookup_failed");

    const fingerprint = await sha256Hex(
      `${String(snapshot.snapshot_id)}:${createdAt}`,
    );
    const safe = {
      schema_version: "1.0",
      receipt_type: "repo-atlas-health",
      ok: true,
      source: "private-repo-atlas",
      snapshot_fingerprint: fingerprint,
      snapshot_created_at: createdAt,
      snapshot_fresh: ageMs !== null && ageMs <= MAX_AGE_MS,
      repository_inventory_present: Number.isFinite(repositoryCount) && repositoryCount > 0,
      scan_mode: metadata.scan_mode === "metadata_only" ? "metadata_only" : "unknown",
      installation_scope: metadata.installation_scope === "all" ? "all" : "unknown",
      github_content_fetch: metadata.github_content_fetch === true,
      inventory_token_persisted: metadata.inventory_token_persisted === true,
      audit_chain_present: Boolean(auditResult.data),
      latest_audit_outcome:
        auditResult.data?.outcome === "succeeded" ? "succeeded" : "other",
      caller_run_id: claim(oidc, "run_id"),
      caller_run_attempt: claim(oidc, "run_attempt"),
      generated_at: new Date().toISOString(),
    };

    if (
      !safe.snapshot_fresh ||
      !safe.repository_inventory_present ||
      safe.scan_mode !== "metadata_only" ||
      safe.installation_scope !== "all" ||
      safe.github_content_fetch ||
      safe.inventory_token_persisted ||
      !safe.audit_chain_present
    ) {
      return json(503, { ...safe, ok: false, error: "repo_atlas_health_gate_failed" });
    }
    return json(200, safe);
  } catch (error) {
    const message = error instanceof Error ? error.message : "receipt_failed";
    return json(500, { ok: false, error: message.slice(0, 128) });
  }
});
