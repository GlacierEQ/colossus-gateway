# Repo Atlas Receipt — Mastermind Family Lineage Verification

Date: 2026-08-08 HST
Status: VERIFIED
Action class: WRITE_INTERNAL

## Scope

Verify the `mastermind` / `Pro-Mastermind` family using current GitHub repository evidence and the controlling family declaration. This receipt does not mutate either family repository.

## Controlling repositories and heads

- `GlacierEQ/mastermind` `main`: `d09f2703b068c4cef730473c86ae2ef9d83e6046`
- `GlacierEQ/Pro-Mastermind` `main`: `fc02fd032120df8ac2c02a2cde3324794ed53732`
- Receipt repository base `GlacierEQ/colossus-gateway` `main`: `11855a3ad792ff70f2310a948c99e21ad0823bfc`

## Controlling declaration

Immutable authority anchor:

- `GlacierEQ/mastermind@d09f2703b068c4cef730473c86ae2ef9d83e6046/CANONICAL.md`

That constitution declares:

- canonical owner: `GlacierEQ/mastermind`;
- canonical family: `FAM-MASTERMIND`;
- `mastermind` is the only canonical control-plane authority;
- `Pro-Mastermind` is the execution cortex and is explicitly not a second control plane.

## Direct repository evidence

Current `mastermind` documentation describes the repository as the canonical intelligence-orchestration laboratory/control-plane family authority under consolidation, with only evidence-bounded runtime claims promoted.

Current `Pro-Mastermind` documentation identifies the repository as **Megamind**, a specialist operating system for engineering systems that improve other systems. The following evidence is commit-scoped to `fc02fd032120df8ac2c02a2cde3324794ed53732` so the capability basis cannot drift with a later branch tip:

- execution-body registry and execution contract: `docs/EXECUTION_BODIES.md`, `src/megamind/bodies.py`, `tests/test_execution_bodies.py`;
- CLI planning/inspection surface: `src/megamind/cli.py`;
- model-vault contract and governed registry: `docs/MODEL_VAULT_STANDARD.md`, `registry/model_vault.yml`, `registry/model_vault.d/`;
- technology-stack contract: `proto/technology_stack.proto`, `registry/technology_stack.d/`, `docs/TECHNOLOGY_DIVERSIFICATION_PLAYBOOK.md`;
- executable/tested package boundary and CI: `pyproject.toml`, `.github/workflows/ci.yml`, `tests/`;
- architecture/runtime-readiness boundaries: `README.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`;
- deterministic receipt and recovery evidence surfaces: `docs/RECOVERY_LEDGER.md` plus the receipt/ledger behavior described by the immutable README and execution-body contract.

The repository tree for that exact commit contains these files and registries. Therefore `Pro-Mastermind` is not a stale byte-copy or retirement-ready backup of `mastermind`; it is a distinct active family member whose role is subordinate/specialist execution under the canonical `mastermind` control plane.

## Atlas classification decision

Preserve the family-level canonical result:

- canonical control plane: `GlacierEQ/mastermind` — HIGH confidence, VERIFIED;
- `GlacierEQ/Pro-Mastermind`: family member role `execution_cortex` / specialist Megamind implementation — HIGH confidence, VERIFIED;
- do **not** count `Pro-Mastermind` as a second canonical control plane;
- do **not** classify `Pro-Mastermind` as a stale duplicate suitable for retirement solely from normalized-name similarity.

Any metadata-only census row that labels `Pro-Mastermind` only as `duplicate-successor` is superseded by this direct controlling evidence and must be corrected by the next authoritative Atlas projection.

## Projection artifact and generation provenance

The stale projection identified during this verification is:

- artifact: `GlacierEQ_598_NonFork_Repo_Census_2026-08-07.xlsx`;
- observed row behavior: `Pro-Mastermind` is reduced to a metadata-derived duplicate/successor classification rather than its controlling family role;
- generation commit: **UNBOUND / NOT RECORDED IN THE ARTIFACT**. No GitHub generation revision is asserted because none is embedded in or discoverable from the controlling artifact. This is a provenance gap, not a guessed SHA.

