create table if not exists public.apex_repo_atlas_refresh_leases (
  lock_name text primary key,
  claim_id uuid not null,
  claim_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.apex_repo_atlas_refresh_leases enable row level security;
revoke all on public.apex_repo_atlas_refresh_leases from public, anon, authenticated;
grant all on public.apex_repo_atlas_refresh_leases to service_role;

create or replace function public.claim_apex_repo_atlas_refresh()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id uuid := gen_random_uuid();
  v_returned uuid;
begin
  insert into public.apex_repo_atlas_refresh_leases(lock_name, claim_id, claim_expires_at, updated_at)
  values ('estate-refresh', v_claim_id, now() + interval '15 minutes', now())
  on conflict (lock_name) do update
    set claim_id = excluded.claim_id,
        claim_expires_at = excluded.claim_expires_at,
        updated_at = excluded.updated_at
    where public.apex_repo_atlas_refresh_leases.claim_expires_at <= now()
  returning claim_id into v_returned;

  if v_returned is null then
    raise exception 'repo_atlas_refresh_in_progress' using errcode = '55P03';
  end if;
  return v_returned;
end;
$$;

create or replace function public.renew_apex_repo_atlas_refresh(p_claim_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expires_at timestamptz;
begin
  update public.apex_repo_atlas_refresh_leases
  set claim_expires_at = now() + interval '15 minutes',
      updated_at = now()
  where lock_name = 'estate-refresh'
    and claim_id = p_claim_id
    and claim_expires_at > now()
  returning claim_expires_at into v_expires_at;

  if v_expires_at is null then
    raise exception 'repo_atlas_refresh_lease_lost' using errcode = '55P03';
  end if;
  return v_expires_at;
end;
$$;

create or replace function public.release_apex_repo_atlas_refresh(p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.apex_repo_atlas_refresh_leases
  where lock_name = 'estate-refresh'
    and claim_id = p_claim_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

create or replace function public.finalize_apex_repo_atlas_refresh(
  p_claim_id uuid,
  p_snapshot_id uuid,
  p_bootstrap_ref text,
  p_request_id text,
  p_actor text,
  p_snapshot_metadata jsonb,
  p_token_metadata jsonb,
  p_snapshot_audit_metadata jsonb,
  p_canonical_audit_metadata jsonb,
  p_queue_audit_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_id uuid;
  v_updated integer;
begin
  if p_snapshot_metadata is null or jsonb_typeof(p_snapshot_metadata) <> 'object'
     or p_token_metadata is null or jsonb_typeof(p_token_metadata) <> 'object'
     or p_snapshot_audit_metadata is null or jsonb_typeof(p_snapshot_audit_metadata) <> 'object'
     or p_canonical_audit_metadata is null or jsonb_typeof(p_canonical_audit_metadata) <> 'object'
     or p_queue_audit_metadata is null or jsonb_typeof(p_queue_audit_metadata) <> 'object' then
    raise exception 'invalid_repo_atlas_refresh_metadata' using errcode = '22023';
  end if;

  perform 1
  from public.apex_repo_atlas_refresh_leases
  where lock_name = 'estate-refresh'
    and claim_id = p_claim_id
    and claim_expires_at > now()
  for update;

  if not found then
    raise exception 'repo_atlas_refresh_lease_lost' using errcode = '55P03';
  end if;

  update public.apex_repo_atlas_snapshots
  set metadata = p_snapshot_metadata
  where snapshot_id = p_snapshot_id
    and metadata->>'refresh_status' = 'building';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'repo_atlas_snapshot_not_finalizable' using errcode = 'P0001';
  end if;

  v_receipt_id := public.apex_github_bootstrap_write_receipt(
    p_bootstrap_ref,
    p_request_id,
    'token_minted',
    p_actor,
    'succeeded',
    p_token_metadata
  );

  insert into public.apex_repo_atlas_audit(snapshot_id, action, outcome, metadata)
  values
    (p_snapshot_id, 'snapshot_created', 'succeeded', p_snapshot_audit_metadata),
    (p_snapshot_id, 'canonical_candidates_generated', 'succeeded', p_canonical_audit_metadata),
    (p_snapshot_id, 'ignition_queue_generated', 'succeeded', p_queue_audit_metadata);

  return v_receipt_id;
end;
$$;

revoke all on function public.claim_apex_repo_atlas_refresh() from public, anon, authenticated;
revoke all on function public.renew_apex_repo_atlas_refresh(uuid) from public, anon, authenticated;
revoke all on function public.release_apex_repo_atlas_refresh(uuid) from public, anon, authenticated;
revoke all on function public.finalize_apex_repo_atlas_refresh(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.claim_apex_repo_atlas_refresh() to service_role;
grant execute on function public.renew_apex_repo_atlas_refresh(uuid) to service_role;
grant execute on function public.release_apex_repo_atlas_refresh(uuid) to service_role;
grant execute on function public.finalize_apex_repo_atlas_refresh(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
