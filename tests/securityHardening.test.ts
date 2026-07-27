import { afterEach, describe, expect, it } from 'vitest';
import notionCallHandler from '../api/notion-call.js';
import { AuditLedger } from '../src/bridge/audit.js';
import { getActiveSessions, validateOperatorCode } from '../src/lib/operatorAuth.js';

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
});