The next generated projection must bind itself to the refresh implementation revision and emit a source revision or receipt identifier. A regenerated workbook without that binding is not sufficient to close this blocker.

## Authoritative refresh path

Current refresh implementation anchor:

- repository: `GlacierEQ/colossus-gateway`;
- implementation revision: `11855a3ad792ff70f2310a948c99e21ad0823bfc`;
- Edge Function: `supabase/functions/apex-github-oidc-estate-atlas-refresh/index.ts`;
- refresh lease migration: `supabase/migrations/20260808151500_repo_atlas_refresh_lease.sql`;
- trigger authority encoded by the broker: `GlacierEQ/apex-control-plane/.github/workflows/daily_audit.yml@refs/heads/main` through GitHub OIDC;
- installation tokens remain short-lived request-scoped values and are not a persisted Atlas credential.

This broker is the authoritative inventory-refresh ingress. Its current heuristic family/signature projection is not, by itself, allowed to override the normative `FAM-MASTERMIND` declaration above. The family-role override must be applied in the generated projection layer or an equivalent canonical-family projection step before the census is promoted.

## Acceptance check for blocker closure

Close the stale-census blocker only after a fresh Atlas refresh produces read-back evidence satisfying all of the following on the same refresh receipt/revision:

1. `GlacierEQ/mastermind` resolves to family `FAM-MASTERMIND`, role `control_plane`, canonical = true, confidence HIGH/VERIFIED.
2. `GlacierEQ/Pro-Mastermind` resolves to family `FAM-MASTERMIND`, role `execution_cortex` (specialist Megamind), canonical = false, confidence HIGH/VERIFIED.
3. No generated lifecycle/retirement field marks `Pro-Mastermind` as a retirement-ready duplicate solely because of normalized-name similarity.
4. The refresh output records the exact refresh implementation revision or durable receipt identifier used to generate the projection.
5. The canonical-family override survives a second read from the promoted Atlas state; a transient response or local workbook edit is not sufficient.
6. `mastermind` remains the sole canonical control plane for this family.

## Verification

Read-back sources:

- `GlacierEQ/mastermind@d09f2703b068c4cef730473c86ae2ef9d83e6046/CANONICAL.md`;
- live `mastermind/main` head at the controlling SHA above;
- live `Pro-Mastermind/main` head at the controlling SHA above;
- `GlacierEQ/Pro-Mastermind@fc02fd032120df8ac2c02a2cde3324794ed53732` repository tree and commit-scoped files listed above;
- `GlacierEQ/colossus-gateway@11855a3ad792ff70f2310a948c99e21ad0823bfc/supabase/functions/apex-github-oidc-estate-atlas-refresh/index.ts`;
- `colossus-gateway/docs/REPO_ATLAS_V1.md` for family-classification context only;
- `GlacierEQ_598_NonFork_Repo_Census_2026-08-07.xlsx` as the stale generated projection under correction.

No credentials were read or written. No family repository branch, history, release, deployment, or runtime state was mutated.

## Blocker

The current 598-nonfork workbook is not provenance-bound to a GitHub generation commit and still carries the stale metadata-derived family result for `Pro-Mastermind`. The authoritative refresh/projection path must apply the normative family-role override, regenerate the projection with revision/receipt binding, and pass the acceptance checks above.

## Next cursor

1. Run the authoritative Atlas refresh from the permitted `apex-control-plane` workflow and bind the resulting snapshot to its refresh receipt/revision.
2. Read back both Mastermind-family rows from promoted Atlas state and enforce the six acceptance checks above.
3. Only after that read-back, mark the stale workbook row superseded and advance to the next provisional duplicate family.
4. Keep unique specialist capability harvesting separate from canonical-control-plane selection.
