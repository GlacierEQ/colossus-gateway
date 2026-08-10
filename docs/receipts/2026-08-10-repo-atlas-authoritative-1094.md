# Repo Atlas Authoritative Reconciliation — 2026-08-10

## Decision

The controlling full-installation GitHub App inventory is **1,094 repositories**.

The earlier 1,220-row snapshot remains a valid historical observation at 2026-08-10T06:33:47Z, but it is superseded as present-state authority by two consecutive canonical 1,094-row refreshes.

## Latest controlling snapshot

- snapshot_id: `b9a12915-0cda-4a1b-80f0-f6505b3531d2`
- created_at: `2026-08-10T10:06:37.310077Z`
- repository_count: **1,094**
- non-forks: **584**
- forks: **510**
- archived: **68**
- private: **472**
- inventory_root_sha256: `9c1f62d672a07fa949758286e765b8698ea24b8f2eaba7eb40a85b4e3046d719`
- scan_mode: `metadata_only`
- installation_scope: `all`
- GitHub writes: **0**
- installation token persisted: **false**

The immediately preceding canonical snapshot was `5c0eda9d-c0c2-4fd2-a862-5df8dd10a0b7` at 2026-08-10T10:02:10.499749Z. The latest refresh reports **0 new / 0 removed-or-transferred / 0 renamed-or-transferred** relative to that snapshot, confirming stable repository membership across consecutive full-installation scans. Six repository state fields changed between those scans, which is why the inventory roots differ despite identical membership.

## Full head-SHA and fork-lineage enrichment

The latest snapshot is fully enriched and finalized:

- enrichment receipt_id: `4c040df3-785f-4614-95da-01016e7f2577`
- enriched rows: **1,094 / 1,094**
- default-head SHA rows: **1,094 / 1,094**
- fork parent/root-source lineage rows: **510 / 510 forks**
- enrichment_root_sha256: `2638b242a87336fee7e1b218b4703903f8d20e9944546cf96c7bb5c60533724a`
- GitHub permissions: `metadata:read`, `contents:read`
- GitHub writes: **0**
- installation token persisted: **false**

The canonical daily audit run `31377647340` completed successfully and emitted all three proof artifacts: refresh proof, enrichment proof, and redacted Repo Atlas health receipt. The redacted receipt confirms a fresh metadata-only all-repository snapshot, no GitHub content fetch during inventory, no persisted inventory token, and a succeeded audit chain.

The immutable projection binds, for every repository in this snapshot:

- GitHub repository ID
- full name
- visibility/private status
- archive status
- fork status
- default branch
- exact current default-branch HEAD SHA
- push/update timestamps
- direct fork parent repository ID/name when forked
- root fork source repository ID/name when forked
- observation timestamp

The production service-role-only view `public.apex_repo_atlas_current_enriched_v1` resolves to this latest fully finalized enriched snapshot. Production readback returns **1,094 rows, 1,094 non-null default HEAD SHAs, and 510 fork source-lineage rows** from exactly one snapshot.

## Exact Aug. 8 reconciliation

Aug. 8 baseline:

- snapshot_id: `f8ef694c-ef5b-4513-ad19-2b92f18f4fbc`
- repository_count: **1,180**
- non-forks: **598**
- forks: **582**
- archived: **53**
- private: **523**

Stable GitHub repository-ID comparison from the Aug. 8 baseline directly to the canonical 1,094-member estate yields:

- repository IDs present now but absent Aug. 8: **44 added**
- repository IDs present Aug. 8 but absent now: **130 removed or transferred out**
- stable repository IDs whose full name changed: **0**
- net estate change: **44 - 130 = -86**

Therefore the phrase “86 missing repositories” is only a **net-count shorthand**. There is no defensible set of exactly 86 deleted repository IDs. The complete stable-ID accounting is the disjoint pair of sets: **130 departures and 44 arrivals**, whose net is −86.

Composition of those sets:

- removed/transferred: **74 forks + 56 non-forks = 130**
- added: **2 forks + 42 non-forks = 44**

This directly explains the category changes:

- forks: `582 - 74 + 2 = 510`
- non-forks: `598 - 56 + 42 = 584`
- total: `1,180 - 130 + 44 = 1,094`

### Deterministic row-level accounting query

The immutable snapshot rows retain every stable GitHub ID needed to reproduce both sets exactly. Because membership is unchanged between the two consecutive 1,094 snapshots, either current snapshot returns the same 174 changed stable IDs; the query below binds to the latest one.

```sql
with
baseline as (
  select snapshot_id
  from public.apex_repo_atlas_snapshots
  where snapshot_id = 'f8ef694c-ef5b-4513-ad19-2b92f18f4fbc'
),
current_snapshot as (
  select snapshot_id
  from public.apex_repo_atlas_snapshots
  where snapshot_id = 'b9a12915-0cda-4a1b-80f0-f6505b3531d2'
),
b as (
  select r.*
  from public.apex_repo_atlas_repositories r
  join baseline s using (snapshot_id)
),
c as (
  select r.*
  from public.apex_repo_atlas_repositories r
  join current_snapshot s using (snapshot_id)
)
select
  'REMOVED_OR_TRANSFERRED' as reconciliation_state,
  b.repository_id,
  b.full_name,
  b.is_fork,
  b.is_archived,
  b.is_private,
  b.default_branch,
  b.pushed_at,
  b.updated_at
from b
where not exists (
  select 1 from c where c.repository_id = b.repository_id
)
union all
select
  'ADDED' as reconciliation_state,
  c.repository_id,
  c.full_name,
  c.is_fork,
  c.is_archived,
  c.is_private,
  c.default_branch,
  c.pushed_at,
  c.updated_at
from c
where not exists (
  select 1 from b where b.repository_id = c.repository_id
)
order by reconciliation_state, repository_id;
```

That query returns all **174 changed stable IDs**: 130 departures plus 44 arrivals. No name matching or heuristic inference is required.

## Intermediate 1,220-row snapshot

The finalized snapshot `dc3dad1b-997f-45e7-9dc9-1741d1ec9ad6` contained 1,220 repositories at 2026-08-10T06:33:47.140311Z. It became stale before enrichment.

A live installation preflight correctly failed closed and measured:

- live installation count: **1,094**
- stale snapshot count: **1,220**
- stable IDs missing from live installation: **130**
- stable IDs newly present live: **4**

The canonical refresh then produced the 1,094-member estate rather than silently skipping those discrepancies.

## Supersession rule

`docs/receipts/2026-08-10-repo-atlas-reconciliation.md` is retained as historical provenance for the earlier 1,220 observation, but any statement in it describing 1,220 as current/present-state authority is superseded by this receipt.

Current estate decisions must bind to snapshot `b9a12915-0cda-4a1b-80f0-f6505b3531d2` or a later finalized full-installation snapshot.
