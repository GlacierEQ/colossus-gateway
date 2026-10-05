import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import notionCallHandler from '../api/notion-call.js';
import boxStatusHandler from '../api/box-status.js';
import { AuditLedger } from '../src/bridge/audit.js';
import { getActiveSessions, validateOperatorCode } from '../src/lib/operatorAuth.js';
import { isCronAuthorized, isToolCallAuthorized } from '../src/lib/requestAuth.js';

function responseRecorder() {
  let status = 0;
  let body = '';
  const headers: Record<string, unknown> = {};
  return {
    response: {
      writeHead(code: number, values?: Record<string, unknown>) {
        status = code;
        Object.assign(headers, values || {});
        return this;
      },
      end(value?: unknown) {
        body = value === undefined ? '' : String(value);
      },
    } as any,
    result: () => ({ status, body, headers }),
  };
}

const originalEnv = {
  COLOSSUS_OPERATOR_CODE: process.env.COLOSSUS_OPERATOR_CODE,
  COLOSSUS_TOOL_KEY: process.env.COLOSSUS_TOOL_KEY,
  COLOSSUS_OPERATOR_GUID: process.env.COLOSSUS_OPERATOR_GUID,
  NOTION_TOKEN: process.env.NOTION_TOKEN,
  COLOSSUS_KEY: process.env.COLOSSUS_KEY,
  ALLOW_UNAUTHENTICATED_TOOL_CALLS: process.env.ALLOW_UNAUTHENTICATED_TOOL_CALLS,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('security hardening', () => {
  it('rejects an unauthenticated direct Notion POST inside the handler', async () => {
    delete process.env.COLOSSUS_OPERATOR_CODE;
    delete process.env.COLOSSUS_TOOL_KEY;
    delete process.env.COLOSSUS_OPERATOR_GUID;

    const req = {
      method: 'POST',
      headers: {},
      [Symbol.asyncIterator]: async function* () {},
    } as any;
    const recorder = responseRecorder();

    await notionCallHandler(req, recorder.response);

    expect(recorder.result().status).toBe(401);
    expect(JSON.parse(recorder.result().body).error).toContain('OPERATOR_AUTH_REQUIRED');
  });

  it('fails closed before broker network access when workload identity is missing', async () => {
    delete process.env.NOTION_TOKEN;
    const ledger = new AuditLedger();

    await expect(ledger.retrieveNotion('APEX', 1)).rejects.toThrow('notion_broker_identity_missing');
  });

  it('stores only a credential fingerprint in active operator sessions', () => {
    const guid = '12345678-1234-1234-1234-123456789012';
    delete process.env.COLOSSUS_OPERATOR_CODE;
    delete process.env.COLOSSUS_TOOL_KEY;
    process.env.COLOSSUS_OPERATOR_GUID = guid;

    const result = validateOperatorCode(guid);
    const session = getActiveSessions().find((item) => item.operatorId.includes(guid));

    expect(result.authorized).toBe(true);
    expect(session?.credentialFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(session).not.toHaveProperty('code');
  });

  it('fails closed for cron execution when CRON_SECRET is missing', () => {
    expect(isCronAuthorized(undefined, {})).toBe(false);
  });

  it('requires the exact cron bearer secret', () => {
    const env = { CRON_SECRET: 'cron-secret' };
    expect(isCronAuthorized('Bearer cron-secret', env)).toBe(true);
    expect(isCronAuthorized('Bearer wrong', env)).toBe(false);
  });

  it('never permits the unauthenticated tool escape hatch in production', () => {
    const env = {
      ALLOW_UNAUTHENTICATED_TOOL_CALLS: 'true',
      NODE_ENV: 'production',
    };
    expect(isToolCallAuthorized({}, env)).toBe(false);
  });

  it('preserves explicitly opted-in unauthenticated tool calls outside production', () => {
    const env = {
      ALLOW_UNAUTHENTICATED_TOOL_CALLS: 'true',
      NODE_ENV: 'development',
    };
    expect(isToolCallAuthorized({}, env)).toBe(true);
  });

  it('accepts an exact tool bearer when a gateway key is configured', () => {
    const env = { COLOSSUS_TOOL_KEY: 'tool-secret', NODE_ENV: 'production' };
    expect(isToolCallAuthorized({ authorization: 'Bearer tool-secret' }, env)).toBe(true);
    expect(isToolCallAuthorized({ authorization: 'Bearer wrong' }, env)).toBe(false);
  });


  it('requires authentication for Box status in production', async () => {
    delete process.env.COLOSSUS_TOOL_KEY;
    delete process.env.COLOSSUS_KEY;
    delete process.env.ALLOW_UNAUTHENTICATED_TOOL_CALLS;
    process.env.NODE_ENV = 'production';

    const req = {
      method: 'GET',
      url: '/box/status',
      headers: {},
    } as any;
    const recorder = responseRecorder();

    await boxStatusHandler(req, recorder.response);

    expect(recorder.result().status).toBe(401);
  });

  it('does not retain the one-shot NEX mutation escape hatch on the public Box status route', () => {
    const source = readFileSync(new URL('../api/box-status.ts', import.meta.url), 'utf8');
    expect(source).not.toContain("operator_action");
    expect(source).not.toContain("dropbox_to_box_native");
    expect(source).not.toContain("cherry NEX 6.m4a");
  });

});
