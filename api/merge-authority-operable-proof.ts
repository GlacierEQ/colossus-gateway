import type { IncomingMessage, ServerResponse } from 'node:http';
import { getVercelOidcToken } from '@vercel/oidc';

// Exact vendored JavaScript proof sources are intentionally executed without translation.
// @ts-expect-error Exact .mjs kernel proof source has no TypeScript declaration file.
import { executeMergeAuthorityGraph, RESULT, sha256 } from '../src/proof/merge-authority.mjs';
// @ts-expect-error Exact .mjs provider proof source has no TypeScript declaration file.
import { bindGitHubProviderToRepository, createGitHubProviderAdapter, ensureGitHubBranch } from '../src/proof/github-provider.mjs';

const SUPABASE_URL = process.env.APEX_CAPABILITY_SUPABASE_URL || 'https://dyhprklicgewmrimecey.supabase.co';
const BROKER_URL = `${SUPABASE_URL}/functions/v1/apex-keymaster-broker`;
const TARGET_REPOSITORY = 'GlacierEQ/public-actions-runner-host';
const BASE_SHA = '4ff1b382d58695e5f3a2f52816ac53155c50a96a';
const SOURCE_SHA = 'daea3825be13cf60792c9c15f3825a7ce07296ad';
const TARGET_BRANCH = 'operability/merge-authority-v1';
const RECEIPT_BRANCH = 'receipts/merge-authority-v1';
const PATCH_PATH = 'proof-runtime/merge-authority-operable-v1.json';
const ACTOR = 'glaciereq-operability-proof';
const INTENT_ID = 'merge-authority-operability-v1';
const REQUEST_TIMEOUT_MS = 20_000;

const responseHeaders = {
  'content-type': 'application/json',
  'cache-control': 'no-store, max-age=0',
  pragma: 'no-cache',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, responseHeaders);
  res.end(JSON.stringify(body));
}

function requestId() {
  return `merge-authority-operable-${crypto.randomUUID()}`;
}

async function mintToken(oidcToken: string) {
  const response = await fetch(BROKER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vercel-oidc-token': oidcToken,
    },
    body: JSON.stringify({
      action: 'github_mint_repository_token',
      repository: TARGET_REPOSITORY,
      permissions: { contents: 'write' },
      operation: 'merge_authority_operability_proof',
      request_id: requestId(),
      actor: ACTOR,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.token !== 'string' || !payload.token) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `keymaster_http_${response.status}`);
  }
  return payload as {
    token: string;
    expires_at?: string;
    permissions?: Record<string, string>;
    bootstrap_ref?: string;
    receipt_id?: unknown;
  };
}

function deterministicPatch() {
  return `${JSON.stringify({
    schema: 'glaciereq.merge-authority.operability-payload.v1',
    purpose: 'real-provider bounded mutation and canonical readback proof',
    implementation_source_sha: SOURCE_SHA,
    target_repository: TARGET_REPOSITORY,
    base_sha: BASE_SHA,
    target_branch: TARGET_BRANCH,
    authority: 'short-lived repository-scoped GitHub App token minted by Keymaster from Vercel OIDC',
    nonclaims: [
      'This disposable branch mutation is not a production deployment.',
      'This proof does not establish production-scale reliability or throughput.',
      'No GitHub affiliation, endorsement, employment, or adoption is implied.',
    ],
  }, null, 2)}\n`;
}

async function readTargetContent(api: any) {
  const encoded = PATCH_PATH.split('/').map(encodeURIComponent).join('/');
  const payload = await api.request(
    `/repos/GlacierEQ/public-actions-runner-host/contents/${encoded}?ref=${encodeURIComponent(TARGET_BRANCH)}`,
  );
  if (typeof payload?.content !== 'string') throw new Error('provider_readback_content_missing');
  return Buffer.from(payload.content.replaceAll('\n', ''), 'base64').toString('utf8');
}

