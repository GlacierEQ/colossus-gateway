import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "npm:jose@6";

const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const AUDIENCE = "apex-repo-atlas-estate-enrich";
const REPOSITORY = "GlacierEQ/apex-control-plane";
const REPOSITORY_ID = "1251740621";
const OWNER = "GlacierEQ";
const OWNER_ID = "194243768";
const REF = "refs/heads/main";
const WORKFLOW_REF = "GlacierEQ/apex-control-plane/.github/workflows/daily_audit.yml@refs/heads/main";
const ALLOWED_EVENTS = new Set(["schedule", "workflow_dispatch"]);
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const ACTOR = "github-oidc-estate-atlas-enrich";
const PAGE_SIZE = 1000;
const CONCURRENCY = 20;
const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
  "referrer-policy": "no-referrer",
};

type AtlasRow = {
  repository_id: number;
  full_name: string;
  is_fork: boolean;
  default_branch: string | null;
};

type EnrichmentRow = {
  repository_id: number;
  default_branch: string | null;
  default_head_sha: string | null;
  parent_repository_id: number | null;
  parent_full_name: string | null;
  source_repository_id: number | null;
  source_full_name: string | null;
  observed_at: string;
  metadata: Record<string, unknown>;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function claim(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((n, array) => n + array.length, 0));
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
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < value.length; index += 0x8000) {
    binary += String.fromCharCode(...value.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function normalizeRsaPrivateKey(pem: string): string {
  const normalized = pem.trim();
  if (normalized.includes("-----BEGIN PRIVATE KEY-----")) return `${normalized}\n`;
  if (!normalized.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    throw new Error("unsupported_private_key_format");
  }
  const raw = normalized
    .replace("-----BEGIN RSA PRIVATE KEY-----", "")
    .replace("-----END RSA PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const pkcs1 = base64ToBytes(raw);
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const algorithm = Uint8Array.of(
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  );
  const octet = concatBytes(Uint8Array.of(0x04), derLength(pkcs1.length), pkcs1);
  const body = concatBytes(version, algorithm, octet);
  const pkcs8 = concatBytes(Uint8Array.of(0x30), derLength(body.length), body);
  const encoded = bytesToBase64(pkcs8);
  const lines = encoded.match(/.{1,64}/g)?.join("\n") || "";
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

async function makeAppJwt(appId: number, privateKey: string): Promise<string> {
  const key = await importPKCS8(normalizeRsaPrivateKey(privateKey), "RS256");
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(String(appId))
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 540)
    .sign(key);
}

async function github(path: string, token: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
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
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw error;
    throw new Error("github_transport_failed");
  }
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error("github_response_invalid_json");
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await fn(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function fullName(value: unknown): string | null {
  return typeof value === "string" && /^[^/]+\/[^/]+$/.test(value) ? value : null;
}

function safeFailure(error: unknown): { status: number; code: string; retryable: boolean } {
  const message = error instanceof Error ? error.message : "";
  const name = error instanceof Error ? error.name : "";
  if (message === "snapshot_changed_since_refresh") {
    return { status: 409, code: message, retryable: true };
  }
  if (message === "github_app_binding_rejected" || message === "all_repository_installation_not_verified") {
    return { status: 409, code: message, retryable: false };
  }
  const githubStatus = /^github_http_(\d{3})$/.exec(message);
  if (githubStatus) {
    const status = Number(githubStatus[1]);
    return {
      status: status === 429 || status >= 500 ? 503 : 502,
      code: "github_dependency_failed",
      retryable: status === 429 || status >= 500,
    };
  }
  if (name === "TimeoutError" || /timed out|timeout/i.test(message)) {
    return { status: 504, code: "github_dependency_timeout", retryable: true };
  }
  if (message === "github_transport_failed" || message === "github_response_invalid_json") {
    return { status: 502, code: "github_dependency_failed", retryable: true };
  }
  if (message === "github_app_not_bootstrapped" || message === "private_key_resolution_failed") {
    return { status: 503, code: "estate_enrichment_dependency_unavailable", retryable: true };
  }
  return { status: 500, code: "estate_atlas_enrichment_failed", retryable: false };
}

async function fetchLatestSnapshot(admin: any): Promise<{ snapshot_id: string; repository_count: number }> {
  const result = await admin
    .from("apex_repo_atlas_snapshots")
    .select("snapshot_id,repository_count,metadata,created_at")
    .eq("installation_id", 151808478)
    .order("created_at", { ascending: false })
    .limit(20);
  if (result.error) throw new Error("snapshot_lookup_failed");
  const snapshot = (result.data || []).find(
    (row: any) => row?.metadata?.refresh_status === "refreshed" || row?.metadata?.seed_status === "seeded",
  );
  if (!snapshot || typeof snapshot.snapshot_id !== "string") throw new Error("finalized_snapshot_not_found");
  return {
    snapshot_id: snapshot.snapshot_id,
    repository_count: Number(snapshot.repository_count),
  };
}

async function fetchAtlasRows(admin: any, snapshotId: string): Promise<AtlasRow[]> {
  const rows: AtlasRow[] = [];
  let from = 0;
  while (from < 100_000) {
    const result = await admin
      .from("apex_repo_atlas_repositories")
      .select("repository_id,full_name,is_fork,default_branch")
      .eq("snapshot_id", snapshotId)
      .order("repository_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error("atlas_repository_read_failed");
    const page = Array.isArray(result.data) ? result.data : [];
    if (!page.length) break;
    rows.push(...page.map((row: any) => ({
      repository_id: Number(row.repository_id),
      full_name: String(row.full_name),
      is_fork: Boolean(row.is_fork),
      default_branch: typeof row.default_branch === "string" ? row.default_branch : null,
    })));
    from += page.length;
  }
  return rows;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json(401, { ok: false, error: "oidc_missing" });

  let oidcPayload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(authorization.slice(7).trim(), JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });
    oidcPayload = verified.payload as Record<string, unknown>;
  } catch {
    return json(401, { ok: false, error: "oidc_rejected" });
  }

  const eventName = claim(oidcPayload, "event_name");
  if (
    claim(oidcPayload, "repository") !== REPOSITORY ||
    claim(oidcPayload, "repository_id") !== REPOSITORY_ID ||
    claim(oidcPayload, "repository_owner") !== OWNER ||
    claim(oidcPayload, "repository_owner_id") !== OWNER_ID ||
    claim(oidcPayload, "repository_visibility") !== "public" ||
    claim(oidcPayload, "ref") !== REF ||
    claim(oidcPayload, "workflow_ref") !== WORKFLOW_REF ||
    !ALLOWED_EVENTS.has(eventName)
  ) {
    return json(401, { ok: false, error: "oidc_identity_rejected" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json(500, { ok: false, error: "broker_configuration_missing" });
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let privateKey = "";
  let appJwt = "";
  let installationToken = "";
  try {
    const snapshot = await fetchLatestSnapshot(admin);
    const existing = await admin
      .from("apex_repo_atlas_enrichment_receipts")
      .select("receipt_id,enrichment_root_sha256,repository_count,enriched_count,default_head_count,fork_lineage_count")
      .eq("snapshot_id", snapshot.snapshot_id)
      .maybeSingle();
    if (existing.error) throw new Error("enrichment_receipt_lookup_failed");
    if (existing.data) {
      return json(200, {
        ok: true,
        status: "already_enriched",
        snapshot_id: snapshot.snapshot_id,
        repository_count: existing.data.repository_count,
        enriched_count: existing.data.enriched_count,
        default_head_count: existing.data.default_head_count,
        fork_lineage_count: existing.data.fork_lineage_count,
        enrichment_root_sha256: existing.data.enrichment_root_sha256,
        github_writes: 0,
        token_persisted: false,
      });
    }

    const atlasRows = await fetchAtlasRows(admin, snapshot.snapshot_id);
    if (atlasRows.length !== snapshot.repository_count) throw new Error("atlas_repository_count_mismatch");

    const sessionResult = await admin
      .from("apex_github_bootstrap_sessions")
      .select("*")
      .eq("status", "completed")
      .eq("owner_login", OWNER)
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sessionResult.error || !sessionResult.data) throw new Error("github_app_not_bootstrapped");
    const session = sessionResult.data as any;
    const appId = Number(session.app_id);
    const appSlug = String(session.app_slug || "");
    const installationId = Number(session.installation_id);
    if (
      !session.installed_at ||
      !session.app_private_key_ref ||
      !Number.isSafeInteger(appId) || appId <= 0 ||
      !Number.isSafeInteger(installationId) || installationId <= 0 ||
      !appSlug ||
      session.verification_detail?.installation_scope !== "all" ||
      String(session.verification_detail?.owner_login || "") !== OWNER
    ) {
      throw new Error("github_app_binding_rejected");
    }

    const runId = claim(oidcPayload, "run_id") || "unknown";
    const requestId = `oidc-estate-enrich-${runId}-${crypto.randomUUID()}`.slice(0, 256);
    const resolved = await admin.rpc("resolve_apex_keymaster_secret_for_broker", {
      p_secret_ref: session.app_private_key_ref,
      p_provider: "github",
      p_request_id: `${requestId}-resolve`.slice(0, 256),
      p_actor: `${ACTOR}:${runId}`,
      p_operation: "estate_snapshot_head_and_lineage_read",
    });
    if (resolved.error || typeof resolved.data?.secret !== "string") {
      throw new Error("private_key_resolution_failed");
    }
    privateKey = resolved.data.secret;
    appJwt = await makeAppJwt(appId, privateKey).finally(() => {
      privateKey = "";
    });

    const liveInstallation = await github(`/app/installations/${installationId}`, appJwt);
    if (
      Number(liveInstallation?.id) !== installationId ||
      Number(liveInstallation?.app_id) !== appId ||
      String(liveInstallation?.account?.login || "") !== OWNER ||
      String(liveInstallation?.account?.id || "") !== OWNER_ID
    ) {
      throw new Error("github_app_binding_rejected");
    }
    if (liveInstallation?.repository_selection !== "all") {
      throw new Error("all_repository_installation_not_verified");
    }

    const minted = await github(`/app/installations/${installationId}/access_tokens`, appJwt, {
      method: "POST",
      body: JSON.stringify({ permissions: { metadata: "read", contents: "read" } }),
    }).finally(() => {
      appJwt = "";
    });
    if (typeof minted?.token !== "string" || typeof minted?.expires_at !== "string") {
      throw new Error("inventory_token_invalid");
    }
    if (minted?.permissions?.contents !== "read") throw new Error("contents_read_not_granted");
    installationToken = minted.token;

    const forkDetails = new Map<number, any>();
    const forkRows = atlasRows.filter((row) => row.is_fork);
    const details = await mapConcurrent(forkRows, CONCURRENCY, async (row) => {
      const detail = await github(`/repos/${row.full_name}`, installationToken);
      if (Number(detail?.id) !== row.repository_id || String(detail?.full_name || "") !== row.full_name) {
        throw new Error("snapshot_changed_since_refresh");
      }
      return { repository_id: row.repository_id, detail };
    });
    for (const item of details) forkDetails.set(item.repository_id, item.detail);

    const enriched = await mapConcurrent(atlasRows, CONCURRENCY, async (row): Promise<EnrichmentRow> => {
      let headSha: string | null = null;
      if (row.default_branch) {
        const branch = await github(
          `/repos/${row.full_name}/branches/${encodeURIComponent(row.default_branch)}`,
          installationToken,
        );
        if (String(branch?.name || "") !== row.default_branch) {
          throw new Error("snapshot_changed_since_refresh");
        }
        const sha = typeof branch?.commit?.sha === "string" ? branch.commit.sha.toLowerCase() : "";
        if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) throw new Error("default_head_invalid");
        headSha = sha;
      }

      const detail = forkDetails.get(row.repository_id);
      const parentId = row.is_fork ? positiveId(detail?.parent?.id) : null;
      const parentName = row.is_fork ? fullName(detail?.parent?.full_name) : null;
      const sourceId = row.is_fork ? positiveId(detail?.source?.id) : null;
      const sourceName = row.is_fork ? fullName(detail?.source?.full_name) : null;
      if (row.is_fork && (!parentId || !parentName || !sourceId || !sourceName)) {
        throw new Error("fork_lineage_incomplete");
      }

      return {
        repository_id: row.repository_id,
        default_branch: row.default_branch,
        default_head_sha: headSha,
        parent_repository_id: parentId,
        parent_full_name: parentName,
        source_repository_id: sourceId,
        source_full_name: sourceName,
        observed_at: new Date().toISOString(),
        metadata: { full_name: row.full_name, fork: row.is_fork },
      };
    });
    installationToken = "";

    enriched.sort((left, right) => left.repository_id - right.repository_id);
    const integrityPayload = enriched.map((row) => ({
      repository_id: row.repository_id,
      default_branch: row.default_branch,
      default_head_sha: row.default_head_sha,
      parent_repository_id: row.parent_repository_id,
      parent_full_name: row.parent_full_name,
      source_repository_id: row.source_repository_id,
      source_full_name: row.source_full_name,
    }));
    const root = await sha256Hex(JSON.stringify(integrityPayload));
    const finalized = await admin.rpc("finalize_apex_repo_atlas_enrichment", {
      p_snapshot_id: snapshot.snapshot_id,
      p_rows: enriched,
      p_enrichment_root_sha256: root,
      p_metadata: {
        source: "github_oidc_estate_atlas_enrichment",
        run_id: runId,
        workflow_ref: claim(oidcPayload, "workflow_ref"),
        workflow_sha: claim(oidcPayload, "workflow_sha"),
        installation_id: installationId,
        installation_scope: "all",
        permissions: { metadata: "read", contents: "read" },
        github_writes: 0,
        token_persisted: false,
      },
    });
    if (finalized.error || typeof finalized.data !== "string") {
      throw new Error("enrichment_finalize_failed");
    }

    const defaultHeadCount = enriched.filter((row) => row.default_head_sha !== null).length;
    const forkLineageCount = enriched.filter((row) => row.source_repository_id !== null).length;
    return json(200, {
      ok: true,
      status: "enriched",
      snapshot_id: snapshot.snapshot_id,
      receipt_id: finalized.data,
      repository_count: snapshot.repository_count,
      enriched_count: enriched.length,
      default_head_count: defaultHeadCount,
      fork_lineage_count: forkLineageCount,
      enrichment_root_sha256: root,
      github_writes: 0,
      token_persisted: false,
    });
  } catch (error) {
    const failure = safeFailure(error);
    return json(failure.status, {
      ok: false,
      error: failure.code,
      retryable: failure.retryable,
    });
  } finally {
    privateKey = "";
    appJwt = "";
    installationToken = "";
  }
});
