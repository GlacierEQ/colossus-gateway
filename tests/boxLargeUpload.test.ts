import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxClient } from '../src/bridge/boxClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Box large native upload', () => {
  it('routes files larger than 50 MiB through a Box upload session instead of the direct upload endpoint', async () => {
    const large = new Uint8Array(50 * 1024 * 1024 + 1);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'stop-after-first-request' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new BoxClient('box-test-token');

    await expect(
      client.uploadNativeBytes('large-evidence.mp3', large, '424243424678', 'audio/mpeg'),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/files/upload_sessions');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/files/content');
  });
});
