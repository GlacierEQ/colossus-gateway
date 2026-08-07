# Colossus Repo Atlas v1

Date: 2026-08-06 HST

## Purpose

Use the GitHub App's account-wide installation as a discovery and governance surface without turning broad installation scope into broad mutation authority.

## Security model

- GitHub App installation scope: `all` repositories under `GlacierEQ`.
- Permanent App private key: Supabase Vault only.
- GitHub PKCS#1 private keys are normalized to PKCS#8 only in memory for signing.
- No installation token is persisted.
- Portfolio inventory is the sole broad-token exception and is metadata-only/read-only.
- Operational tokens must name exactly one repository and explicit minimum permissions.
- GitHub writes are not part of the Atlas seed scan.
- Canonical candidates remain provisional until direct lineage/authority evidence is found.

## Verified bootstrap

Bootstrap reference: `kb_4c41dc5c421c4d46af18845906e737fc`

Installation ID: `151808478`

Verification result:

- installation scope: `all`
- seven anchor repositories live-read successfully
- token persisted: `false`
- private-key source format: GitHub PKCS#1, normalized only in memory

## First live Atlas snapshot

Snapshot ID: `bd6060c8-587c-4529-a85d-c837d06e3fc5`

Repository inventory:

- total: 1,180
- originals: 598
- forks: 582
- private: 523
- public: 657
- archived: 53
- active: 527
- explicit backup classification: 53
- reference/fork classification: 547

Family counts from metadata classification:

| Family | Repositories |
|---|---:|
| other | 365 |
| legal_evidence | 214 |
| control_plane | 159 |
| research_models | 83 |
| agents | 80 |
| memory_retrieval | 68 |
| browser_automation | 47 |
| document_intelligence | 46 |
| file_operations | 42 |
| runtime_deployment | 35 |
| interfaces | 23 |
| security_forensics | 18 |

The family classifier is a discovery heuristic, not controlling truth. False positives must be corrected during deep inspection.

## Canonical registry

The initial normalized-name pass produced 23 provisional duplicate families. Three were promoted to `VERIFIED` only after direct controlling repository evidence:

1. `GlacierEQ/mastermind`
   - controlling source: `CANONICAL.md`
   - declaration: canonical owner is `GlacierEQ/mastermind`
   - `Pro-Mastermind` is the execution cortex, not a second control plane.

2. `GlacierEQ/ai-auto-driller-unified`
   - controlling source: `INSTALL.md`
   - declaration: install one script only; the unified master is the canonical one-click installer.
   - older platform-specific scripts are legacy alternatives to disable/remove when using the master.

3. `GlacierEQ/apex-fs-commander-unified`
   - controlling source: `docs/DROPBOX_FILESYSTEM_DISCOVERY_2026-07-28.md`
   - declaration: the runnable filesystem MCP is this repository.
   - Dropbox and historical variants are source/discovery material, not runtime authority.

Canonical-verification audit receipt: `56363a8a-1fe7-49a8-aa9f-a0d318e394a9`.

## Ignition Queue

A Top-25 metadata queue is persisted in `apex_repo_ignition_queue` for deeper inspection. The v1 score prioritizes recency, original repositories, substantive size, strategic families, and canonical-name signals while penalizing forks/backups/archives.

The score is triage only. No project is considered healthy, production-ready, or canonical solely because of its queue rank.

## Next pass

For each queued project:

1. inspect source tree, build manifests, tests, workflows, and deployment descriptors;
2. identify the latest verified checkpoint rather than rebuilding;
3. detect missing last-mile dependencies;
4. classify `READY`, `BLOCKED`, `SUPERSEDED`, `REFERENCE`, or `QUARANTINE`;
5. generate a bounded repair plan;
6. if mutation is authorized, mint one repository token with explicit minimum permissions;
7. require build/test/provider receipts before `COMPLETED`.

## Audit receipts

- session recovery/extension: `1ca17ad4-8423-4f22-be01-a61f243e54bf`
- canonical candidates generated: `1c9ff5da-3f5d-41b1-8d0e-186a645a3570`
- ignition queue generated: `ab80ec46-73e2-4457-99ed-84660a102aae`
- canonical families verified: `56363a8a-1fe7-49a8-aa9f-a0d318e394a9`