async function readCanonicalReceipt(api: any, idempotencyKey: string) {
  const path = `.merge-authority-receipts/completed/${idempotencyKey}.json`;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const payload = await api.request(
    `/repos/GlacierEQ/public-actions-runner-host/contents/${encoded}?ref=${encodeURIComponent(RECEIPT_BRANCH)}`,
  );
  if (typeof payload?.content !== 'string') throw new Error('canonical_receipt_missing');
  return JSON.parse(Buffer.from(payload.content.replaceAll('\n', ''), 'base64').toString('utf8'));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  if (process.env.VERCEL_ENV !== 'preview') {
    return send(res, 403, { ok: false, error: 'preview_only_operability_proof' });
  }

  let minted: Awaited<ReturnType<typeof mintToken>> | null = null;
  let api: any = null;
  let tokenRevoked = false;

  try {
    const oidcToken = (await getVercelOidcToken()) || '';
    if (!oidcToken) throw new Error('vercel_oidc_token_missing');
    minted = await mintToken(oidcToken);

    const rawAdapter = createGitHubProviderAdapter({
      token: minted.token,
      receiptBranch: RECEIPT_BRANCH,
      patchPath: PATCH_PATH,
    });
    api = rawAdapter.api;

    const targetBranch = await ensureGitHubBranch({
      api,
      repository: TARGET_REPOSITORY,
      branch: TARGET_BRANCH,
      fromSha: BASE_SHA,
    });
    const receiptBranch = await ensureGitHubBranch({
      api,
      repository: TARGET_REPOSITORY,
      branch: RECEIPT_BRANCH,
      fromSha: BASE_SHA,
    });

    const patch = deterministicPatch();
    const patchSha256 = sha256(patch);
    const request = {
      repository: TARGET_REPOSITORY,
      targetBranch: TARGET_BRANCH,
      expectedHead: BASE_SHA,
      intentId: INTENT_ID,
      patch,
      declaredPatchSha256: patchSha256,
      checks: [{ name: 'provider-preflight', status: 'pass' }],
      approvals: [{
        actor: ACTOR,
        intentId: INTENT_ID,
        expectedHead: BASE_SHA,
        patchSha256,
      }],
      policy: {
        allowedBranches: [TARGET_BRANCH],
        requiredChecks: ['provider-preflight'],
        authorizedReviewers: [ACTOR],
      },
    };

    const adapter = bindGitHubProviderToRepository(rawAdapter, TARGET_REPOSITORY);
    const first = await executeMergeAuthorityGraph(request, adapter);
    const replay = await executeMergeAuthorityGraph(request, adapter);
    const targetHead = await adapter.getHead(TARGET_REPOSITORY, TARGET_BRANCH);
    const observedContent = await readTargetContent(api);
    const canonicalReceipt = await readCanonicalReceipt(api, first.idempotencyKey || replay.idempotencyKey);

    const firstAcceptable = [RESULT.VERIFIED_COMPLETED, RESULT.DUPLICATE_ALREADY_COMPLETED].includes(first.result);
    const replayAcceptable = replay.result === RESULT.DUPLICATE_ALREADY_COMPLETED;
    const expectedMergeSha = first.mergeSha || canonicalReceipt.mergeSha;
    const headVerified = typeof expectedMergeSha === 'string' && targetHead === expectedMergeSha;
    const contentVerified = observedContent === patch;
    const canonicalReceiptVerified = canonicalReceipt?.result === RESULT.VERIFIED_COMPLETED
      && canonicalReceipt?.patchSha256 === patchSha256
      && canonicalReceipt?.readbackHead === canonicalReceipt?.mergeSha;
    const success = firstAcceptable && replayAcceptable && headVerified && contentVerified && canonicalReceiptVerified;

    try {
      await api.request('/installation/token', { method: 'DELETE' });
      tokenRevoked = true;
    } finally {
      minted.token = '';
    }

    return send(res, success && tokenRevoked ? 200 : 409, {
      ok: success && tokenRevoked,
      schema: 'glaciereq.merge-authority.provider-proof.v1',
      implementation_source_sha: SOURCE_SHA,
      provider: 'github',
      authority: {
        class: 'short_lived_repository_scoped_github_app_installation_token',
        minted_by: 'vercel_oidc_to_supabase_keymaster',
        repository: TARGET_REPOSITORY,
        permissions: minted.permissions ?? null,
        expires_at: minted.expires_at ?? null,
        bootstrap_ref: minted.bootstrap_ref ?? null,
        mint_receipt_id: minted.receipt_id ?? null,
        token_persisted: false,
        token_revoked: tokenRevoked,
      },
      branches: {
        target: { name: TARGET_BRANCH, from_sha: BASE_SHA, created: targetBranch.created },
        receipts: { name: RECEIPT_BRANCH, from_sha: BASE_SHA, created: receiptBranch.created },
      },
      patch: { path: PATCH_PATH, sha256: patchSha256 },
      first: {
        result: first.result,
        merge_sha: first.mergeSha ?? null,
        readback_head: first.readbackHead ?? null,
        receipt_id: first.receiptId ?? null,
      },
      replay: {
        result: replay.result,
        merge_attempted: replay.mergeAttempted,
        prior_receipt_id: replay.priorReceiptId ?? null,
      },
      independent_readback: {
        target_head: targetHead,
        head_verified: headVerified,
        exact_content_verified: contentVerified,
        canonical_receipt_verified: canonicalReceiptVerified,
      },
      nonclaims: [
        'Disposable proof branches only; main is not mutated.',
        'No production deployment or production-scale reliability is claimed.',
        'No GitHub affiliation, endorsement, employment, or adoption is implied.',
      ],
    });
  } catch (error) {
    if (api && minted?.token) {
      try {
        await api.request('/installation/token', { method: 'DELETE' });
        tokenRevoked = true;
      } catch {
        tokenRevoked = false;
      }
    }
    if (minted) minted.token = '';
    return send(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'operability_proof_failed',
      token_persisted: false,
      token_revoked: tokenRevoked,
      implementation_source_sha: SOURCE_SHA,
    });
  }
}
