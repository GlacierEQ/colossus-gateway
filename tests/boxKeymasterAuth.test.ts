import { afterEach, describe, expect, it, vi } from 'vitest';
import { withBoxClient } from '../src/bridge/boxAuth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  delete process.env.BOX_ACCESS_TOKEN;
  delete process.env.BOX_ACCESS_TOKEN_REF;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Box Keymaster authentication bridge', () => {
  it('uses BOX_ACCESS_TOKEN_REF to perform a binary upload without returning the secret', async () => {
    process.env.BOX_ACCESS_TOKEN_REF = 'km_0123456789abcdef0123456789abcdef';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        secret_ref: process.env.BOX_ACCESS_TOKEN_REF,
        provider: 'box',
        account_label: 'glaciereq',
        purpose: 'access_token',
        scope: ['file-read', 'file-write-as-configured'],
        version: 1,
        secret: 'box-test-token',
        resolve_receipt_id: '00000000-0000-0000-0000-000000000001',
      }))
      .mockResolvedValueOnce(jsonResponse({
        total_count: 1,
        entries: [{ id: '9001', name: 'probe.png', size: 4, sha1: 'deadbeef' }],
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, recorded: true }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await withBoxClient(
      {
        vercelOidcToken: 'test-oidc-token',
        actor: 'vitest',
        requestId: 'box-keymaster-upload-test',
      },
      'box_upload',
      (client) => client.upload({
        file_name: 'probe.png',
        parent_folder_id: '401660135704',
        content_base64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
        content_type: 'image/png',
      }),
    );

    expect(result).toEqual(expect.objectContaining({ total_count: 1 }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain('https://upload.box.com/api/2.0/files/content');
    expect(JSON.stringify(result)).not.toContain('box-test-token');
  });

  it('prefers an explicit request token and does not invoke Keymaster', async () => {
    process.env.BOX_ACCESS_TOKEN_REF = 'km_0123456789abcdef0123456789abcdef';

    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ total_count: 0, entries: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await withBoxClient(
      { boxAccessToken: 'request-token', actor: 'vitest' },
      'box_search',
      (client) => client.search({ query: 'probe', limit: 1 }),
    );

    expect(result).toEqual({ total_count: 0, entries: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect((request.headers as Record<string, string>).Authorization).toBe('Bearer request-token');
  });
});
