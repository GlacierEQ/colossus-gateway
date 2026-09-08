import crypto from 'node:crypto';

const API_VERSION = '2026-03-10';
const RECEIPT_ROOT = '.merge-authority-receipts';
const DEFAULT_READBACK_ATTEMPTS = 6;
const DEFAULT_READBACK_DELAY_MS = 150;

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid_${label}`);
  return value.trim();
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function splitRepository(repository) {
  const value = requiredText(repository, 'repository');
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('invalid_repository');
  return { owner: parts[0], repo: parts[1] };
}

function branchPath(branch) {
  return requiredText(branch, 'branch')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function encodePath(filePath) {
  return requiredText(filePath, 'path')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function base64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function eventId(receipt) {
  const random = crypto.randomUUID();
  return crypto.createHash('sha256').update(`${jsonBody(receipt)}:${random}`).digest('hex').slice(0, 24);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGitHubApi({ token, fetchImpl = fetch, apiBase = 'https://api.github.com' }) {
  const bearer = requiredText(token, 'github_token');

  async function request(path, init = {}, { allow404 = false } = {}) {
    const response = await fetchImpl(`${apiBase}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${bearer}`,
        'x-github-api-version': API_VERSION,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (allow404 && response.status === 404) return null;
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`github_http_${response.status}`);
    return payload;
  }

  return { request };
}

export async function ensureGitHubBranch({ api, repository, branch, fromSha }) {
  const { owner, repo } = splitRepository(repository);
  const encodedBranch = branchPath(branch);
  const existing = await api.request(
    `/repos/${owner}/${repo}/git/ref/heads/${encodedBranch}`,
    {},
    { allow404: true },
  );
  if (existing?.object?.sha) return { created: false, sha: existing.object.sha };

  const created = await api.request(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: jsonBody({ ref: `refs/heads/${requiredText(branch, 'branch')}`, sha: requiredText(fromSha, 'from_sha') }),
  });
  return { created: true, sha: created?.object?.sha ?? fromSha };
}

export function createGitHubProviderAdapter({
  token,
  receiptBranch,
  patchPath,
  fetchImpl = fetch,
  apiBase = 'https://api.github.com',
  readbackAttempts = DEFAULT_READBACK_ATTEMPTS,
  readbackDelayMs = DEFAULT_READBACK_DELAY_MS,
}) {
  const api = createGitHubApi({ token, fetchImpl, apiBase });
  const receiptsBranch = requiredText(receiptBranch, 'receipt_branch');
  const mutationPath = requiredText(patchPath, 'patch_path');

  async function getHead(repository, branch) {
    const { owner, repo } = splitRepository(repository);
    const payload = await api.request(`/repos/${owner}/${repo}/git/ref/heads/${branchPath(branch)}`);
    const sha = payload?.object?.sha;
    if (typeof sha !== 'string' || !sha) throw new Error('github_head_missing');
    return sha;
  }

  async function readbackHead(repository, branch, expectedSha) {
    const { owner, repo } = splitRepository(repository);
    const expected = requiredText(expectedSha, 'expected_readback_sha');
    const attempts = Number.isInteger(readbackAttempts) && readbackAttempts > 0
      ? readbackAttempts
      : DEFAULT_READBACK_ATTEMPTS;
    const delay = Number.isFinite(readbackDelayMs) && readbackDelayMs >= 0
      ? readbackDelayMs
      : DEFAULT_READBACK_DELAY_MS;
    let last = null;

    for (let index = 0; index < attempts; index += 1) {
      const nonce = `${Date.now()}-${index}-${crypto.randomUUID()}`;
      const payload = await api.request(
        `/repos/${owner}/${repo}/git/ref/heads/${branchPath(branch)}?readback=${encodeURIComponent(nonce)}`,
        { headers: { 'cache-control': 'no-cache' } },
      );
      last = payload?.object?.sha ?? null;
      if (last === expected) return last;
      if (index < attempts - 1 && delay > 0) await sleep(delay * (index + 1));
    }

    return last;
  }

  async function readReceipt(repository, idempotencyKey) {
    const { owner, repo } = splitRepository(repository);
    const path = `${RECEIPT_ROOT}/completed/${requiredText(idempotencyKey, 'idempotency_key')}.json`;
    const payload = await api.request(
      `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(receiptsBranch)}`,
      {},
      { allow404: true },
    );
    if (!payload) return null;
    if (typeof payload.content !== 'string') throw new Error('github_receipt_content_missing');
    const decoded = Buffer.from(payload.content.replaceAll('\n', ''), 'base64').toString('utf8');
    return JSON.parse(decoded);
  }

  async function createReceiptFile(repository, filePath, receipt) {
    const { owner, repo } = splitRepository(repository);
    const payload = await api.request(`/repos/${owner}/${repo}/contents/${encodePath(filePath)}`, {
      method: 'PUT',
      body: jsonBody({
        message: `merge-authority receipt ${receipt.result}`,
        content: base64(`${JSON.stringify(receipt, null, 2)}\n`),
        branch: receiptsBranch,
      }),
    });
    return payload?.commit?.sha ?? null;
  }

  async function persistReceipt(receipt) {
    const repository = requiredText(receipt?.repository, 'receipt_repository');
    const idempotencyKey = receipt?.idempotencyKey || 'no-idempotency-key';
    let canonicalCommit = null;

    if (receipt?.result === 'VERIFIED_COMPLETED') {
      const canonicalPath = `${RECEIPT_ROOT}/completed/${idempotencyKey}.json`;
      const existing = await readReceipt(repository, idempotencyKey);
      if (!existing) canonicalCommit = await createReceiptFile(repository, canonicalPath, receipt);
    }

    const eventPath = `${RECEIPT_ROOT}/events/${idempotencyKey}/${eventId(receipt)}.json`;
    const eventCommit = await createReceiptFile(repository, eventPath, receipt);
    receipt.receiptId = canonicalCommit ?? eventCommit ?? receipt.receiptId ?? null;
  }

  async function merge({ repository, targetBranch, expectedHead, intentId, patch, patchSha256, idempotencyKey }) {
    const { owner, repo } = splitRepository(repository);
    requiredText(patch, 'patch');
    const content = patch;
    const expected = requiredText(expectedHead, 'expected_head');
    const authorizedDigest = requiredText(patchSha256, 'patch_sha256');
    if (sha256Text(content) !== authorizedDigest) throw new Error('provider_patch_digest_mismatch');

    const blob = await api.request(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: jsonBody({ content, encoding: 'utf-8' }),
    });
    if (typeof blob?.sha !== 'string') throw new Error('github_blob_sha_missing');

    const parent = await api.request(`/repos/${owner}/${repo}/git/commits/${encodeURIComponent(expected)}`);
    const baseTree = parent?.tree?.sha;
    if (typeof baseTree !== 'string' || !baseTree) throw new Error('github_parent_tree_missing');

    const tree = await api.request(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: jsonBody({
        base_tree: baseTree,
        tree: [{ path: mutationPath, mode: '100644', type: 'blob', sha: blob.sha }],
      }),
    });
    if (typeof tree?.sha !== 'string') throw new Error('github_tree_sha_missing');

    const commit = await api.request(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: jsonBody({
        message: `merge-authority ${requiredText(intentId, 'intent_id')} ${authorizedDigest.slice(0, 12)}`,
        tree: tree.sha,
        parents: [expected],
      }),
    });
    if (typeof commit?.sha !== 'string') throw new Error('github_commit_sha_missing');

    await api.request(`/repos/${owner}/${repo}/git/refs/heads/${branchPath(targetBranch)}`, {
      method: 'PATCH',
      body: jsonBody({ sha: commit.sha, force: false }),
    });

    return {
      mergeSha: commit.sha,
      provider: 'github',
      idempotencyKey,
      patchPath: mutationPath,
    };
  }

  return {
    getHead,
    readbackHead,
    getPriorReceipt: async (idempotencyKey, repository) => {
      if (!repository) throw new Error('receipt_repository_required');
      return readReceipt(repository, idempotencyKey);
    },
    merge,
    persistReceipt,
    api,
  };
}

export function bindGitHubProviderToRepository(adapter, repository) {
  const boundRepository = requiredText(repository, 'repository');
  return {
    getHead: adapter.getHead,
    readbackHead: adapter.readbackHead,
    merge: adapter.merge,
    persistReceipt: adapter.persistReceipt,
    getPriorReceipt: (idempotencyKey) => adapter.getPriorReceipt(idempotencyKey, boundRepository),
  };
}
