import { randomUUID } from 'node:crypto';
import { executeMergeAuthorityGraph, RESULT, sha256 } from '../src/proof/merge-authority.mjs';
import {
  bindGitHubProviderToRepository,
  createGitHubProviderAdapter,
  ensureGitHubBranch,
} from '../src/proof/github-provider.mjs';

const oidcToken = process.env.VERCEL_OIDC_TOKEN || '';
if (!oidcToken) throw new Error('merge_authority_proof_oidc_missing');
if (process.env.VERCEL_ENV !== 'preview') throw new Error('merge_authority_proof_preview_only');

const brokerUrl = 'https://dyhprklicgewmrimecey.supabase.co/functions/v1/apex-keymaster-pkcs1-proof';
const repository = 'GlacierEQ/public-actions-runner-host';
const baseSha = '4ff1b382d58695e5f3a2f52816ac53155c50a96a';
const sourceSha = 'ee447b11cce29556050c73ea99ddc37ae7cc3542';
const targetBranch = 'operability/merge-authority-v2';
const receiptBranch = 'receipts/merge-authority-v2';
const patchPath = 'proof-runtime/merge-authority-operable-v2.json';
const actor = 'glaciereq-operability-proof';
const intentId = 'merge-authority-operability-v2';

async function mintToken() {
  const response = await fetch(brokerUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-vercel-oidc-token': oidcToken},
    body: JSON.stringify({
      action: 'github_mint_repository_token',
      repository,
      permissions: {contents: 'write'},
      operation: 'merge_authority_operability_proof',
      request_id: `merge-authority-build-${randomUUID()}`,
      actor,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.token !== 'string' || !payload.token) {
    throw new Error(`merge_authority_token_mint_failed:${payload?.error || response.status}`);
  }
  return payload;
}

function patchBytes() {
  return `${JSON.stringify({
    schema: 'glaciereq.merge-authority.operability-payload.v1',
    purpose: 'real-provider bounded mutation and canonical readback proof',
    implementation_source_sha: sourceSha,
    target_repository: repository,
    base_sha: baseSha,
    target_branch: targetBranch,
    authority: 'short-lived repository-scoped GitHub App token minted from Vercel OIDC through Keymaster',
    nonclaims: [
      'Disposable proof branch only; main is not mutated.',
      'No production deployment or production-scale reliability is claimed.',
      'No GitHub affiliation, endorsement, employment, or adoption is implied.',
    ],
  }, null, 2)}\n`;
}

async function readContent(api) {
  const encoded = patchPath.split('/').map(encodeURIComponent).join('/');
  const payload = await api.request(`/repos/GlacierEQ/public-actions-runner-host/contents/${encoded}?ref=${encodeURIComponent(targetBranch)}`);
  if (typeof payload?.content !== 'string') throw new Error('merge_authority_readback_content_missing');
  return Buffer.from(payload.content.replaceAll('\n', ''), 'base64').toString('utf8');
}

async function readCanonicalReceipt(api, key) {
  const filePath = `.merge-authority-receipts/completed/${key}.json`;
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  const payload = await api.request(`/repos/GlacierEQ/public-actions-runner-host/contents/${encoded}?ref=${encodeURIComponent(receiptBranch)}`);
  if (typeof payload?.content !== 'string') throw new Error('merge_authority_canonical_receipt_missing');
  return JSON.parse(Buffer.from(payload.content.replaceAll('\n', ''), 'base64').toString('utf8'));
}

let minted = null;
let api = null;
let revoked = false;
try {
  minted = await mintToken();
  const raw = createGitHubProviderAdapter({token: minted.token, receiptBranch, patchPath});
  api = raw.api;
  const targetBranchState = await ensureGitHubBranch({api, repository, branch: targetBranch, fromSha: baseSha});
  const receiptBranchState = await ensureGitHubBranch({api, repository, branch: receiptBranch, fromSha: baseSha});

  const patch = patchBytes();
  const patchSha256 = sha256(patch);
  const request = {
    repository,
    targetBranch,
    expectedHead: baseSha,
    intentId,
    patch,
    declaredPatchSha256: patchSha256,
    checks: [{name: 'provider-preflight', status: 'pass'}],
    approvals: [{actor, intentId, expectedHead: baseSha, patchSha256}],
    policy: {
      allowedBranches: [targetBranch],
      requiredChecks: ['provider-preflight'],
      authorizedReviewers: [actor],
    },
  };

  const adapter = bindGitHubProviderToRepository(raw, repository);
  const first = await executeMergeAuthorityGraph(request, adapter);
  const replay = await executeMergeAuthorityGraph(request, adapter);
  const targetHead = await adapter.readbackHead(repository, targetBranch, first.mergeSha || replay.mergeSha);
  const observed = await readContent(api);
  const canonical = await readCanonicalReceipt(api, first.idempotencyKey || replay.idempotencyKey);
  const mergeSha = first.mergeSha || canonical.mergeSha;
  const checks = {
    first_terminal: [RESULT.VERIFIED_COMPLETED, RESULT.DUPLICATE_ALREADY_COMPLETED].includes(first.result),
    replay_blocked: replay.result === RESULT.DUPLICATE_ALREADY_COMPLETED && replay.mergeAttempted === false,
    head_verified: typeof mergeSha === 'string' && targetHead === mergeSha,
    exact_content_verified: observed === patch,
    canonical_receipt_verified: canonical?.result === RESULT.VERIFIED_COMPLETED
      && canonical?.patchSha256 === patchSha256
      && canonical?.readbackHead === canonical?.mergeSha,
  };

  await api.request('/installation/token', {method: 'DELETE'});
  revoked = true;
  minted.token = '';

  if (!Object.values(checks).every(Boolean) || !revoked) {
    throw new Error(`merge_authority_provider_proof_failed:${JSON.stringify(checks)}`);
  }

  console.log(JSON.stringify({
    gate: 'OPERABLE',
    result: 'PASS',
    implementation_source_sha: sourceSha,
    provider: 'github',
    repository,
    authority: {
      class: 'short_lived_repository_scoped_github_app_installation_token',
      permissions: minted.permissions ?? null,
      token_persisted: false,
      token_revoked: revoked,
      private_key_normalized_in_memory: minted.private_key_normalized_in_memory === true,
    },
    branches: {
      target: {name: targetBranch, created: targetBranchState.created, head: targetHead},
      receipts: {name: receiptBranch, created: receiptBranchState.created},
    },
    patch: {path: patchPath, sha256: patchSha256},
    first: {result: first.result, merge_sha: first.mergeSha ?? null, readback_head: first.readbackHead ?? null},
    replay: {result: replay.result, merge_attempted: replay.mergeAttempted},
    checks,
  }));
} catch (error) {
  if (api && minted?.token) {
    try {
      await api.request('/installation/token', {method: 'DELETE'});
      revoked = true;
    } catch {
      revoked = false;
    }
  }
  if (minted) minted.token = '';
  throw new Error(`${error instanceof Error ? error.message : String(error)};token_revoked=${revoked}`);
}
