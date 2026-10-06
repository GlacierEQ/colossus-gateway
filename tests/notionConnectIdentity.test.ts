import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
}));

import { getVercelOidcToken } from "@vercel/oidc";
import notionConnectHandler, { resolveNotionConnectOidcToken } from "../api/notion-connect.js";


function responseRecorder() {
  let status = 0;
  let body = "";
  return {
    response: {
      writeHead(code: number) {
        status = code;
        return this;
      },
      end(value?: unknown) {
        body = value === undefined ? "" : String(value);
      },
    } as any,
    result: () => ({ status, body }),
  };
}

describe("Notion connect workload identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves Vercel workload identity server-side", async () => {
    vi.mocked(getVercelOidcToken).mockResolvedValue("runtime-oidc-token");

    await expect(resolveNotionConnectOidcToken()).resolves.toBe("runtime-oidc-token");
    expect(getVercelOidcToken).toHaveBeenCalledTimes(1);
  });

  it("fails closed when runtime workload identity is unavailable", async () => {
    vi.mocked(getVercelOidcToken).mockRejectedValue(new Error("oidc unavailable"));

    await expect(resolveNotionConnectOidcToken()).resolves.toBe("");
  });

  it("does not trust a browser-supplied Vercel OIDC header", () => {
    const source = readFileSync(new URL("../api/notion-connect.ts", import.meta.url), "utf8");

    expect(source).toContain("await resolveNotionConnectOidcToken()");
    expect(source).not.toContain("requestHeader(req, 'x-vercel-oidc-token')");
    expect(source).toContain("'x-vercel-oidc-token': oidcToken");
  });


  it("returns 503 before processing setup input when runtime identity is unavailable", async () => {
    vi.mocked(getVercelOidcToken).mockRejectedValue(new Error("oidc unavailable"));
    const req = {
      method: "POST",
      headers: { origin: "https://colossus-gateway.vercel.app" },
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from("{}");
      },
    } as any;
    const recorder = responseRecorder();

    await notionConnectHandler(req, recorder.response);

    expect(recorder.result().status).toBe(503);
    expect(JSON.parse(recorder.result().body)).toEqual({ error: "workload_identity_unavailable" });
  });

  it("uses runtime identity without requiring a browser OIDC header", async () => {
    vi.mocked(getVercelOidcToken).mockResolvedValue("runtime-oidc-token");
    const req = {
      method: "POST",
      headers: { origin: "https://colossus-gateway.vercel.app" },
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from("{}");
      },
    } as any;
    const recorder = responseRecorder();

    await notionConnectHandler(req, recorder.response);

    expect(recorder.result().status).toBe(400);
    expect(JSON.parse(recorder.result().body)).toEqual({ error: "token_and_capability_required" });
  });

});
