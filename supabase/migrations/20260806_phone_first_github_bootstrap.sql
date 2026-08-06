-- Colossus Keymaster phone-first GitHub App bootstrap.
-- The owner handles only GitHub account consent. Generated credentials travel
-- directly from GitHub's manifest conversion response into Supabase Vault.

create table if not exists public.apex_github_bootstrap_sessions (
  bootstrap_ref text primary key,
  state_hash text not null unique,
  owner_login text not null default 'GlacierEQ',
  app_name text not null,
  status text not null default 'issued',
  expected_repositories jsonb not null,
  observed_repositories jsonb not null default '[]'::jsonb,
  app_id bigint,
  app_slug text,
  app_client_id text,
  app_private_key_ref text references public.apex_keymaster_secrets(secret_ref),
  app_client_secret_ref text references public.apex_keymaster_secrets(secret_ref),
  installation_id bigint,
  verification_detail jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default now(),
  started_at timestamptz,
  registered_at timestamptz,
  installed_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  updated_at timestamptz not null default now(),
  failure_code text,
  constraint apex_github_bootstrap_ref_format check (bootstrap_ref ~ '^kb_[0-9a-f]{32}$'),
  constraint apex_github_bootstrap_state_hash_format check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint apex_github_bootstrap_status_check check (
    status in ('issued', 'manifest_started', 'registered', 'installed', 'completed', 'failed', 'expired')
  ),
  constraint apex_github_bootstrap_expected_array check (jsonb_typeof(expected_repositories) = 'array'),
  constraint apex_github_bootstrap_observed_array check (jsonb_typeof(observed_repositories) = 'array'),
  constraint apex_github_bootstrap_verification_object check (jsonb_typeof(verification_detail) = 'object')
);

create index if not exists apex_github_bootstrap_status_expires_idx
  on public.apex_github_bootstrap_sessions(status, expires_at);

create table if not exists public.apex_github_bootstrap_audit (
  receipt_id uuid primary key default gen_random_uuid(),
  bootstrap_ref text not null references public.apex_github_bootstrap_sessions(bootstrap_ref),
  request_id text not null,
  action text not null,
  actor text not null,
  outcome text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint apex_github_bootstrap_audit_action_check check (
    action in ('issued', 'manifest_started', 'registered', 'installation_verified', 'completed', 'failed', 'token_minted')
  ),
  constraint apex_github_bootstrap_audit_outcome_check check (outcome in ('succeeded', 'failed', 'blocked')),
  constraint apex_github_bootstrap_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists apex_github_bootstrap_audit_ref_created_idx
  on public.apex_github_bootstrap_audit(bootstrap_ref, created_at desc);

alter table public.apex_github_bootstrap_sessions enable row level security;
alter table public.apex_github_bootstrap_audit enable row level security;

revoke all on table public.apex_github_bootstrap_sessions from public, anon, authenticated;
revoke all on table public.apex_github_bootstrap_audit from public, anon, authenticated;
grant select, insert, update on table public.apex_github_bootstrap_sessions to service_role;
grant select, insert on table public.apex_github_bootstrap_audit to service_role;

create or replace function public.prevent_apex_github_bootstrap_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'github_bootstrap_audit_is_append_only' using errcode = '55000';
end;
$$;

drop trigger if exists apex_github_bootstrap_audit_append_only on public.apex_github_bootstrap_audit;
create trigger apex_github_bootstrap_audit_append_only
before update or delete on public.apex_github_bootstrap_audit
for each row execute function public.prevent_apex_github_bootstrap_audit_mutation();

create or replace function public.apex_github_bootstrap_write_receipt(
  p_bootstrap_ref text,
  p_request_id text,
  p_action text,
  p_actor text,
  p_outcome text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_id uuid;
begin
  if p_bootstrap_ref !~ '^kb_[0-9a-f]{32}$' then
    raise exception 'invalid_bootstrap_ref' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_request_id)), 0) < 8 or length(p_request_id) > 256 then
    raise exception 'invalid_request_id' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_actor)), 0) < 1 or length(p_actor) > 256 then
    raise exception 'invalid_actor' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'invalid_receipt_metadata' using errcode = '22023';
  end if;

  insert into public.apex_github_bootstrap_audit(
    bootstrap_ref, request_id, action, actor, outcome, metadata
  ) values (
    p_bootstrap_ref, trim(p_request_id), p_action, trim(p_actor), p_outcome, p_metadata
  ) returning receipt_id into v_receipt_id;
  return v_receipt_id;
end;
$$;

