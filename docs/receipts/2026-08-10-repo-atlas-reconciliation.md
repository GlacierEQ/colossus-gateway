# Repo Atlas Reconciliation Receipt — 2026-08-10

## Authority

This receipt reconciles the Aug. 8 canonical Repo Atlas checkpoint against the latest finalized, full-installation GitHub App snapshot. Repository identity is matched by stable GitHub `repository_id`, not repository name.

## Controlling snapshots

| Field | Aug. 8 checkpoint | Latest governed snapshot | Delta |
|---|---:|---:|---:|
| Snapshot ID | `f8ef694c-ef5b-4513-ad19-2b92f18f4fbc` | `dc3dad1b-997f-45e7-9dc9-1741d1ec9ad6` | — |
| Created at (UTC) | 2026-08-08 16:23:15.845973 | 2026-08-10 06:33:47.140311 | — |
| Total repositories | 1,180 | 1,220 | +40 |
| Non-forks | 598 | 638 | +40 |
| Forks | 582 | 582 | 0 |
| Archived | 53 | 54 | +1 |
| Private | 523 | 525 | +2 |

Latest inventory root SHA-256:

`09f71929ae6f2a872788e5935e56733a220eeeedcd41317136f47f3f32d6be00`

Stable-ID set reconciliation between the two snapshots:

- added: **40**
- removed or transferred: **0**
- renamed or transferred: **0**

## Correction of the earlier “86 missing” conclusion

The earlier 1,094-repository GitHub Search result is **not authoritative for the full estate**. It was produced through a different connector/search scope. The canonical Repo Atlas refresh uses the verified GitHub App installation with `repository_selection=all` and enumerates `/installation/repositories` under a metadata-only installation token.

The full-installation snapshots prove that the Aug. 8 set did not lose 86 repositories. From Aug. 8 to the latest finalized snapshot, **zero stable repository IDs disappeared and zero stable IDs changed repository full name**. The “86 missing” conclusion is therefore retired as a connector-scope artifact and must not be propagated into future census or lineage work.

## Repositories added since Aug. 8

All 40 additions are non-forks.

| Repository ID | Repository |
|---:|---|
| 1328440032 | `GlacierEQ/anduril-lattice-dissent-freeze` |
| 1328440076 | `GlacierEQ/anduril-sensor-health-quorum` |
| 1328440165 | `GlacierEQ/anduril-track-envelope-compiler` |
| 1328440251 | `GlacierEQ/anthropic-constitutional-tool-transcript` |
| 1328440329 | `GlacierEQ/anthropic-refusal-replay-harness` |
| 1328440400 | `GlacierEQ/cloudflare-bot-intent-receipt` |
| 1328440495 | `GlacierEQ/cloudflare-workers-agent-cap` |
| 1328440535 | `GlacierEQ/databricks-feature-lineage-passport` |
| 1328440587 | `GlacierEQ/databricks-notebook-claim-fence` |
| 1328440633 | `GlacierEQ/groq-batch-admission-gate` |
| 1328440702 | `GlacierEQ/groq-jitter-envelope-contract` |
| 1328440764 | `GlacierEQ/lockheed-dual-key-actuator-fence` |
| 1328440828 | `GlacierEQ/lockheed-evidence-binding-gateway` |
| 1328440879 | `GlacierEQ/lockheed-mission-thread-isolator` |
| 1328440929 | `GlacierEQ/nasa-command-authority-half-life` |
| 1328440971 | `GlacierEQ/nasa-telemetry-anomaly-receipt` |
| 1328441063 | `GlacierEQ/nvidia-gradient-integrity-quorum` |
| 1328441142 | `GlacierEQ/nvidia-nan-circuit-breaker` |
| 1328441212 | `GlacierEQ/openai-reasoning-budget-futures` |
| 1328441275 | `GlacierEQ/openai-tool-authority-matrix` |
| 1328441342 | `GlacierEQ/palantir-action-lineage-graph` |
| 1328441385 | `GlacierEQ/palantir-object-authority-matrix` |
| 1328441436 | `GlacierEQ/palantir-ontology-writeback-ledger` |
| 1328441495 | `GlacierEQ/scale-agreement-budget-allocator` |
| 1328441543 | `GlacierEQ/scale-eval-poison-sentinel` |
| 1328441599 | `GlacierEQ/scale-label-collusion-bound` |
| 1328441657 | `GlacierEQ/snowflake-cortex-claim-bound` |
| 1328441724 | `GlacierEQ/snowflake-query-intent-ledger` |
| 1328441790 | `GlacierEQ/spacex-hold-reason-compiler` |
| 1328441856 | `GlacierEQ/spacex-mission-thread-quorum` |
| 1328441920 | `GlacierEQ/vercel-deploy-claim-compiler` |
| 1328441985 | `GlacierEQ/vercel-edge-agent-cap-token` |
| 1328442050 | `GlacierEQ/vercel-preview-truth-gate` |
| 1328442114 | `GlacierEQ/waymo-phantom-freespace-certificate` |
| 1328442171 | `GlacierEQ/waymo-uncertainty-lane-graph` |
| 1328442240 | `GlacierEQ/xai-actuation-receipt-bus` |
| 1328442315 | `GlacierEQ/xai-claim-promotion-fence` |
| 1329352030 | `GlacierEQ/glaciereq-excellence-core` |
| 1329475508 | `GlacierEQ/infinity-gauntlet-mcp-stack` |
| 1329480294 | `GlacierEQ/polyglot-systems-architecture` |

The last two entries retire the Aug. 8 “missing lineage” blocker for `infinity-gauntlet-mcp-stack` and `polyglot-systems-architecture`.

## Current schema boundary

The immutable Atlas repository row currently carries:

- repository ID and full name;
- visibility/private/fork/archive flags;
- default branch;
- push/update timestamps;
- family/lifecycle/canonical scoring metadata.

It does **not yet bind** two requested fields:

1. the current commit SHA at the default branch head;
2. direct fork parent/root-source repository lineage.

Those fields must not be retroactively injected into finalized inventory rows. The next schema delta should add a snapshot-keyed enrichment projection with its own deterministic integrity root, preserving the finalized inventory root above.

## Required enrichment invariant

For every row in a finalized snapshot, an enrichment projection should bind:

- `snapshot_id`
- `repository_id`
- `default_branch`
- `default_head_sha`
- `parent_repository_id` / `parent_full_name` when forked
- `source_repository_id` / `source_full_name` when forked
- `observed_at`
- deterministic enrichment root SHA-256

The enrichment job must use the same verified all-repository GitHub App authority, metadata-only access, bounded OIDC caller identity, no persisted installation token, and no GitHub writes.

## Decision

**Canonical present-state repository count: 1,220.**

The Aug. 8 1,180-repository checkpoint remains a valid historical snapshot. The 1,094 search count and its derived 86-missing hypothesis are superseded and must not be used as estate truth.
