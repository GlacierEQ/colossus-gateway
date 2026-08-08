-- Forward-only runtime hardening for the Repo Atlas schema already deployed in production.

alter table public.apex_repo_atlas_snapshots
  add column if not exists seed_bootstrap_ref text;

create unique index if not exists apex_repo_atlas_snapshots_seed_bootstrap_ref_uidx
  on public.apex_repo_atlas_snapshots(seed_bootstrap_ref)
  where seed_bootstrap_ref is not null;

alter table public.apex_repo_ignition_queue
  add column if not exists status text not null default 'queued';

alter table public.apex_repo_ignition_queue
  drop constraint if exists apex_repo_ignition_queue_status_check;

alter table public.apex_repo_ignition_queue
  add constraint apex_repo_ignition_queue_status_check
  check (status in ('queued','inspecting','ready','blocked','completed','superseded','reference','quarantine'));

create index if not exists apex_repo_ignition_queue_status_idx
  on public.apex_repo_ignition_queue(status, updated_at desc);

revoke all on public.apex_repo_atlas_audit from service_role;
grant select, insert on public.apex_repo_atlas_audit to service_role;

create or replace function public.apex_repo_atlas_audit_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'apex_repo_atlas_audit is append-only';
end;
$$;

revoke all on function public.apex_repo_atlas_audit_append_only()
  from public, anon, authenticated;
grant execute on function public.apex_repo_atlas_audit_append_only()
  to service_role;
