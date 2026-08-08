import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "npm:jose@6";

const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const AUDIENCE = "apex-repo-atlas-estate-refresh";
const REPOSITORY = "GlacierEQ/apex-control-plane";
const REPOSITORY_ID = "1251740621";
const OWNER = "GlacierEQ";
const OWNER_ID = "194243768";
const REF = "refs/heads/main";
const WORKFLOW_REF = "GlacierEQ/apex-control-plane/.github/workflows/daily_audit.yml@refs/heads/main";
const ALLOWED_EVENTS = new Set(["schedule", "workflow_dispatch"]);
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_REPOSITORY_PAGES = 100;
const PAGE_SIZE = 1000;
const ACTOR = "github-oidc-estate-atlas-refresh";
const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
  "referrer-policy": "no-referrer",
};
const QUEUE_STATUSES = new Set([
  "queued",
  "inspecting",
  "ready",
  "blocked",
  "completed",
  "superseded",
  "reference",
  "quarantine",
]);

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
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
    0x05,
    0x00,
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

function safeFailure(error: unknown): { status: number; code: string; retryable: boolean } {
  const message = error instanceof Error ? error.message : "";
  const name = error instanceof Error ? error.name : "";
  if (message.includes("repo_atlas_refresh_in_progress")) {
    return { status: 409, code: "refresh_in_progress", retryable: true };
  }
  if (message.includes("repo_atlas_refresh_lease_lost")) {
    return { status: 409, code: "refresh_lease_lost", retryable: true };
  }
  if (message === "repository_inventory_changed_during_scan") {
    return { status: 409, code: "repository_inventory_changed_during_scan", retryable: true };
  }
  if (message === "github_app_binding_rejected" || message === "all_repository_installation_not_verified") {
    return { status: 409, code: message, retryable: false };
  }
  if (
    message === "github_transport_failed" ||
    message === "github_response_invalid_json" ||
    message === "repository_inventory_invalid" ||
    message === "repository_inventory_count_mismatch"
  ) {
    return { status: 502, code: "github_dependency_failed", retryable: true };
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
  if (
    message === "github_app_not_bootstrapped" ||
    message === "repo_atlas_refresh_claim_failed" ||
    message === "private_key_resolution_failed"
  ) {
    return { status: 503, code: "estate_refresh_dependency_unavailable", retryable: true };
  }
  if (message === "broker_configuration_missing") {
    return { status: 500, code: "broker_configuration_missing", retryable: false };
  }
  return { status: 500, code: "estate_atlas_refresh_failed", retryable: false };
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function family(name: string, description: string): string {
  const value = `${name} ${description}`.toLowerCase();
  if (/1fdv|1fda|legal|court|case|docket|law|brief|motion|evidence|litigation|tro|family/.test(value)) {
    return "legal_evidence";
  }
  if (/colossus|control.?plane|orchestr|mastermind|monolith|\bakos\b|\baeon\b|\bapex\b|gateway|omni/.test(value)) {
    return "control_plane";
  }
  if (/memory|mem0|supermemory|recall|vector|embed|rag|knowledge/.test(value)) return "memory_retrieval";
  if (/pdf|document|ocr|office|word|docx/.test(value)) return "document_intelligence";
  if (/file|filesystem|\bfs\b|sorter|navigator|commander|storage/.test(value)) return "file_operations";
  if (/runner|actions|worker|daemon|deploy|vercel|supabase|runtime/.test(value)) return "runtime_deployment";
  if (/browser|extension|selenium|playwright|web.?agent/.test(value)) return "browser_automation";
  if (/security|cyber|forensic|antivirus|defense|osint/.test(value)) return "security_forensics";
  if (/agent|assistant|autogpt|crew|swarm|claw|aider|cline/.test(value)) return "agents";
  if (/research|scientist|deepseek|\bllm\b|\bgpt\b|claude|gemma|kimi|minimax|model/.test(value)) {
    return "research_models";
  }
  if (/frontend|dashboard|\bui\b|website|mobile|android|swift/.test(value)) return "interfaces";
  return "other";
}

function lifecycle(repo: any): string {
  const name = String(repo?.name || "").toLowerCase();
  if (repo?.archived) return "archived";
  if (/^z[-_]?backup|backup|archive|old[-_]|legacy/.test(name)) return "backup";
  if (repo?.fork) return "reference";
  const pushed = repo?.pushed_at ? Date.parse(repo.pushed_at) : 0;
  const ageDays = pushed ? (Date.now() - pushed) / 86_400_000 : Number.POSITIVE_INFINITY;
  if (!pushed || ageDays > 365) return "dormant";
  if (ageDays > 90) return "cool";
  return "active";
}

function signature(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/z[-_]?backup[-_]?/g, "")
      .replace(/\b(main|master|backup|archive|legacy|unified|pro|max|plus|source|public|private)\b/g, "")
      .replace(/[-_.]+v?\d+(?:\.\d+)*/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 120) || name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 120)
  );
}

