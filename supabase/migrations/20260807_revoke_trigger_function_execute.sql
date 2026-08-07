-- Harden trigger-only SECURITY DEFINER functions against direct RPC execution.
-- Trigger execution is unaffected by revoking role EXECUTE privileges.

revoke all on function public.prevent_apex_github_bootstrap_audit_mutation()
  from public, anon, authenticated;

grant execute on function public.prevent_apex_github_bootstrap_audit_mutation()
  to service_role;
