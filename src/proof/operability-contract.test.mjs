import test from 'node:test';
import assert from 'node:assert/strict';
import { executeMergeAuthorityGraph, RESULT, sha256 } from './merge-authority.mjs';

function request() {
  const patch = '{"proof":"provider-bound"}\n';
  const patchSha256 = sha256(patch);
  return {
    repository: 'GlacierEQ/public-actions-runner-host',
    targetBranch: 'operability/proof',
    expectedHead: 'base123',
    intentId: 'operability-proof',
    patch,
    declaredPatchSha256: patchSha256,
    checks: [{ name: 'provider-preflight', status: 'pass' }],
    approvals: [{
      actor: 'glaciereq-operability-proof',
      intentId: 'operability-proof',
      expectedHead: 'base123',
      patchSha256,
    }],
    policy: {
      allowedBranches: ['operability/proof'],
      requiredChecks: ['provider-preflight'],
      authorizedReviewers: ['glaciereq-operability-proof'],
    },
  };
}

test('authorized patch bytes are passed to the provider adapter', async () => {
  let mergeInput = null;
  let headReads = 0;
  const receipts = [];
  const adapters = {
    async getPriorReceipt() { return null; },
    async getHead() {
      headReads += 1;
      return headReads === 1 ? 'base123' : 'commit456';
    },
    async merge(input) {
      mergeInput = input;
      return { mergeSha: 'commit456' };
    },
    async persistReceipt(receipt) { receipts.push(receipt); },
  };

  const input = request();
  const receipt = await executeMergeAuthorityGraph(input, adapters);
  assert.equal(receipt.result, RESULT.VERIFIED_COMPLETED);
  assert.equal(mergeInput.patch, input.patch);
  assert.equal(mergeInput.patchSha256, sha256(input.patch));
  assert.equal(receipts.length, 1);
});

test('provider readback reconciler is used after mutation when available', async () => {
  let reconcilerCalls = 0;
  let headReads = 0;
  const receipts = [];
  const adapters = {
    async getPriorReceipt() { return null; },
    async getHead() { headReads += 1; return 'base123'; },
    async merge() { return { mergeSha: 'commit456' }; },
    async readbackHead(repository, branch, expectedSha) {
      reconcilerCalls += 1;
      assert.equal(repository, 'GlacierEQ/public-actions-runner-host');
      assert.equal(branch, 'operability/proof');
      assert.equal(expectedSha, 'commit456');
      return 'commit456';
    },
    async persistReceipt(receipt) { receipts.push(receipt); },
  };

  const receipt = await executeMergeAuthorityGraph(request(), adapters);
  assert.equal(receipt.result, RESULT.VERIFIED_COMPLETED);
  assert.equal(reconcilerCalls, 1);
  assert.equal(headReads, 1);
  assert.equal(receipts.length, 1);
});

test('completed replay is recognized before a now-stale head can reject it', async () => {
  let headReads = 0;
  let mergeCalls = 0;
  const receipts = [];
  const adapters = {
    async getPriorReceipt() {
      return {
        result: RESULT.VERIFIED_COMPLETED,
        mergeSha: 'commit456',
        readbackHead: 'commit456',
        receiptId: 'provider-receipt-1',
      };
    },
    async getHead() {
      headReads += 1;
      return 'commit456';
    },
    async merge() {
      mergeCalls += 1;
      throw new Error('must not run');
    },
    async persistReceipt(receipt) { receipts.push(receipt); },
  };

  const receipt = await executeMergeAuthorityGraph(request(), adapters);
  assert.equal(receipt.result, RESULT.DUPLICATE_ALREADY_COMPLETED);
  assert.equal(receipt.priorReceiptId, 'provider-receipt-1');
  assert.equal(headReads, 0);
  assert.equal(mergeCalls, 0);
  assert.equal(receipts.length, 1);
});

test('receipt-store failure still blocks before provider reads or mutation', async () => {
  let headReads = 0;
  let mergeCalls = 0;
  const receipts = [];
  const adapters = {
    async getPriorReceipt() { throw new Error('receipt store unavailable'); },
    async getHead() { headReads += 1; return 'base123'; },
    async merge() { mergeCalls += 1; return { mergeSha: 'commit456' }; },
    async persistReceipt(receipt) { receipts.push(receipt); },
  };

  const receipt = await executeMergeAuthorityGraph(request(), adapters);
  assert.equal(receipt.result, RESULT.BLOCKED_PROVIDER_FAILURE);
  assert.ok(receipt.reasons.includes('provider_receipt_lookup_failed'));
  assert.equal(headReads, 0);
  assert.equal(mergeCalls, 0);
  assert.equal(receipts.length, 1);
});
