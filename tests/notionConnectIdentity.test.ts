import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
}));

import { getVercelOidcToken } from "@vercel/oidc";
import { resolveNotionConnectOidcToken } from "../api/notion-connect.js";

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
});
