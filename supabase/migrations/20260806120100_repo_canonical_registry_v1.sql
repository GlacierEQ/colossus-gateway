create table if not exists public.apex_repo_canonical_registry (
  registry_id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.apex_repo_atlas_snapshots(snapshot_id) on delete cascade,
  name_signature text not null,
  candidate_canonical text not null,
  members jsonb not null,
  member_count integer not null check (member_count > 1),
  status text not null default 'provisional' check (status in ('provisional','verified','superseded','quarantined')),
  confidence text not null default 'heuristic' check (confidence in ('heuristic','corroborated','verified')),
  rationale jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(snapshot_id, name_signature)
);

create table if not exists public.apex_repo_atlas_audit (
  receipt_id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references public.apex_repo_atlas_snapshots(snapshot_id) on delete set null,
  action text not null check (action in ('snapshot_created','canonical_candidates_generated','ignition_queue_generated','deep_inspection','canonical_verified','queue_status_changed')),
  outcome text not null check (outcome in ('succeeded','failed','blocked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.apex_repo_atlas_audit_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'apex_repo_atlas_audit is append-only';
end;
$$;

drop trigger if exists apex_repo_atlas_audit_append_only on public.apex_repo_atlas_audit;
create trigger apex_repo_atlas_audit_append_only
before update or delete on public.apex_repo_atlas_audit
for each row execute function public.apex_repo_atlas_audit_append_only();

alter table public.apex_repo_canonical_registry enable row level security;
alter table public.apex_repo_atlas_audit enable row level security;
revoke all on public.apex_repo_canonical_registry from anon, authenticated;
revoke all on public.apex_repo_atlas_audit from anon, authenticated;
grant all on public.apex_repo_canonical_registry to service_role;
revoke all on public.apex_repo_atlas_audit from service_role;
grant select, insert on public.apex_repo_atlas_audit to service_role;
revoke all on function public.apex_repo_atlas_audit_append_only() from public, anon, authenticated;
grant execute on function public.apex_repo_atlas_audit_append_only() to service_role;
