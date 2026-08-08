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

revoke all on function public.claim_apex_repo_atlas_refresh() from public, anon, authenticated;
revoke all on function public.release_apex_repo_atlas_refresh(uuid) from public, anon, authenticated;
grant execute on function public.claim_apex_repo_atlas_refresh() to service_role;
grant execute on function public.release_apex_repo_atlas_refresh(uuid) to service_role;
