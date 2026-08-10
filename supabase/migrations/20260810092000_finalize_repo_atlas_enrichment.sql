create or replace function public.finalize_apex_repo_atlas_enrichment(
  p_snapshot_id uuid,
  p_rows jsonb,
  p_enrichment_root_sha256 text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  expected_count integer;
  supplied_count integer;
  inserted_count integer;
  head_count integer;
  lineage_count integer;
  existing_receipt public.apex_repo_atlas_enrichment_receipts%rowtype;
  new_receipt_id uuid;
begin
  if p_enrichment_root_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_enrichment_root';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'enrichment_rows_must_be_array';
  end if;

  select s.repository_count
    into expected_count
  from public.apex_repo_atlas_snapshots s
  where s.snapshot_id = p_snapshot_id
    and (
      s.metadata->>'refresh_status' = 'refreshed'
      or s.metadata->>'seed_status' = 'seeded'
    );
  if expected_count is null then
    raise exception 'finalized_snapshot_not_found';
  end if;

  select *
    into existing_receipt
  from public.apex_repo_atlas_enrichment_receipts
  where snapshot_id = p_snapshot_id;
  if found then
    if existing_receipt.enrichment_root_sha256 = p_enrichment_root_sha256 then
      return existing_receipt.receipt_id;
    end if;
    raise exception 'snapshot_enrichment_already_finalized';
  end if;

  supplied_count := jsonb_array_length(p_rows);
  if supplied_count <> expected_count then
    raise exception 'enrichment_count_mismatch';
  end if;

  insert into public.apex_repo_atlas_repository_enrichment (
    snapshot_id,
    repository_id,
    default_branch,
    default_head_sha,
    parent_repository_id,
    parent_full_name,
    source_repository_id,
    source_full_name,
    observed_at,
    metadata
  )
  select
    p_snapshot_id,
    x.repository_id,
    x.default_branch,
    x.default_head_sha,
    x.parent_repository_id,
    x.parent_full_name,
    x.source_repository_id,
    x.source_full_name,
    coalesce(x.observed_at, now()),
    coalesce(x.metadata, '{}'::jsonb)
  from jsonb_to_recordset(p_rows) as x(
    repository_id bigint,
    default_branch text,
    default_head_sha text,
    parent_repository_id bigint,
    parent_full_name text,
    source_repository_id bigint,
    source_full_name text,
    observed_at timestamptz,
    metadata jsonb
  );

  get diagnostics inserted_count = row_count;
  if inserted_count <> expected_count then
    raise exception 'enrichment_insert_count_mismatch';
  end if;

  if exists (
    select 1
    from public.apex_repo_atlas_repositories base
    left join public.apex_repo_atlas_repository_enrichment enrich
      on enrich.snapshot_id = base.snapshot_id
     and enrich.repository_id = base.repository_id
    where base.snapshot_id = p_snapshot_id
      and enrich.repository_id is null
  ) then
    raise exception 'enrichment_membership_incomplete';
  end if;

  select
    count(*) filter (where default_head_sha is not null),
    count(*) filter (where source_repository_id is not null)
  into head_count, lineage_count
  from public.apex_repo_atlas_repository_enrichment
  where snapshot_id = p_snapshot_id;

  insert into public.apex_repo_atlas_enrichment_receipts (
    snapshot_id,
    repository_count,
    enriched_count,
    default_head_count,
    fork_lineage_count,
    enrichment_root_sha256,
    metadata
  )
  values (
    p_snapshot_id,
    expected_count,
    inserted_count,
    head_count,
    lineage_count,
    p_enrichment_root_sha256,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning receipt_id into new_receipt_id;

  return new_receipt_id;
exception
  when others then
    delete from public.apex_repo_atlas_repository_enrichment
      where snapshot_id = p_snapshot_id
        and not exists (
          select 1 from public.apex_repo_atlas_enrichment_receipts r
          where r.snapshot_id = p_snapshot_id
        );
    raise;
end;
$$;

revoke all on function public.finalize_apex_repo_atlas_enrichment(uuid, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_apex_repo_atlas_enrichment(uuid, jsonb, text, jsonb)
  to service_role;

revoke insert, update, delete, truncate
  on public.apex_repo_atlas_repository_enrichment
  from service_role;
revoke insert, update, delete, truncate
  on public.apex_repo_atlas_enrichment_receipts
  from service_role;
grant select on public.apex_repo_atlas_repository_enrichment to service_role;
grant select on public.apex_repo_atlas_enrichment_receipts to service_role;
