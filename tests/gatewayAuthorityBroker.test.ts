import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
}));

import { getVercelOidcToken } from "@vercel/oidc";
import {
  consumeGatewayCapability,
  recordGatewayEvent,
} from "../src/keymaster/gatewayAuthority.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gateway authority broker", () => {
  it("consumes one capability through exact Vercel workload identity", async () => {
    vi.mocked(getVercelOidcToken).mockResolvedValue("runtime-oidc-token");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, consumed: true }));
    vi.stubGlobal("fetch", fetchMock);

    const consumed = await consumeGatewayCapability({
      nonceHash: "a".repeat(64),
      allowedTool: "notion_handoff",
      expectedSha256: "b".repeat(64),
    });

    expect(consumed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/functions/v1/apex-keymaster-broker");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(expect.objectContaining({
      "content-type": "application/json",
      "x-vercel-oidc-token": "runtime-oidc-token",
    }));
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();

    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      action: "gateway_capability_consume",
      nonce_hash: "a".repeat(64),
      allowed_tool: "notion_handoff",
      expected_sha256: "b".repeat(64),
    });
  });

  it("records one sanitized gateway event through the broker", async () => {
    vi.mocked(getVercelOidcToken).mockResolvedValue("runtime-oidc-token");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      recorded: true,
      id: "00000000-0000-0000-0000-000000000001",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await recordGatewayEvent({
      request_id: "request-1234",
      action: "box_search",
      status: "succeeded",
      actor: "operator",
      source: "test",
      arguments_sha256: "c".repeat(64),
      result_sha256: "d".repeat(64),
      metadata: { schema_version: "1.0" },
    });

    expect(result).toEqual(expect.objectContaining({ recorded: true }));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.action).toBe("gateway_event_record");
    expect(body.event).toEqual(expect.objectContaining({
      request_id: "request-1234",
      action: "box_search",
      status: "succeeded",
    }));
  });

  it("fails closed when runtime workload identity is unavailable", async () => {
    vi.mocked(getVercelOidcToken).mockRejectedValue(new Error("oidc unavailable"));
    vi.stubGlobal("fetch", vi.fn());

    await expect(consumeGatewayCapability({
      nonceHash: "a".repeat(64),
      allowedTool: "notion_handoff",
      expectedSha256: "b".repeat(64),
    })).rejects.toThrow("workload_identity_unavailable");
  });

  it("rejects malformed capability fingerprints before network access", async () => {
    vi.mocked(getVercelOidcToken).mockResolvedValue("runtime-oidc-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(consumeGatewayCapability({
      nonceHash: "not-a-hash",
      allowedTool: "notion_handoff",
      expectedSha256: "b".repeat(64),
    })).rejects.toThrow("invalid_nonce_hash");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes the obsolete publishable-key authority path from AuditLedger", () => {
    const source = readFileSync(new URL("../src/bridge/audit.ts", import.meta.url), "utf8");

    expect(source).not.toContain("APEX_CAPABILITY_SUPABASE_PUBLISHABLE_KEY");
    expect(source).not.toContain("recorded_publishable_rpc");
    expect(source).not.toMatch(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
    expect(source).toContain("consumeGatewayCapability");
    expect(source).toContain("recordGatewayEvent");
  });

  it("keeps privileged gateway actions narrow inside the existing Keymaster broker", () => {
    const source = readFileSync(
      new URL("../supabase/functions/apex-keymaster-broker/index.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('action === "gateway_capability_consume"');
    expect(source).toContain('"consume_apex_tool_gateway_capability"');
    expect(source).toContain('action === "gateway_event_record"');
    expect(source).toContain('"record_apex_tool_gateway_event"');
    expect(source).toContain("verifyWorkloadIdentity(req)");
  });
});
