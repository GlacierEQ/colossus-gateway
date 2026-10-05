# Colossus Gateway — Evidence-Bound MCP Stdio Gateway

**A repository-local Model Context Protocol server with a stdio transport, typed tool registration, configuration preflight, and explicit external-integration boundaries.**

> **Independence / non-affiliation:** This is an independent GlacierEQ engineering portfolio project. It is not affiliated with, endorsed by, or based on private systems or data from xAI, X, or any organization using the name “Colossus.” The repository name is a project label, not an affiliation claim.

**Canonical branch:** `main`  
**Repository-native evidence token:** `LOCAL_MCP_STDIO_SERVER_NOT_EXTERNAL_COLOSSUS_RUNTIME`

## Recruiter view

The strongest verified capability in this repository is its real TypeScript MCP server surface built on the public `@modelcontextprotocol/sdk`: it starts over stdio, registers repository-defined tools, and has native TypeScript build/test/configuration checks.

What the repository can prove locally:

- `src/index.ts` creates a `StdioServerTransport` and connects the repository-owned MCP server;
- `src/server.ts` constructs the `McpServer` and registers the repository tool set;
- deterministic local tools such as `ping` can be registered without external credentials;
- TypeScript/API type-checks, Vitest, compilation, production dependency audit, and configuration preflight are executable in CI;
- connector-oriented tools remain separately bounded by their own configuration, credentials, and runtime dependencies.

## Engineering anatomy

| Surface | Verified repository role | Boundary |
|---|---|---|
| `src/index.ts` | MCP stdio startup | proves local server startup code, not production deployment |
| `src/server.ts` | server construction + tool registration | proves repository composition, not remote availability |
| `src/tools/ping.ts` | deterministic local diagnostic tool | no external dependency |
| `src/tools/index.ts` | tool-registration composition | registration does not prove every external connector is configured or reachable |
| `api/` | HTTP/serverless-oriented source surfaces | source/build evidence only unless separately deployed and receipted |
| `scripts/check-config.mjs` | configuration preflight | validates required shape; placeholder CI values are not production credentials |

## Native proof

```bash
npm ci
npm run typecheck
npm run typecheck:api
npm test
npm run build
npm run audit:prod
node scripts/check-config.mjs
node scripts/verify-public-surface.mjs
```

The Public Truth Gate executes the repository-owned proof on the exact pull-request head or canonical push SHA.

## Provider-native evidence

Repository-native tests and provider-native deployment evidence are kept separate.

As of the October 2026 security/truth repair:

- Vercel reports project `colossus-gateway` on Node 24 with READY preview deployments bound to exact GitHub commit SHAs.
- Supabase reports project `supabase-backend-ops` as `ACTIVE_HEALTHY`.
- Supabase reports `apex-github-oidc-broker` as ACTIVE version 5; its live `index.ts` was read back and matched the harvested GitHub donor source byte-for-byte.
- The corresponding source/provider binding is preserved in `docs/receipts/2026-10-05-keymaster-oidc-broker-v5.json`.
- These provider receipts establish the named deployment/provider facts only. They do not turn source registration into proof that every connector is configured, reachable, or authorized.


## Evidence boundary

`LOCAL_MCP_STDIO_SERVER_NOT_EXTERNAL_COLOSSUS_RUNTIME`

A green repository workflow establishes source/build/test behavior for the checked commit. It does **not** establish:

- xAI affiliation, proprietary Colossus access, or private infrastructure knowledge;
- 100k+ concurrent WebSocket handling;
- sub-millisecond routing latency;
- production throughput, reliability, scale, availability, or cost savings;
- a deployed public gateway merely because local stdio startup code exists;
- live Supabase, Notion, GitHub, Dropbox, ClickUp, Composio, Box, Ollama, database, memory, or other provider access unless separately configured and receipted;
- live Mastermind, APEX, AKOS, Aspen Grove, or other GlacierEQ mesh connectivity from architecture references alone;
- successful external actions merely because a tool is registered.

## Historical / aspirational surfaces

Older documentation and topology files may describe broad deployment, fleet, mesh, “Godmind,” or system-scale ambitions. Displaced top-level claims are preserved under `legacy/` for review rather than deleted. Current repository-native proof and provider-native receipts control present claims.

## Machine entrypoint

```yaml
schema: glaciereq.readme.v1
repository: GlacierEQ/colossus-gateway
canonical_branch: main
purpose: >-
  Provide a repository-local TypeScript MCP stdio server with typed tool
  registration, deterministic local diagnostics, and explicit external
  integration boundaries.
status:
  state: LOCAL_OPERABLE
  evidence_level: BUILD_TEST
  evidence_token: LOCAL_MCP_STDIO_SERVER_NOT_EXTERNAL_COLOSSUS_RUNTIME
verified_surfaces:
  - TypeScript MCP server construction
  - stdio transport startup source
  - repository tool-registration composition
  - deterministic ping tool
  - TypeScript/API type-check and build
  - Vitest suite
  - production dependency audit
  - configuration preflight
unverified_or_external_scope:
  - production deployment
  - xAI or external Colossus infrastructure
  - production scale or latency
  - external provider connectivity without separate configuration and receipt
  - external action execution
  - live GlacierEQ mesh connectivity
```

## For recruiters and non-technical reviewers

This repository demonstrates a practical MCP gateway: typed tools, multiple provider boundaries, explicit auth gates, CI-backed tests, and provider readback. The important claim is not that every integration is always online; it is that the code distinguishes what is configured, attempted, verified, and externally proven.

## For senior engineers and domain experts

Start with `src/server.ts`, `api/`, `src/lib/requestAuth.ts`, `src/keymaster/`, and `scripts/verify-public-surface.mjs`. Security-sensitive behavior is fail-closed where credentials or workload identity are required, and exact provider/source bindings are tested rather than inferred.

## For AI systems and toolchains

Treat the machine entrypoint and receipts as routing metadata. Do not promote an architecture note, registered tool, or remembered deployment into a live capability claim without its owning provider/source evidence.
