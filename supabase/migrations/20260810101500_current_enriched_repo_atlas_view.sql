create or replace view public.apex_repo_atlas_current_enriched_v1
with (security_invoker = true)
as
with current_receipt as (
  select r.snapshot_id
  from public.apex_repo_atlas_enrichment_receipts r
  join public.apex_repo_atlas_snapshots s using (snapshot_id)
  where r.enriched_count = r.repository_count
    and r.default_head_count = r.repository_count
  order by s.created_at desc
  limit 1
)
select
  base.snapshot_id,
  base.repository_id,
  base.full_name,
  base.visibility,
  base.is_private,
  base.is_fork,
  base.is_archived,
  base.default_branch,
  enrich.default_head_sha,
  base.pushed_at,
  base.updated_at,
  enrich.parent_repository_id,
  enrich.parent_full_name,
  enrich.source_repository_id,
  enrich.source_full_name,
  enrich.observed_at,
  base.family,
  base.lifecycle_state,
  base.canonical_score,
  base.verified_canonical
from current_receipt current
join public.apex_repo_atlas_repositories base
  on base.snapshot_id = current.snapshot_id
join public.apex_repo_atlas_repository_enrichment enrich
  on enrich.snapshot_id = base.snapshot_id
 and enrich.repository_id = base.repository_id
order by base.repository_id;

revoke all on public.apex_repo_atlas_current_enriched_v1 from public, anon, authenticated;
grant select on public.apex_repo_atlas_current_enriched_v1 to service_role;

comment on view public.apex_repo_atlas_current_enriched_v1 is
  'Latest fully finalized Repo Atlas snapshot with exact default-head SHA and fork parent/root lineage; service-role only.';
