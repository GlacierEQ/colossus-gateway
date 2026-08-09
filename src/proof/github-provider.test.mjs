import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindGitHubProviderToRepository,
  createGitHubProviderAdapter,
  ensureGitHubBranch,
} from './github-provider.mjs';

function response(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
  };
}

function fakeGitHub() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null });

    if (method === 'GET' && path.includes('/git/ref/heads/operability/proof')) {
      return response(200, { object: { sha: 'base123' } });
    }
    if (method === 'GET' && path.includes('/git/ref/heads/receipts/proof')) {
      return response(404, {});
    }
    if (method === 'POST' && path.endsWith('/git/refs')) {
      return response(201, { object: { sha: 'base123' } });
    }
    if (method === 'GET' && path.includes('/contents/.merge-authority-receipts/completed/')) {
      return response(404, {});
    }
    if (method === 'POST' && path.endsWith('/git/blobs')) return response(201, { sha: 'blob1' });
    if (method === 'GET' && path.endsWith('/git/commits/base123')) {
      return response(200, { tree: { sha: 'tree0' } });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) return response(201, { sha: 'tree1' });
    if (method === 'POST' && path.endsWith('/git/commits')) return response(201, { sha: 'commit456' });
    if (method === 'PATCH' && path.includes('/git/refs/heads/operability/proof')) return response(200, { object: { sha: 'commit456' } });
    if (method === 'PUT' && path.includes('/contents/.merge-authority-receipts/')) {
      return response(201, { commit: { sha: `receipt-${calls.length}` } });
    }
    return response(500, {});
  };
  return { calls, fetchImpl };
}

test('provider creates a missing disposable branch without force', async () => {
  const fake = fakeGitHub();
  const adapter = createGitHubProviderAdapter({
    token: 'test-token',
    receiptBranch: 'receipts/proof',
    patchPath: 'proof-runtime/result.json',
    fetchImpl: fake.fetchImpl,
  });
  const result = await ensureGitHubBranch({
    api: adapter.api,
    repository: 'GlacierEQ/public-actions-runner-host',
    branch: 'receipts/proof',
    fromSha: 'base123',
  });
  assert.equal(result.created, true);
  const create = fake.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/refs'));
  assert.deepEqual(create.body, { ref: 'refs/heads/receipts/proof', sha: 'base123' });
});

test('provider mutation commits exact authorized bytes and uses non-force ref update', async () => {
  const fake = fakeGitHub();
  const raw = createGitHubProviderAdapter({
    token: 'test-token',
    receiptBranch: 'receipts/proof',
    patchPath: 'proof-runtime/result.json',
    fetchImpl: fake.fetchImpl,
  });
  const adapter = bindGitHubProviderToRepository(raw, 'GlacierEQ/public-actions-runner-host');
  const result = await adapter.merge({
    repository: 'GlacierEQ/public-actions-runner-host',
    targetBranch: 'operability/proof',
    expectedHead: 'base123',
    intentId: 'proof-1',
    patch: '{"ok":true}\n',
    patchSha256: 'a'.repeat(64),
    idempotencyKey: 'idem1',
  });
  assert.equal(result.mergeSha, 'commit456');
  const blob = fake.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/blobs'));
  assert.equal(blob.body.content, '{"ok":true}\n');
  const update = fake.calls.find((call) => call.method === 'PATCH');
  assert.equal(update.body.force, false);
  assert.equal(update.body.sha, 'commit456');
});

test('readback reconciliation tolerates an initially stale provider ref', async () => {
  let reads = 0;
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if ((init.method ?? 'GET') === 'GET' && parsed.pathname.includes('/git/ref/heads/operability/proof')) {
      reads += 1;
      return response(200, { object: { sha: reads === 1 ? 'base123' : 'commit456' } });
    }
    return response(500, {});
  };
  const adapter = createGitHubProviderAdapter({
    token: 'test-token',
    receiptBranch: 'receipts/proof',
    patchPath: 'proof-runtime/result.json',
    fetchImpl,
    readbackAttempts: 3,
    readbackDelayMs: 0,
  });
  const head = await adapter.readbackHead(
    'GlacierEQ/public-actions-runner-host',
    'operability/proof',
    'commit456',
  );
  assert.equal(head, 'commit456');
  assert.equal(reads, 2);
});

test('completed receipts are persisted to a canonical lookup path before event append', async () => {
  const fake = fakeGitHub();
  const raw = createGitHubProviderAdapter({
    token: 'test-token',
    receiptBranch: 'receipts/proof',
    patchPath: 'proof-runtime/result.json',
    fetchImpl: fake.fetchImpl,
  });
  const adapter = bindGitHubProviderToRepository(raw, 'GlacierEQ/public-actions-runner-host');
  const receipt = {
    repository: 'GlacierEQ/public-actions-runner-host',
    idempotencyKey: 'idem1',
    result: 'VERIFIED_COMPLETED',
  };
  await adapter.persistReceipt(receipt);
  const puts = fake.calls.filter((call) => call.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.ok(puts[0].path.includes('/completed/idem1.json'));
  assert.ok(puts[1].path.includes('/events/idem1/'));
  assert.ok(receipt.receiptId);
});
