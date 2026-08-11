import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_PATH = resolve(
  ROOT,
  "supabase/functions/apex-github-oidc-broker/index.ts",
);
const RECEIPT_PATH = resolve(
  ROOT,
  "docs/receipts/2026-08-11-keymaster-oidc-broker-v3.json",
);

function gitBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`, "utf8");
  return createHash("sha1").update(header).update(content).digest("hex");
}

describe("Keymaster GitHub OIDC broker source contract", () => {
  it("binds the tracked source to the deployment receipt", () => {
    const source = readFileSync(SOURCE_PATH);
    const receipt = JSON.parse(readFileSync(RECEIPT_PATH, "utf8"));

    expect(gitBlobSha(source)).toBe(receipt.source_git_blob_sha);
    expect(receipt.supabase.function_slug).toBe("apex-github-oidc-broker");
    expect(receipt.supabase.deployed_version).toBe(3);
    expect(receipt.supabase.status).toBe("ACTIVE");
    expect(receipt.supabase.deployment_bundle_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the broad resolver token internal and revokes it before scoped mint", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    const resolverMint = source.indexOf('permissions: { metadata: "read" }');
    const resolverRead = source.indexOf(
      "const repoMetadata = await githubJson(`/repos/${owner}/${repoName}`, resolverToken);",
    );
    const resolverRevoke = source.indexOf(
      "await revokeInstallationToken(resolverToken);",
      resolverRead,
    );
    const scopedMint = source.indexOf("repository_ids: [repositoryId]");

    expect(resolverMint).toBeGreaterThan(-1);
    expect(resolverRead).toBeGreaterThan(resolverMint);
    expect(resolverRevoke).toBeGreaterThan(resolverRead);
    expect(scopedMint).toBeGreaterThan(resolverRevoke);
    expect(source).toContain("token: workloadToken");
    expect(source).not.toContain("token: resolverToken");
  });

  it("binds live installation membership and exact repository identity", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    expect(source).toContain(
      "const repositoryInstallation = await githubJson(`/repos/${owner}/${repoName}/installation`, jwt);",
    );
    expect(source).toContain("repository_not_in_live_installation");
    expect(source).toContain("repository_identity_resolution_failed");
    expect(source).toContain("repository_ids: [repositoryId]");
    expect(source).not.toContain("repositories: [repoName]");
  });

  it("requires exact-repository readback before returning the workload token", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    const readback = source.indexOf(
      "const readback = await githubResponse(`/repos/${owner}/${repoName}`, workloadToken);",
    );
    const readbackGate = source.indexOf(
      "scoped_token_repository_readback_",
      readback,
    );
    const returned = source.indexOf("workloadTokenReturned = true;", readbackGate);

    expect(readback).toBeGreaterThan(-1);
    expect(readbackGate).toBeGreaterThan(readback);
    expect(returned).toBeGreaterThan(readbackGate);
  });

  it("attempts revocation when a token exists but cannot safely be returned", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    expect(source).toContain("if (resolverToken)");
    expect(source).toContain("if (workloadToken && !workloadTokenReturned)");
    expect(source).toContain("await revokeInstallationToken(workloadToken)");
  });
});
