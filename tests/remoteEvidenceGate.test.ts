import { afterEach, describe, expect, it } from "vitest";
import { remoteExecutor } from "../src/lib/remoteExecutor.js";
import { KNOWN_REMOTE_TOOLS, unverifiedLegacyEnabled } from "../src/lib/remoteExecutionPolicy.js";
import { readFileSync } from "node:fs";

afterEach(() => {
  delete process.env.COLOSSUS_ENABLE_UNVERIFIED_LEGACY_TOOLS;
});

describe("remote execution evidence gate", () => {
  it("blocks synthetic legacy execution by default", async () => {
    const result = await remoteExecutor.execute("whisperx.validate", { evidenceId: "EXH-001" });

    expect(result).toEqual({
      success: false,
      error: "UNVERIFIED_LEGACY_TOOL_DISABLED",
      data: {
        evidence_state: "BLOCKED_UNVERIFIED_LEGACY",
        tool: "whisperx.validate",
        explicit_opt_in_required: "COLOSSUS_ENABLE_UNVERIFIED_LEGACY_TOOLS=true",
      },
    });
  });

  it("reports the executor inventory by evidence class", async () => {
    const result = await remoteExecutor.execute("gateway.discover", {});

    expect(result.success).toBe(true);
    expect(result.data.evidence_state).toBe("LOCAL_DETERMINISTIC");
    expect(result.data.provider_backed).toContain("github.get_file");
    expect(result.data.blocked_unverified_legacy).toContain("dropbox.list_files");
    expect(result.data).not.toHaveProperty("operational");
  });

  it("classifies every implemented switch action", () => {
    const source = readFileSync(new URL("../src/lib/remoteExecutor.ts", import.meta.url), "utf8");
    const implemented = [...source.matchAll(/case\s+"([^"]+)":/g)]
      .map((match) => match[1])
      .sort();

    expect([...KNOWN_REMOTE_TOOLS].sort()).toEqual(implemented);
  });

  it("never enables legacy registration in production", () => {
    expect(unverifiedLegacyEnabled({
      NODE_ENV: "production",
      COLOSSUS_ENABLE_UNVERIFIED_LEGACY_TOOLS: "true",
    })).toBe(false);
  });

  it("keeps legacy tool registration behind the evidence gate", () => {
    const source = readFileSync(new URL("../src/tools/index.ts", import.meta.url), "utf8");
    const gate = source.indexOf("if (unverifiedLegacyEnabled())");
    const verifiedCall = source.indexOf("registerMemoryTools(server);");
    const legacyCall = source.indexOf("registerWhisperXTools(server);");

    expect(gate).toBeGreaterThan(-1);
    expect(verifiedCall).toBeGreaterThan(-1);
    expect(verifiedCall).toBeLessThan(gate);
    expect(legacyCall).toBeGreaterThan(gate);
  });

});
