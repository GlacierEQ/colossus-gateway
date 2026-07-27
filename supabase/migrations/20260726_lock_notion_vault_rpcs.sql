-- Colossus Notion Vault RPCs are internal broker primitives.
-- Public callers must traverse the OIDC-verified Edge Function instead.

revoke all on function public.store_apex_notion_token(text, text) from public;
revoke all on function public.store_apex_notion_token(text, text) from anon;
revoke all on function public.store_apex_notion_token(text, text) from authenticated;
grant execute on function public.store_apex_notion_token(text, text) to service_role;

revoke all on function public.get_apex_notion_token() from public;
revoke all on function public.get_apex_notion_token() from anon;
revoke all on function public.get_apex_notion_token() from authenticated;
grant execute on function public.get_apex_notion_token() to service_role;

revoke all on function public.apex_notion_connection_status() from public;
revoke all on function public.apex_notion_connection_status() from anon;
revoke all on function public.apex_notion_connection_status() from authenticated;
grant execute on function public.apex_notion_connection_status() to service_role;
