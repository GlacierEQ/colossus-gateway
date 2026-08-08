-- Serialize long-running GitHub bootstrap verification without holding a database lock
-- across external network calls. The lease is bounded, releasable on failure, and
-- required by the claimed completion path.

alter table public.apex_github_bootstrap_sessions
  add column if not exists verification_claim_id uuid,
  add column if not exists verification_claim_expires_at timestamptz;

create index if not exists apex_github_bootstrap_verification_claim_idx
  on public.apex_github_bootstrap_sessions(status, verification_claim_expires_at)
  where verification_claim_id is not null;

create or replace function public.claim_apex_github_bootstrap_verification(
  p_state_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id uuid := gen_random_uuid();
  v_session public.apex_github_bootstrap_sessions%rowtype;
begin
  if p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_state_hash' using errcode = '22023';
  end if;

  update public.apex_github_bootstrap_sessions
  set verification_claim_id = v_claim_id,
      verification_claim_expires_at = least(expires_at, now() + interval '10 minutes'),
      updated_at = now()
  where state_hash = lower(p_state_hash)
    and status = 'registered'
    and expires_at > now()
    and (
      verification_claim_id is null
      or verification_claim_expires_at is null
      or verification_claim_expires_at <= now()
    )
  returning * into v_session;

  if v_session.bootstrap_ref is null then
    select * into v_session
    from public.apex_github_bootstrap_sessions
    where state_hash = lower(p_state_hash);

    if v_session.bootstrap_ref is null then
      raise exception 'bootstrap_session_not_found' using errcode = 'P0001';
    end if;
    if v_session.expires_at <= now() then
      raise exception 'bootstrap_session_expired' using errcode = 'P0001';
    end if;
    if v_session.status <> 'registered' then
      raise exception 'bootstrap_session_not_claimable:%', v_session.status using errcode = 'P0001';
    end if;
    raise exception 'bootstrap_verification_in_progress' using errcode = '55P03';
  end if;

  return jsonb_build_object(
    'bootstrap_ref', v_session.bootstrap_ref,
    'claim_id', v_claim_id,
    'claim_expires_at', v_session.verification_claim_expires_at
  );
end;
$$;

create or replace function public.release_apex_github_bootstrap_verification(
  p_state_hash text,
  p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released integer;
begin
  update public.apex_github_bootstrap_sessions
  set verification_claim_id = null,
      verification_claim_expires_at = null,
      updated_at = now()
  where state_hash = lower(p_state_hash)
    and status = 'registered'
    and verification_claim_id = p_claim_id;

  get diagnostics v_released = row_count;
  return v_released = 1;
end;
$$;

-- Preserve the legacy completion signature, but do not let an unclaimed caller
-- complete a session while a live verification lease belongs to another flow.
create or replace function public.complete_apex_github_bootstrap_session(
  p_state_hash text,
  p_installation_id bigint,
  p_observed_repositories jsonb,
  p_verification_detail jsonb,
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
  v_receipt uuid;
begin
  select * into v_session
  from public.apex_github_bootstrap_sessions
  where state_hash = lower(p_state_hash)
  for update;

  if v_session.bootstrap_ref is null then
    raise exception 'bootstrap_session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'registered' then
    raise exception 'bootstrap_session_not_completable' using errcode = 'P0001';
  end if;
  if v_session.verification_claim_id is not null
     and v_session.verification_claim_expires_at > now() then
    raise exception 'bootstrap_verification_claim_required' using errcode = '55P03';
  end if;
  if p_observed_repositories is null or jsonb_typeof(p_observed_repositories) <> 'array' then
    raise exception 'invalid_observed_repositories' using errcode = '22023';
  end if;
  if p_verification_detail is null or jsonb_typeof(p_verification_detail) <> 'object' then
    raise exception 'invalid_verification_detail' using errcode = '22023';
  end if;

  update public.apex_github_bootstrap_sessions
    set status = 'completed',
        installation_id = p_installation_id,
        observed_repositories = p_observed_repositories,
        verification_detail = p_verification_detail,
        installed_at = now(),
        consumed_at = now(),
        verification_claim_id = null,
        verification_claim_expires_at = null,
        updated_at = now()
    where bootstrap_ref = v_session.bootstrap_ref;

  v_receipt := public.apex_github_bootstrap_write_receipt(
    v_session.bootstrap_ref, p_request_id, 'completed', p_actor, 'succeeded',
    jsonb_build_object(
      'installation_id', p_installation_id,
      'repository_count', jsonb_array_length(p_observed_repositories),
      'verification_detail', p_verification_detail
    )
  );

  return jsonb_build_object(
    'bootstrap_ref', v_session.bootstrap_ref,
    'status', 'completed',
    'installation_id', p_installation_id,
    'observed_repositories', p_observed_repositories,
    'receipt_id', v_receipt
  );
end;
$$;

create or replace function public.complete_claimed_apex_github_bootstrap_session(
  p_state_hash text,
  p_claim_id uuid,
  p_installation_id bigint,
  p_observed_repositories jsonb,
  p_verification_detail jsonb,
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
  v_receipt uuid;
begin
  select * into v_session
  from public.apex_github_bootstrap_sessions
  where state_hash = lower(p_state_hash)
  for update;

  if v_session.bootstrap_ref is null then
    raise exception 'bootstrap_session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'registered' then
    raise exception 'bootstrap_session_not_completable' using errcode = 'P0001';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'bootstrap_session_expired' using errcode = 'P0001';
  end if;
  if v_session.verification_claim_id is distinct from p_claim_id
     or v_session.verification_claim_expires_at is null
     or v_session.verification_claim_expires_at <= now() then
    raise exception 'bootstrap_verification_claim_invalid' using errcode = '55P03';
  end if;
  if p_observed_repositories is null or jsonb_typeof(p_observed_repositories) <> 'array' then
    raise exception 'invalid_observed_repositories' using errcode = '22023';
  end if;
  if p_verification_detail is null or jsonb_typeof(p_verification_detail) <> 'object' then
    raise exception 'invalid_verification_detail' using errcode = '22023';
  end if;

  update public.apex_github_bootstrap_sessions
    set status = 'completed',
        installation_id = p_installation_id,
        observed_repositories = p_observed_repositories,
        verification_detail = p_verification_detail,
        installed_at = now(),
        consumed_at = now(),
        verification_claim_id = null,
        verification_claim_expires_at = null,
        updated_at = now()
    where bootstrap_ref = v_session.bootstrap_ref;

  v_receipt := public.apex_github_bootstrap_write_receipt(
    v_session.bootstrap_ref, p_request_id, 'completed', p_actor, 'succeeded',
    jsonb_build_object(
      'installation_id', p_installation_id,
      'repository_count', jsonb_array_length(p_observed_repositories),
      'verification_detail', p_verification_detail,
      'verification_claim_id', p_claim_id
    )
  );

  return jsonb_build_object(
    'bootstrap_ref', v_session.bootstrap_ref,
    'status', 'completed',
    'installation_id', p_installation_id,
    'observed_repositories', p_observed_repositories,
    'receipt_id', v_receipt
  );
end;
$$;

revoke all on function public.claim_apex_github_bootstrap_verification(text) from public, anon, authenticated;
revoke all on function public.release_apex_github_bootstrap_verification(text, uuid) from public, anon, authenticated;
revoke all on function public.complete_claimed_apex_github_bootstrap_session(text, uuid, bigint, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.claim_apex_github_bootstrap_verification(text) to service_role;
grant execute on function public.release_apex_github_bootstrap_verification(text, uuid) to service_role;
grant execute on function public.complete_claimed_apex_github_bootstrap_session(text, uuid, bigint, jsonb, jsonb, text, text) to service_role;
