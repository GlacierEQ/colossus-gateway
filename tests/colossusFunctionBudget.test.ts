import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vercel Hobby function budget", () => {
  it("composes Sigma's receiving route into an existing function without dropping any existing API", () => {
    const entries = readdirSync(new URL("../api/", import.meta.url))
      .filter(name => name.endsWith(".ts"));
    expect(entries).toHaveLength(12);

    const routes = JSON.parse(
      readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
    ).routes as Array<{ src: string; dest: string }>;
    expect(routes.find(route => route.src === "/v1/dispatch")?.dest)
      .toBe("/api/mcp.ts");

    const entrypoint = readFileSync(new URL("../api/mcp.ts", import.meta.url), "utf8");
    expect(entrypoint).toContain('path === "/v1/dispatch"');
    expect(entrypoint).toContain("handleSigmaDispatch");
  });
});
