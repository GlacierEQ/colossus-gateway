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