function score(repo: any, repoFamily: string, repoLifecycle: string) {
  let value = 0;
  const reasons: string[] = [];
  const pushed = repo?.pushed_at ? Date.parse(repo.pushed_at) : 0;
  const ageDays = pushed ? (Date.now() - pushed) / 86_400_000 : Number.POSITIVE_INFINITY;
  if (ageDays <= 7) {
    value += 45;
    reasons.push("pushed_within_7_days");
  } else if (ageDays <= 30) {
    value += 35;
    reasons.push("pushed_within_30_days");
  } else if (ageDays <= 90) {
    value += 20;
    reasons.push("pushed_within_90_days");
  }
  if (!repo?.fork) {
    value += 20;
    reasons.push("original_repository");
  } else {
    value -= 30;
    reasons.push("fork_reference");
  }
  if (Number(repo?.size || 0) >= 100) {
    value += 10;
    reasons.push("substantive_repository");
  }
  if (repo?.description) {
    value += 5;
    reasons.push("described");
  }
  if (
    [
      "control_plane",
      "runtime_deployment",
      "legal_evidence",
      "memory_retrieval",
      "document_intelligence",
      "file_operations",
    ].includes(repoFamily)
  ) {
    value += 10;
    reasons.push("strategic_family");
  }
  if (/colossus|control|mastermind|monolith|akos|aeon|apex|gateway|canonical|unified/i.test(String(repo?.name || ""))) {
    value += 15;
    reasons.push("canonical_signal");
  }
  if (repoLifecycle === "backup" || repoLifecycle === "archived") {
    value -= 50;
    reasons.push("backup_or_archived");
  }
  if (repoLifecycle === "dormant") {
    value -= 10;
    reasons.push("dormant");
  }
  return { score: value, reasons };
}

function repoRow(snapshotId: string, repo: any) {
  const repoFamily = family(String(repo?.name || ""), String(repo?.description || ""));
  const repoLifecycle = lifecycle(repo);
  const scored = score(repo, repoFamily, repoLifecycle);
  return {
    snapshot_id: snapshotId,
    repository_id: Number(repo.id),
    full_name: String(repo.full_name),
    name: String(repo.name),
    visibility: repo.visibility ?? null,
    is_private: Boolean(repo.private),
    is_fork: Boolean(repo.fork),
    is_archived: Boolean(repo.archived),
    default_branch: repo.default_branch ?? null,
    size_kb: Number(repo.size || 0),
    language: repo.language ?? null,
    description: repo.description ?? null,
    homepage: repo.homepage ?? null,
    pushed_at: iso(repo.pushed_at),
    updated_at: iso(repo.updated_at),
    family: repoFamily,
    lifecycle: repoLifecycle,
    name_signature: signature(String(repo.name)),
    ignition_score: scored.score,
    metadata: {
      html_url: repo.html_url ?? null,
      has_issues: repo.has_issues ?? null,
      has_projects: repo.has_projects ?? null,
      has_discussions: repo.has_discussions ?? null,
      reasons: scored.reasons,
    },
  };
}

