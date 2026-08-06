import { afterEach, describe, expect, it, vi } from 'vitest';
import { withKeymasterSecret } from '../src/keymaster/client.js';

const secret = 'unit-test-secret-value';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function resolvePayload() {
  return {
    ok: true,
    secret_ref: 'km_0123456789abcdef0123456789abcdef',
    provider: 'jefs',
    account_label: 'casey',
    purpose: 'password',
    scope: ['docket-read'],
    version: 1,
    secret,
    resolve_receipt_id: '00000000-0000-0000-0000-000000000001',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Colossus Keymaster client', () => {
  it('uses an opaque reference and never returns the credential', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(resolvePayload()))
      .mockResolvedValueOnce(jsonResponse({ ok: true, recorded: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await withKeymasterSecret(
      {
        secretRef: 'km_0123456789abcdef0123456789abcdef',
        provider: 'jefs',
        operation: 'download_docket',
        oidcToken: 'test-oidc-token',
      },
      async (credential, context) => ({
        authenticated: credential === secret,
        secretRef: context.secretRef,
      }),
    );

    expect(result).toEqual({
      authenticated: true,
      secretRef: 'km_0123456789abcdef0123456789abcdef',
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const resolveRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const receiptRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(resolveRequest).not.toHaveProperty('secret');
    expect(receiptRequest).not.toHaveProperty('secret');
    expect(receiptRequest.outcome).toBe('succeeded');
  });

  it('blocks a tool result that contains the raw secret', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(resolvePayload()))
      .mockResolvedValueOnce(jsonResponse({ ok: true, recorded: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(withKeymasterSecret(
      {
        secretRef: 'km_0123456789abcdef0123456789abcdef',
        provider: 'jefs',
        operation: 'bad_tool',
        oidcToken: 'test-oidc-token',
      },
      async (credential) => ({ leaked: credential }),
    )).rejects.toThrow('raw_secret_return_blocked');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const receiptRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(receiptRequest.outcome).toBe('blocked');
    expect(receiptRequest.metadata.reason).toBe('raw_secret_detected_in_tool_result');
    expect(JSON.stringify(receiptRequest)).not.toContain(secret);
  });

  it('records a failed use without persisting the error message or secret', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(resolvePayload()))
      .mockResolvedValueOnce(jsonResponse({ ok: true, recorded: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(withKeymasterSecret(
      {
        secretRef: 'km_0123456789abcdef0123456789abcdef',
        provider: 'jefs',
        operation: 'failing_tool',
        oidcToken: 'test-oidc-token',
      },
      async () => {
        throw new Error(`upstream rejected ${secret}`);
      },
    )).rejects.toThrow('upstream rejected');

    const receiptRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(receiptRequest.outcome).toBe('failed');
    expect(receiptRequest.metadata).toEqual(expect.objectContaining({ error_name: 'Error' }));
    expect(JSON.stringify(receiptRequest)).not.toContain(secret);
  });
});
