import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { handleSigmaDispatch as handler } from "../src/lib/sigmaDispatchReceiver.js";

const original = process.env.COLOSSUS_TOOL_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.COLOSSUS_TOOL_KEY;
  else process.env.COLOSSUS_TOOL_KEY = original;
});

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const source = value as Record<string, unknown>;
  return "{" + Object.keys(source).sort()
    .map(key => JSON.stringify(key) + ":" + canonical(source[key])).join(",") + "}";
}

function envelope(overrides: Record<string, unknown> = {}) {
  const core = {
    protocolVersion: "sigma-federation/v1",
    schemaVersion: "colossus-dispatch/v1",
    requestId: "request-safe-1",
    traceId: "trace-safe-1",
    jobId: "job-safe-1",
    componentRef: "colossus-gateway@v1",
    resolvedAdapterId: "colossus-gateway",
    method: "read",
    capability: "gateway.capabilities",
    idempotencyKey: "idem-safe-1",
    planFingerprint: "sha256:plan-safe-1",
    policyVersion: "policy-safe-1",
    scopedHandles: [],
    payload: {},
    authorization: {
      permitId: "permit-safe-1",
      permitFingerprint: "sha256:permit-safe-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    createdAt: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
  return {
    ...core,
    envelopeFingerprint: "sha256:" + createHash("sha256").update(canonical(core)).digest("hex"),
  };
}

function responseRecorder() {
  let code = 0;
  let output = "";
  const headers: Record<string, unknown> = {};
  return {
    response: {
      writeHead(status: number, values?: Record<string, unknown>) {
        code = status;
        Object.assign(headers, values || {});
        return this;
      },
      end(data?: unknown) { output = data === undefined ? "" : String(data); },
    } as any,
    result: () => ({ code, data: JSON.parse(output), headers }),
  };
}

async function post(body: unknown, token = "test-secret", headers: Record<string, string> = {}) {
  const req = Object.assign(Readable.from([JSON.stringify(body)]), {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      ...(typeof body === "object" && body !== null && "envelopeFingerprint" in body
        ? {
            "x-sigma-envelope-fingerprint": String((body as any).envelopeFingerprint),
            "x-sigma-request-id": String((body as any).requestId),
            "x-sigma-trace-id": String((body as any).traceId),
          }
        : {}),
      ...headers,
    },
  });
  const rec = responseRecorder();
  await handler(req as any, rec.response);
  return rec.result();
}

describe("colossus-dispatch/v1 receiver", () => {
  it("rejects unauthenticated calls before any dispatch", async () => {
    process.env.COLOSSUS_TOOL_KEY = "test-secret";
    const result = await post(envelope(), "wrong-secret");
    expect(result.code).toBe(401);
    expect(result.data).not.toHaveProperty("receiptId");
  });

  it("returns an exact Sigma-bound receipt only for allowed read-only gateway capability", async () => {
    process.env.COLOSSUS_TOOL_KEY = "test-secret";
    const input = envelope();
    const result = await post(input);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({
      requestId: input.requestId,
      envelopeFingerprint: input.envelopeFingerprint,
      permitFingerprint: input.authorization.permitFingerprint,
      componentRef: input.componentRef,
      method: input.method,
      idempotencyKey: input.idempotencyKey,
      resolvedAdapterId: input.resolvedAdapterId,
      capability: input.capability,
      status: "dispatched",
      redactedDiagnostics: [],
    });
    expect(result.data).not.toHaveProperty("providerConfirmation");
    expect(new Date(result.data.receivedAt).toISOString()).toBe(result.data.receivedAt);
  });

  it("rejects tampered envelope fingerprint and correlation headers", async () => {
    process.env.COLOSSUS_TOOL_KEY = "test-secret";
    const input = envelope();
    const tampered = await post({ ...input, payload: { changed: true } });
    const mismatched = await post(input, "test-secret", { "x-sigma-request-id": "substituted" });
    expect(tampered.code).toBe(400);
    expect(mismatched.code).toBe(400);
  });

  it("blocks arbitrary external mutation even with a syntactically valid permit", async () => {
    process.env.COLOSSUS_TOOL_KEY = "test-secret";
    const input = envelope({
      componentRef: "filesystem@v1",
      resolvedAdapterId: "filesystem",
      method: "execute",
      capability: "filesystem.delete",
      payload: { path: "/tmp/example" },
    });
    const result = await post(input);
    expect(result.code).toBe(200);
    expect(result.data.status).toBe("blocked");
    expect(result.data.reasonCode).toBe("CAPABILITY_NOT_ENABLED");
  });

  it("rejects expired permits and payloads containing secrets", async () => {
    process.env.COLOSSUS_TOOL_KEY = "test-secret";
    const expired = await post(envelope({
      authorization: {
        permitId: "permit-safe-1",
        permitFingerprint: "sha256:permit-safe-1",
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
    }));
    const withSecret = await post(envelope({ payload: { accessToken: "raw-secret" } }));
    expect(expired.code).toBe(400);
    expect(withSecret.code).toBe(400);
  });
});