function comparable(row: any) {
  return {
    full_name: row.full_name ?? null,
    name: row.name ?? null,
    visibility: row.visibility ?? null,
    is_private: Boolean(row.is_private),
    is_fork: Boolean(row.is_fork),
    is_archived: Boolean(row.is_archived),
    default_branch: row.default_branch ?? null,
    size_kb: Number(row.size_kb || 0),
    language: row.language ?? null,
    description: row.description ?? null,
    homepage: row.homepage ?? null,
    pushed_at: iso(row.pushed_at),
    updated_at: iso(row.updated_at),
    family: row.family ?? null,
    lifecycle: row.lifecycle ?? null,
    name_signature: row.name_signature ?? null,
    ignition_score: Number(row.ignition_score || 0),
    reasons: Array.isArray(row.metadata?.reasons)
      ? row.metadata.reasons.map((reason: unknown) => String(reason)).sort()
      : [],
    html_url: row.metadata?.html_url ?? null,
    has_issues: row.metadata?.has_issues ?? null,
    has_projects: row.metadata?.has_projects ?? null,
    has_discussions: row.metadata?.has_discussions ?? null,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function renewRefreshLease(admin: any, claimId: string): Promise<void> {
  if (!claimId) throw new Error("repo_atlas_refresh_lease_lost");
  const renewed = await admin.rpc("renew_apex_repo_atlas_refresh", { p_claim_id: claimId });
  if (renewed.error || typeof renewed.data !== "string") {
    throw new Error("repo_atlas_refresh_lease_lost");
  }
}

function snapshotOrderColumn(table: string): string {
  if (table === "apex_repo_atlas_repositories") return "repository_id";
  if (table === "apex_repo_ignition_queue") return "priority";
  if (table === "apex_repo_canonical_registry") return "registry_id";
  throw new Error("unsupported_snapshot_table");
}

async function fetchSnapshotRows(
  admin: any,
  table: string,
  snapshotId: string,
  claimId: string,
): Promise<any[]> {
  const output: any[] = [];
  const orderColumn = snapshotOrderColumn(table);
  let from = 0;
  while (from < 100_000) {
    await renewRefreshLease(admin, claimId);
    const result = await admin
      .from(table)
      .select("*")
      .eq("snapshot_id", snapshotId)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error(`${table}_read_failed`);
    const data = Array.isArray(result.data) ? result.data : [];
    if (data.length === 0) return output;
    output.push(...data);
    from += data.length;
  }
  throw new Error(`${table}_exceeds_page_limit`);
}

async function latestFinalizedSnapshot(
  admin: any,
  installationId: number,
  claimId: string,
): Promise<any | null> {
  let from = 0;
  while (from < 10_000) {
    await renewRefreshLease(admin, claimId);
    const result = await admin
      .from("apex_repo_atlas_snapshots")
      .select("snapshot_id,installation_id,created_at,metadata")
      .eq("installation_id", installationId)
      .order("created_at", { ascending: false })
      .range(from, from + 99);
    if (result.error) throw new Error("previous_snapshot_lookup_failed");
    const data = Array.isArray(result.data) ? result.data : [];
    if (data.length === 0) return null;
    const finalized = data.find(
      (row: any) =>
        row?.metadata?.refresh_status === "refreshed" || row?.metadata?.seed_status === "seeded",
    );
    if (finalized) return finalized;
    from += data.length;
  }
  throw new Error("previous_snapshot_lookup_exceeds_page_limit");
}

function memberSummary(row: any) {
  return {
    full_name: row.full_name,
    fork: row.is_fork,
    archived: row.is_archived,
    lifecycle: row.lifecycle,
    size_kb: row.size_kb,
    pushed_at: row.pushed_at,
    ignition_score: row.ignition_score,
  };
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
    console.warn("[estate-atlas-refresh] oidc_verification_rejected");
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
    console.warn("[estate-atlas-refresh] oidc_identity_rejected");
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
  let snapshotId = "";
  let refreshClaimId = "";
  try {
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
    if (
      !session.installed_at ||
      !session.app_private_key_ref ||
      !Number.isSafeInteger(appId) ||
      appId <= 0 ||
      !appSlug ||
      session.verification_detail?.installation_scope !== "all" ||
      String(session.verification_detail?.owner_login || "") !== OWNER ||
      Number(session.verification_detail?.app_id) !== appId ||
      String(session.verification_detail?.app_slug || "") !== appSlug
    ) {
      throw new Error("github_app_binding_rejected");
    }
    // expires_at bounded the one-time bootstrap capability. After successful completion,
    // the verified GitHub App installation is durable; every refresh is independently
    // authorized by a fresh, tightly bound GitHub Actions OIDC assertion above.
    const installationId = Number(session.installation_id);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new Error("invalid_installation_id");
    }

    const refreshClaim = await admin.rpc("claim_apex_repo_atlas_refresh");
    if (refreshClaim.error || typeof refreshClaim.data !== "string") {
      const claimMessage = refreshClaim.error?.message || "";
      if (claimMessage.includes("repo_atlas_refresh_in_progress")) {
        throw new Error("repo_atlas_refresh_in_progress");
      }
      throw new Error("repo_atlas_refresh_claim_failed");
    }
    refreshClaimId = refreshClaim.data;
    await renewRefreshLease(admin, refreshClaimId);

    const runId = claim(oidcPayload, "run_id") || "unknown";
    const requestId = `oidc-estate-${runId}-${crypto.randomUUID()}`.slice(0, 256);
    const resolved = await admin.rpc("resolve_apex_keymaster_secret_for_broker", {
      p_secret_ref: session.app_private_key_ref,
      p_provider: "github",
      p_request_id: `${requestId}-resolve`.slice(0, 256),
      p_actor: `${ACTOR}:${runId}`,
      p_operation: "metadata_only_estate_refresh",
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
      body: JSON.stringify({ permissions: { metadata: "read" } }),
    }).finally(() => {
      appJwt = "";
    });
    if (typeof minted?.token !== "string" || typeof minted?.expires_at !== "string") {
      throw new Error("inventory_token_invalid");
    }
    installationToken = minted.token;

    const repositories: any[] = [];
    let expectedRepositoryCount: number | null = null;
    let inventoryComplete = false;
    try {
      for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
        await renewRefreshLease(admin, refreshClaimId);
        const payload = await github(
          `/installation/repositories?per_page=100&page=${page}`,
          installationToken,
        );
        const totalCount = Number(payload?.total_count);
        if (
          !payload ||
          typeof payload !== "object" ||
          !Array.isArray(payload.repositories) ||
          !Number.isSafeInteger(totalCount) ||
          totalCount < 0
        ) {
          throw new Error("repository_inventory_invalid");
        }
        if (expectedRepositoryCount === null) expectedRepositoryCount = totalCount;
        else if (expectedRepositoryCount !== totalCount) {
          throw new Error("repository_inventory_changed_during_scan");
        }
        const items = payload.repositories;
        repositories.push(...items);
        if (items.length < 100) {
          inventoryComplete = true;
          break;
        }
        if (page === MAX_REPOSITORY_PAGES) {
          throw new Error("repository_inventory_exceeds_page_limit");
        }
      }
    } finally {
      installationToken = "";
    }
    if (!inventoryComplete || expectedRepositoryCount === null) {
      throw new Error("repository_inventory_invalid");
    }

    await renewRefreshLease(admin, refreshClaimId);
    const deduped = [
      ...new Map(
        repositories
          .filter(
            (repo) =>
              Number.isSafeInteger(Number(repo?.id)) &&
              Number(repo.id) > 0 &&
              typeof repo?.full_name === "string",
          )
          .map((repo) => [Number(repo.id), repo]),
      ).values(),
    ].sort((left: any, right: any) => Number(left.id) - Number(right.id));
    if (deduped.length !== expectedRepositoryCount) {
      throw new Error("repository_inventory_count_mismatch");
    }

    const previousSnapshot = await latestFinalizedSnapshot(
      admin,
      installationId,
      refreshClaimId,
    );
    const previousSnapshotId =
      typeof previousSnapshot?.snapshot_id === "string" ? previousSnapshot.snapshot_id : null;
    const previousRows = previousSnapshotId
      ? await fetchSnapshotRows(
          admin,
          "apex_repo_atlas_repositories",
          previousSnapshotId,
          refreshClaimId,
        )
      : [];
    const previousQueue = previousSnapshotId
      ? await fetchSnapshotRows(admin, "apex_repo_ignition_queue", previousSnapshotId, refreshClaimId)
      : [];
    const previousRegistry = previousSnapshotId
      ? await fetchSnapshotRows(
          admin,
          "apex_repo_canonical_registry",
          previousSnapshotId,
          refreshClaimId,
        )
      : [];

    await renewRefreshLease(admin, refreshClaimId);
    const claimed = await admin
      .from("apex_repo_atlas_snapshots")
      .insert({
        installation_id: installationId,
        repository_count: deduped.length,
        source: "github_oidc_estate_refresh",
        metadata: {
          refresh_status: "building",
          previous_snapshot_id: previousSnapshotId,
          refresh_claim_id: refreshClaimId,
          token_persisted: false,
        },
      })
      .select("snapshot_id")
      .single();
    if (claimed.error || typeof claimed.data?.snapshot_id !== "string") {
      throw new Error("snapshot_create_failed");
    }
    snapshotId = claimed.data.snapshot_id;

    const rows = deduped.map((repo: any) => repoRow(snapshotId, repo));
    const previousById = new Map<number, any>(
      previousRows.map((row: any) => [Number(row.repository_id), row]),
    );
    const currentById = new Map<number, any>(
      rows.map((row: any) => [Number(row.repository_id), row]),
    );
    const newIds = [...currentById.keys()]
      .filter((id) => !previousById.has(id))
      .sort((left, right) => left - right);
    const removedIds = [...previousById.keys()]
      .filter((id) => !currentById.has(id))
      .sort((left, right) => left - right);
    const renamedIds: number[] = [];
    const changedIds: number[] = [];
    for (const [id, current] of currentById) {
      const previous = previousById.get(id);
      if (!previous) continue;
      if (previous.full_name !== current.full_name) renamedIds.push(id);
      if (JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(current))) {
        changedIds.push(id);
      }
    }
    renamedIds.sort((left, right) => left - right);
    changedIds.sort((left, right) => left - right);
    const changedIdSet = new Set(changedIds);

    const inventoryPayload = rows
      .map((row: any) => ({ repository_id: row.repository_id, ...comparable(row) }))
      .sort((left: any, right: any) => left.repository_id - right.repository_id);
    const inventoryRoot = await sha256Hex(JSON.stringify(inventoryPayload));

    for (let index = 0; index < rows.length; index += 100) {
      await renewRefreshLease(admin, refreshClaimId);
      const inserted = await admin
        .from("apex_repo_atlas_repositories")
        .insert(rows.slice(index, index + 100));
      if (inserted.error) throw new Error("atlas_repository_insert_failed");
    }

    const previousIdByFullName = new Map<string, number>(
      previousRows.map((row: any) => [String(row.full_name), Number(row.repository_id)]),
    );
    const previousStatusById = new Map<number, string>();
    for (const queueRow of previousQueue) {
      const repositoryId = previousIdByFullName.get(String(queueRow.full_name));
      if (repositoryId) previousStatusById.set(repositoryId, String(queueRow.status));
    }

    const rankedCandidates = rows
      .filter((row: any) => !row.is_archived && row.lifecycle !== "backup")
      .sort(
        (left: any, right: any) =>
          right.ignition_score - left.ignition_score ||
          String(right.pushed_at || "").localeCompare(String(left.pushed_at || "")),
      );
    const primaryCandidates = rankedCandidates.slice(0, 25);
    const selectedIds = new Set(primaryCandidates.map((row: any) => Number(row.repository_id)));
    const changedCompletedCandidates = rows
      .filter((row: any) => {
        const repositoryId = Number(row.repository_id);
        return (
          !selectedIds.has(repositoryId) &&
          previousStatusById.get(repositoryId) === "completed" &&
          changedIdSet.has(repositoryId)
        );
      })
      .sort(
        (left: any, right: any) =>
          right.ignition_score - left.ignition_score ||
          Number(left.repository_id) - Number(right.repository_id),
      );
    const candidates = [...primaryCandidates, ...changedCompletedCandidates];
    const queueRows = candidates.map((row: any, index: number) => {
      const repositoryId = Number(row.repository_id);
      const priorStatus = previousStatusById.get(repositoryId);
      let status = priorStatus || "queued";
      if (!QUEUE_STATUSES.has(status)) status = "queued";
      const reasons = [...(Array.isArray(row.metadata?.reasons) ? row.metadata.reasons : [])];
      if (status === "inspecting") {
        status = "queued";
        reasons.push("inspection_claim_not_carried_across_snapshot");
      }
      if (status === "completed" && changedIdSet.has(repositoryId)) status = "queued";
      if (priorStatus === "completed" && status === "queued") {
        reasons.push("repository_changed_since_completion");
      }
      return {
        snapshot_id: snapshotId,
        full_name: row.full_name,
        priority: index + 1,
        score: row.ignition_score,
        family: row.family,
        reasons,
        status,
      };
    });
    if (queueRows.length) {
      await renewRefreshLease(admin, refreshClaimId);
      const insertedQueue = await admin.from("apex_repo_ignition_queue").insert(queueRows);
      if (insertedQueue.error) throw new Error("ignition_queue_insert_failed");
    }

    const groups = new Map<string, any[]>();
    for (const row of rows) {
      const members = groups.get(row.name_signature) || [];
      members.push(row);
      groups.set(row.name_signature, members);
    }
    const previousVerified = new Map<string, { registry: any; repositoryId: number }>();
    for (const registryRow of previousRegistry) {
      if (registryRow.status !== "verified" || registryRow.confidence !== "verified") continue;
      const repositoryId = previousIdByFullName.get(String(registryRow.candidate_canonical));
      if (!repositoryId) continue;
      previousVerified.set(String(registryRow.name_signature), {
        registry: registryRow,
        repositoryId,
      });
    }
    const registryRows: any[] = [];
    let verifiedCarryForwardCount = 0;
    for (const [nameSignature, members] of groups) {
      if (!nameSignature || members.length <= 1) continue;
      const ordered = [...members].sort(
        (left: any, right: any) =>
          right.ignition_score - left.ignition_score ||
          String(right.pushed_at || "").localeCompare(String(left.pushed_at || "")),
      );
      const verified = previousVerified.get(nameSignature);
      const carriedCandidate = verified
        ? ordered.find(
            (member: any) => Number(member.repository_id) === Number(verified.repositoryId),
          )
        : null;
      if (verified && carriedCandidate) {
        verifiedCarryForwardCount += 1;
        registryRows.push({
          snapshot_id: snapshotId,
          name_signature: nameSignature,
          candidate_canonical: carriedCandidate.full_name,
          members: ordered.map(memberSummary),
          member_count: ordered.length,
          status: "verified",
          confidence: "verified",
          rationale: {
            ...(verified.registry.rationale && typeof verified.registry.rationale === "object"
              ? verified.registry.rationale
              : {}),
            carried_from_snapshot: previousSnapshotId,
            carry_forward_repository_id: verified.repositoryId,
            carry_forward_basis: "verified_direct_evidence_and_stable_repository_id_present",
          },
        });
      } else {
        registryRows.push({
          snapshot_id: snapshotId,
          name_signature: nameSignature,
          candidate_canonical: ordered[0].full_name,
          members: ordered.map(memberSummary),
          member_count: ordered.length,
          status: "provisional",
          confidence: "heuristic",
          rationale: { basis: "normalized_name_signature_and_current_metadata_score" },
        });
      }
    }
    for (let index = 0; index < registryRows.length; index += 100) {
      await renewRefreshLease(admin, refreshClaimId);
      const insertedRegistry = await admin
        .from("apex_repo_canonical_registry")
        .insert(registryRows.slice(index, index + 100));
      if (insertedRegistry.error) throw new Error("canonical_registry_insert_failed");
    }

    const familyCounts: Record<string, number> = {};
    const lifecycleCounts: Record<string, number> = {};
    let originalCount = 0;
    let forkCount = 0;
    let privateCount = 0;
    let archivedCount = 0;
    for (const row of rows) {
      familyCounts[row.family] = (familyCounts[row.family] || 0) + 1;
      lifecycleCounts[row.lifecycle] = (lifecycleCounts[row.lifecycle] || 0) + 1;
      if (row.is_fork) forkCount += 1;
      else originalCount += 1;
      if (row.is_private) privateCount += 1;
      if (row.is_archived) archivedCount += 1;
    }
    const delta = {
      new: newIds.length,
      removed_or_transferred: removedIds.length,
      renamed_or_transferred: renamedIds.length,
      state_changes: changedIds.length,
    };

    const finalSnapshotMetadata = {
      owner: OWNER,
      installation_id: installationId,
      app_id: appId,
      app_slug: appSlug,
      installation_scope: "all",
      scan_mode: "metadata_only",
      refresh_status: "refreshed",
      previous_snapshot_id: previousSnapshotId,
      refresh_claim_id: refreshClaimId,
      inventory_root_sha256: inventoryRoot,
      inventory_expected_count: expectedRepositoryCount,
      inventory_token_permissions: { metadata: "read" },
      inventory_token_persisted: false,
      github_content_fetch: false,
      delta,
      delta_repository_ids: {
        new: newIds,
        removed_or_transferred: removedIds,
        renamed_or_transferred: renamedIds,
        state_changes: changedIds,
      },
    };
    const tokenMetadata = {
      credential_path: "github_oidc_estate_refresh",
      permissions: { metadata: "read" },
      operation: "metadata_only_estate_refresh",
      expires_at: minted.expires_at,
      workflow_ref: claim(oidcPayload, "workflow_ref"),
      workflow_sha: claim(oidcPayload, "workflow_sha"),
      run_id: runId,
      token_persisted: false,
    };
    const snapshotAuditMetadata = {
      source: "github_oidc_estate_refresh",
      previous_snapshot_id: previousSnapshotId,
      repository_count: rows.length,
      original_count: originalCount,
      fork_count: forkCount,
      private_count: privateCount,
      archived_count: archivedCount,
      inventory_root_sha256: inventoryRoot,
      delta,
      token_persisted: false,
    };
    const canonicalAuditMetadata = {
      candidate_count: registryRows.length,
      verified_carry_forward_count: verifiedCarryForwardCount,
    };
    const queueAuditMetadata = {
      queue_count: queueRows.length,
      top_n: 25,
      changed_completed_requeued_outside_top_n: changedCompletedCandidates.length,
      transient_inspecting_reset_to_queued: true,
      prior_statuses_preserved_by_repository_id: true,
    };

    await renewRefreshLease(admin, refreshClaimId);
    const finalized = await admin.rpc("finalize_apex_repo_atlas_refresh", {
      p_claim_id: refreshClaimId,
      p_snapshot_id: snapshotId,
      p_bootstrap_ref: session.bootstrap_ref,
      p_request_id: requestId,
      p_actor: `${ACTOR}:${runId}`,
      p_snapshot_metadata: finalSnapshotMetadata,
      p_token_metadata: tokenMetadata,
      p_snapshot_audit_metadata: snapshotAuditMetadata,
      p_canonical_audit_metadata: canonicalAuditMetadata,
      p_queue_audit_metadata: queueAuditMetadata,
    });
    if (finalized.error || typeof finalized.data !== "string") {
      const finalMessage = finalized.error?.message || "";
      if (finalMessage.includes("repo_atlas_refresh_lease_lost")) {
        throw new Error("repo_atlas_refresh_lease_lost");
      }
      throw new Error("repo_atlas_refresh_finalize_failed");
    }

    return json(200, {
      ok: true,
      status: "refreshed",
      snapshot_id: snapshotId,
      previous_snapshot_id: previousSnapshotId,
      repository_count: rows.length,
      original_count: originalCount,
      fork_count: forkCount,
      private_count: privateCount,
      public_count: rows.length - privateCount,
      archived_count: archivedCount,
      family_counts: familyCounts,
      lifecycle_counts: lifecycleCounts,
      delta,
      inventory_root_sha256: inventoryRoot,
      canonical_candidate_count: registryRows.length,
      verified_canonical_count: registryRows.filter((row) => row.status === "verified").length,
      ignition_queue_count: queueRows.length,
      scan_mode: "metadata_only",
      github_writes: 0,
      token_persisted: false,
    });
  } catch (error) {
    if (snapshotId) {
      const cleanup = await admin.from("apex_repo_atlas_snapshots").delete().eq("snapshot_id", snapshotId);
      if (cleanup.error) console.error("[estate-atlas-refresh] snapshot_cleanup_failed");
    }
    const failure = safeFailure(error);
    return json(failure.status, {
      ok: false,
      error: failure.code,
      retryable: failure.retryable,
    });
  } finally {
    if (refreshClaimId) {
      const released = await admin.rpc("release_apex_repo_atlas_refresh", {
        p_claim_id: refreshClaimId,
      });
      if (released.error || released.data !== true) {
        console.error("[estate-atlas-refresh] lease_release_failed");
      }
    }
    privateKey = "";
    appJwt = "";
    installationToken = "";
    snapshotId = "";
    refreshClaimId = "";
  }
});