create or replace function public.create_apex_github_bootstrap_session(
  p_state_hash text,
  p_app_name text,
  p_expected_repositories jsonb,
  p_expires_at timestamptz,
  p_request_id text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := 'kb_' || replace(gen_random_uuid()::text, '-', '');
  v_receipt uuid;
begin
  if p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_state_hash' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_app_name)), 0) < 3 or length(p_app_name) > 100 then
    raise exception 'invalid_app_name' using errcode = '22023';
  end if;
  if p_expected_repositories is null or jsonb_typeof(p_expected_repositories) <> 'array'
     or jsonb_array_length(p_expected_repositories) < 1
     or jsonb_array_length(p_expected_repositories) > 100 then
    raise exception 'invalid_expected_repositories' using errcode = '22023';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '2 hours' then
    raise exception 'invalid_expiry' using errcode = '22023';
  end if;

  insert into public.apex_github_bootstrap_sessions(
    bootstrap_ref, state_hash, app_name, expected_repositories, expires_at
  ) values (
    v_ref, lower(p_state_hash), trim(p_app_name), p_expected_repositories, p_expires_at
  );

  v_receipt := public.apex_github_bootstrap_write_receipt(
    v_ref, p_request_id, 'issued', p_actor, 'succeeded',
    jsonb_build_object(
      'app_name', trim(p_app_name),
      'repository_count', jsonb_array_length(p_expected_repositories),
      'expires_at', p_expires_at
    )
  );

  return jsonb_build_object(
    'bootstrap_ref', v_ref,
    'status', 'issued',
    'expires_at', p_expires_at,
    'receipt_id', v_receipt
  );
end;
$$;

create or replace function public.begin_apex_github_bootstrap_session(
  p_state_hash text,
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
  if v_session.expires_at <= now() then
    update public.apex_github_bootstrap_sessions
      set status = 'expired', updated_at = now(), failure_code = 'expired'
      where bootstrap_ref = v_session.bootstrap_ref;
    raise exception 'bootstrap_session_expired' using errcode = 'P0001';
  end if;
  if v_session.status not in ('issued', 'manifest_started') then
    raise exception 'bootstrap_session_not_startable' using errcode = 'P0001';
  end if;

  update public.apex_github_bootstrap_sessions
    set status = 'manifest_started',
        started_at = coalesce(started_at, now()),
        updated_at = now()
    where bootstrap_ref = v_session.bootstrap_ref;

  v_receipt := public.apex_github_bootstrap_write_receipt(
    v_session.bootstrap_ref, p_request_id, 'manifest_started', p_actor, 'succeeded',
    jsonb_build_object('expires_at', v_session.expires_at)
  );

  return jsonb_build_object(
    'bootstrap_ref', v_session.bootstrap_ref,
    'app_name', v_session.app_name,
    'owner_login', v_session.owner_login,
    'expected_repositories', v_session.expected_repositories,
    'expires_at', v_session.expires_at,
    'receipt_id', v_receipt
  );
end;
$$;

create or replace function public.register_apex_github_bootstrap_session(
  p_state_hash text,
  p_app_id bigint,
  p_app_slug text,
  p_app_client_id text,
  p_private_key_ref text,
  p_client_secret_ref text,
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
  if v_session.expires_at <= now() then
    raise exception 'bootstrap_session_expired' using errcode = 'P0001';
  end if;
  if v_session.status <> 'manifest_started' then
    raise exception 'bootstrap_session_not_registerable' using errcode = 'P0001';
  end if;
  if p_app_id is null or p_app_id <= 0 or coalesce(length(trim(p_app_slug)), 0) < 2 then
    raise exception 'invalid_github_app_metadata' using errcode = '22023';
  end if;

  update public.apex_github_bootstrap_sessions
    set status = 'registered',
        app_id = p_app_id,
        app_slug = trim(p_app_slug),
        app_client_id = nullif(trim(coalesce(p_app_client_id, '')), ''),
        app_private_key_ref = p_private_key_ref,
        app_client_secret_ref = p_client_secret_ref,
        registered_at = now(),
        updated_at = now()
    where bootstrap_ref = v_session.bootstrap_ref;

  v_receipt := public.apex_github_bootstrap_write_receipt(
    v_session.bootstrap_ref, p_request_id, 'registered', p_actor, 'succeeded',
    jsonb_build_object('app_id', p_app_id, 'app_slug', trim(p_app_slug))
  );

  return jsonb_build_object(
    'bootstrap_ref', v_session.bootstrap_ref,
    'status', 'registered',
    'app_id', p_app_id,
    'app_slug', trim(p_app_slug),
    'receipt_id', v_receipt
  );
end;
$$;

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

create or replace function public.fail_apex_github_bootstrap_session(
  p_state_hash text,
  p_failure_code text,
  p_request_id text,
  p_actor text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
  v_receipt uuid;
begin
  select bootstrap_ref into v_ref
  from public.apex_github_bootstrap_sessions
  where state_hash = lower(p_state_hash)
  for update;

  if v_ref is null then
    raise exception 'bootstrap_session_not_found' using errcode = 'P0001';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'invalid_failure_metadata' using errcode = '22023';
  end if;

  update public.apex_github_bootstrap_sessions
    set status = 'failed', failure_code = left(trim(p_failure_code), 256), updated_at = now()
    where bootstrap_ref = v_ref;

  v_receipt := public.apex_github_bootstrap_write_receipt(
    v_ref, p_request_id, 'failed', p_actor, 'failed', p_metadata ||
      jsonb_build_object('failure_code', left(trim(p_failure_code), 256))
  );

  return jsonb_build_object('bootstrap_ref', v_ref, 'status', 'failed', 'receipt_id', v_receipt);
end;
$$;

revoke all on function public.apex_github_bootstrap_write_receipt(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_apex_github_bootstrap_session(text, text, jsonb, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.begin_apex_github_bootstrap_session(text, text, text) from public, anon, authenticated;
revoke all on function public.register_apex_github_bootstrap_session(text, bigint, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_apex_github_bootstrap_session(text, bigint, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.fail_apex_github_bootstrap_session(text, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.apex_github_bootstrap_write_receipt(text, text, text, text, text, jsonb) to service_role;
grant execute on function public.create_apex_github_bootstrap_session(text, text, jsonb, timestamptz, text, text) to service_role;
grant execute on function public.begin_apex_github_bootstrap_session(text, text, text) to service_role;
grant execute on function public.register_apex_github_bootstrap_session(text, bigint, text, text, text, text, text, text) to service_role;
grant execute on function public.complete_apex_github_bootstrap_session(text, bigint, jsonb, jsonb, text, text) to service_role;
grant execute on function public.fail_apex_github_bootstrap_session(text, text, text, text, jsonb) to service_role;
