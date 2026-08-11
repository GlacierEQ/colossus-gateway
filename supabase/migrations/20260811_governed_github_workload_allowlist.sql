-- Governed, idempotent extension of the active GitHub App workload allowlist.
-- Requires an already verified all-repositories installation and records an
-- append-only installation verification receipt. No credential material moves.

create or replace function public.extend_apex_github_workload_allowlist(
  p_repository text,
  p_request_id text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.apex_github_bootstrap_sessions%rowtype;
  v_expected jsonb;
  v_receipt uuid;
begin
  if p_repository !~ '^GlacierEQ/[A-Za-z0-9_.-]+$' then
    raise exception 'invalid_repository' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_request_id)), 0) < 8 or length(p_request_id) > 256 then
    raise exception 'invalid_request_id' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_actor)), 0) < 1 or length(p_actor) > 256 then
    raise exception 'invalid_actor' using errcode = '22023';
  end if;

  select *
    into v_session
    from public.apex_github_bootstrap_sessions
   where status = 'completed'
   order by installed_at desc
   limit 1
   for update;

  if v_session.bootstrap_ref is null then
    raise exception 'completed_bootstrap_session_not_found' using errcode = 'P0001';
  end if;
  if coalesce(v_session.verification_detail ->> 'installation_scope', '') <> 'all' then
    raise exception 'installation_scope_not_all_repositories' using errcode = 'P0001';
  end if;
  if v_session.expected_repositories @> jsonb_build_array(trim(p_repository)) then
    return jsonb_build_object(
      'bootstrap_ref', v_session.bootstrap_ref,
      'repository', trim(p_repository),
      'status', 'already_allowed',
      'repository_count', jsonb_array_length(v_session.expected_repositories)
    );
  end if;

  select jsonb_agg(repository order by repository)
    into v_expected
    from (
      select distinct value as repository
        from jsonb_array_elements_text(
          v_session.expected_repositories || jsonb_build_array(trim(p_repository))
        )
    ) repositories;

  update public.apex_github_bootstrap_sessions
     set expected_repositories = v_expected,
         updated_at = now()
   where bootstrap_ref = v_session.bootstrap_ref;

  v_receipt := public.apex_github_bootstrap_write_receipt(
    v_session.bootstrap_ref,
    trim(p_request_id),
    'installation_verified',
    trim(p_actor),
    'succeeded',
    jsonb_build_object(
      'policy_change', 'workload_repository_allowlisted',
      'repository', trim(p_repository),
      'installation_scope', 'all',
      'repository_count', jsonb_array_length(v_expected),
      'credential_changed', false
    )
  );

  return jsonb_build_object(
    'bootstrap_ref', v_session.bootstrap_ref,
    'repository', trim(p_repository),
    'status', 'allowed',
    'repository_count', jsonb_array_length(v_expected),
    'receipt_id', v_receipt
  );
end;
$$;

revoke all on function public.extend_apex_github_workload_allowlist(text, text, text)
  from public, anon, authenticated;
grant execute on function public.extend_apex_github_workload_allowlist(text, text, text)
  to service_role;
