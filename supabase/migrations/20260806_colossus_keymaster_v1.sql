-- Colossus Keymaster v1
-- Generic secret metadata, Vault-backed storage, service-role-only resolution,
-- and append-only receipts. Raw secret values never enter public tables.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.apex_keymaster_secrets (
  secret_ref text primary key,
  vault_secret_id uuid not null unique,
  provider text not null,
  account_label text not null default 'default',
  purpose text not null,
  scope jsonb not null default '[]'::jsonb,
  fingerprint_sha256 text not null,
  verification_status text not null default 'unverified',
  verification_detail jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  version integer not null default 1,
  rotation_due_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint apex_keymaster_secret_ref_format check (secret_ref ~ '^km_[0-9a-f]{32}$'),
  constraint apex_keymaster_provider_format check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  constraint apex_keymaster_fingerprint_format check (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  constraint apex_keymaster_status_check check (status in ('active', 'revoked')),
  constraint apex_keymaster_verification_check check (verification_status in ('unverified', 'verified', 'failed', 'expired', 'revoked')),
  constraint apex_keymaster_version_positive check (version > 0)
);

create index if not exists apex_keymaster_provider_status_idx
  on public.apex_keymaster_secrets(provider, status);

create table if not exists public.apex_keymaster_audit (
  receipt_id uuid primary key default gen_random_uuid(),
  request_id text not null,
  secret_ref text,
  action text not null,
  actor text not null,
  provider text,
  operation text,
  outcome text not null,
  fingerprint_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint apex_keymaster_audit_action_check check (action in ('inserted', 'replaced', 'resolved', 'used', 'verified', 'revoked')),
  constraint apex_keymaster_audit_outcome_check check (outcome in ('succeeded', 'failed', 'blocked')),
  constraint apex_keymaster_audit_fingerprint_format check (fingerprint_sha256 is null or fingerprint_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists apex_keymaster_audit_ref_created_idx
  on public.apex_keymaster_audit(secret_ref, created_at desc);
create index if not exists apex_keymaster_audit_request_idx
  on public.apex_keymaster_audit(request_id);

alter table public.apex_keymaster_secrets enable row level security;
alter table public.apex_keymaster_audit enable row level security;

revoke all on table public.apex_keymaster_secrets from public, anon, authenticated;
revoke all on table public.apex_keymaster_audit from public, anon, authenticated;
grant select, insert, update, delete on table public.apex_keymaster_secrets to service_role;
grant select, insert on table public.apex_keymaster_audit to service_role;

create or replace function public.prevent_apex_keymaster_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'keymaster_audit_is_append_only' using errcode = '55000';
end;
$$;

drop trigger if exists apex_keymaster_audit_append_only on public.apex_keymaster_audit;
create trigger apex_keymaster_audit_append_only
before update or delete on public.apex_keymaster_audit
for each row execute function public.prevent_apex_keymaster_audit_mutation();

create or replace function public.apex_keymaster_write_receipt(
  p_request_id text,
  p_secret_ref text,
  p_action text,
  p_actor text,
  p_provider text,
  p_operation text,
  p_outcome text,
  p_fingerprint_sha256 text,
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
  if coalesce(length(trim(p_request_id)), 0) < 8 or length(p_request_id) > 256 then
    raise exception 'invalid_request_id' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_actor)), 0) < 1 or length(p_actor) > 256 then
    raise exception 'invalid_actor' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'invalid_receipt_metadata' using errcode = '22023';
  end if;

  insert into public.apex_keymaster_audit(
    request_id, secret_ref, action, actor, provider, operation,
    outcome, fingerprint_sha256, metadata
  ) values (
    trim(p_request_id), p_secret_ref, p_action, trim(p_actor), p_provider,
    nullif(trim(coalesce(p_operation, '')), ''), p_outcome,
    p_fingerprint_sha256, p_metadata
  ) returning receipt_id into v_receipt_id;

  return v_receipt_id;
end;
$$;

create or replace function public.store_apex_keymaster_secret(
  p_provider text,
  p_account_label text,
  p_purpose text,
  p_scope jsonb,
  p_secret text,
  p_rotation_due_at timestamptz,
  p_request_id text,
  p_actor text,
  p_verification_status text default 'unverified',
  p_verification_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_provider text := lower(trim(p_provider));
  v_account text := trim(coalesce(p_account_label, 'default'));
  v_purpose text := trim(p_purpose);
  v_ref text := 'km_' || replace(gen_random_uuid()::text, '-', '');
  v_name text;
  v_fingerprint text;
  v_vault_id uuid;
  v_receipt uuid;
begin
  if v_provider !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;
  if length(v_account) < 1 or length(v_account) > 256 then
    raise exception 'invalid_account_label' using errcode = '22023';
  end if;
  if length(v_purpose) < 1 or length(v_purpose) > 256 then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;
  if p_scope is null or jsonb_typeof(p_scope) not in ('array', 'object') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;
  if p_secret is null or octet_length(p_secret) < 1 or octet_length(p_secret) > 65536 then
    raise exception 'invalid_secret_size' using errcode = '22023';
  end if;
  if p_verification_status not in ('unverified', 'verified', 'failed', 'expired') then
    raise exception 'invalid_verification_status' using errcode = '22023';
  end if;
  if p_verification_detail is null or jsonb_typeof(p_verification_detail) <> 'object' then
    raise exception 'invalid_verification_detail' using errcode = '22023';
  end if;

  v_fingerprint := encode(digest(p_secret, 'sha256'), 'hex');
  v_name := 'colossus_keymaster__' || v_ref;
  v_vault_id := vault.create_secret(
    p_secret,
    v_name,
    format('Colossus Keymaster %s / %s / %s', v_provider, v_account, v_purpose)
  );

  insert into public.apex_keymaster_secrets(
    secret_ref, vault_secret_id, provider, account_label, purpose, scope,
    fingerprint_sha256, verification_status, verification_detail,
    rotation_due_at, last_verified_at
  ) values (
    v_ref, v_vault_id, v_provider, v_account, v_purpose, p_scope,
    v_fingerprint, p_verification_status, p_verification_detail,
    p_rotation_due_at,
    case when p_verification_status = 'verified' then now() else null end
  );

  v_receipt := public.apex_keymaster_write_receipt(
    p_request_id, v_ref, 'inserted', p_actor, v_provider, 'connect',
    'succeeded', v_fingerprint,
    jsonb_build_object(
      'account_label', v_account,
      'purpose', v_purpose,
      'scope', p_scope,
      'verification_status', p_verification_status,
      'rotation_due_at', p_rotation_due_at,
      'version', 1
    )
  );

  return jsonb_build_object(
    'stored', true,
    'secret_ref', v_ref,
    'provider', v_provider,
    'account_label', v_account,
    'purpose', v_purpose,
    'scope', p_scope,
    'fingerprint_sha256', v_fingerprint,
    'verification_status', p_verification_status,
    'rotation_due_at', p_rotation_due_at,
    'version', 1,
    'receipt_id', v_receipt
  );
exception when others then
  if v_vault_id is not null then
    delete from vault.secrets where id = v_vault_id;
  end if;
  raise;
end;
$$;

create or replace function public.replace_apex_keymaster_secret(
  p_secret_ref text,
  p_secret text,
  p_rotation_due_at timestamptz,
  p_request_id text,
  p_actor text,
  p_verification_status text default 'unverified',
  p_verification_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_row public.apex_keymaster_secrets%rowtype;
  v_fingerprint text;
  v_receipt uuid;
begin
  select * into v_row
  from public.apex_keymaster_secrets
  where secret_ref = p_secret_ref
  for update;

  if not found then
    raise exception 'secret_ref_not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'active' then
    raise exception 'secret_ref_revoked' using errcode = '55000';
  end if;
  if p_secret is null or octet_length(p_secret) < 1 or octet_length(p_secret) > 65536 then
    raise exception 'invalid_secret_size' using errcode = '22023';
  end if;
  if p_verification_status not in ('unverified', 'verified', 'failed', 'expired') then
    raise exception 'invalid_verification_status' using errcode = '22023';
  end if;
  if p_verification_detail is null or jsonb_typeof(p_verification_detail) <> 'object' then
    raise exception 'invalid_verification_detail' using errcode = '22023';
  end if;

  v_fingerprint := encode(digest(p_secret, 'sha256'), 'hex');
  perform vault.update_secret(
    v_row.vault_secret_id,
    p_secret,
    'colossus_keymaster__' || v_row.secret_ref,
    format('Colossus Keymaster %s / %s / %s', v_row.provider, v_row.account_label, v_row.purpose)
  );

  update public.apex_keymaster_secrets
  set fingerprint_sha256 = v_fingerprint,
      verification_status = p_verification_status,
      verification_detail = p_verification_detail,
      rotation_due_at = p_rotation_due_at,
      last_verified_at = case when p_verification_status = 'verified' then now() else null end,
      version = version + 1,
      updated_at = now()
  where secret_ref = p_secret_ref
  returning * into v_row;

  v_receipt := public.apex_keymaster_write_receipt(
    p_request_id, v_row.secret_ref, 'replaced', p_actor, v_row.provider,
    'replace', 'succeeded', v_fingerprint,
    jsonb_build_object(
      'account_label', v_row.account_label,
      'purpose', v_row.purpose,
      'verification_status', p_verification_status,
      'rotation_due_at', p_rotation_due_at,
      'version', v_row.version
    )
  );

  return jsonb_build_object(
    'replaced', true,
    'secret_ref', v_row.secret_ref,
    'provider', v_row.provider,
    'fingerprint_sha256', v_fingerprint,
    'verification_status', p_verification_status,
    'rotation_due_at', p_rotation_due_at,
    'version', v_row.version,
    'receipt_id', v_receipt
  );
end;
$$;

create or replace function public.revoke_apex_keymaster_secret(
  p_secret_ref text,
  p_request_id text,
  p_actor text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_row public.apex_keymaster_secrets%rowtype;
  v_receipt uuid;
begin
  select * into v_row
  from public.apex_keymaster_secrets
  where secret_ref = p_secret_ref
  for update;

  if not found then
    raise exception 'secret_ref_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'revoked' then
    return jsonb_build_object(
      'revoked', true,
      'already_revoked', true,
      'secret_ref', v_row.secret_ref
    );
  end if;

  delete from vault.secrets where id = v_row.vault_secret_id;

  update public.apex_keymaster_secrets
  set status = 'revoked',
      verification_status = 'revoked',
      verification_detail = jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), '')),
      revoked_at = now(),
      updated_at = now()
  where secret_ref = p_secret_ref
  returning * into v_row;

  v_receipt := public.apex_keymaster_write_receipt(
    p_request_id, v_row.secret_ref, 'revoked', p_actor, v_row.provider,
    'revoke', 'succeeded', v_row.fingerprint_sha256,
    jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), ''), 'version', v_row.version)
  );

  return jsonb_build_object(
    'revoked', true,
    'secret_ref', v_row.secret_ref,
    'provider', v_row.provider,
    'receipt_id', v_receipt
  );
end;
$$;

create or replace function public.verify_apex_keymaster_secret(
  p_secret_ref text,
  p_verification_status text,
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
  v_row public.apex_keymaster_secrets%rowtype;
  v_receipt uuid;
begin
  if p_verification_status not in ('verified', 'failed', 'expired') then
    raise exception 'invalid_verification_status' using errcode = '22023';
  end if;
  if p_verification_detail is null or jsonb_typeof(p_verification_detail) <> 'object' then
    raise exception 'invalid_verification_detail' using errcode = '22023';
  end if;

  update public.apex_keymaster_secrets
  set verification_status = p_verification_status,
      verification_detail = p_verification_detail,
      last_verified_at = now(),
      updated_at = now()
  where secret_ref = p_secret_ref and status = 'active'
  returning * into v_row;

  if not found then
    raise exception 'active_secret_ref_not_found' using errcode = 'P0002';
  end if;

  v_receipt := public.apex_keymaster_write_receipt(
    p_request_id, v_row.secret_ref, 'verified', p_actor, v_row.provider,
    'verify', 'succeeded', v_row.fingerprint_sha256,
    jsonb_build_object('verification_status', p_verification_status, 'verification_detail', p_verification_detail)
  );

  return jsonb_build_object(
    'verified', p_verification_status = 'verified',
    'secret_ref', v_row.secret_ref,
    'verification_status', p_verification_status,
    'last_verified_at', v_row.last_verified_at,
    'receipt_id', v_receipt
  );
end;
$$;

create or replace function public.apex_keymaster_inventory()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'secret_ref', secret_ref,
      'provider', provider,
      'account_label', account_label,
      'purpose', purpose,
      'scope', scope,
      'fingerprint_sha256', fingerprint_sha256,
      'verification_status', verification_status,
      'verification_detail', verification_detail,
      'status', status,
      'version', version,
      'rotation_due_at', rotation_due_at,
      'last_verified_at', last_verified_at,
      'created_at', created_at,
      'updated_at', updated_at,
      'revoked_at', revoked_at
    ) order by provider, account_label, purpose, created_at
  ), '[]'::jsonb)
  from public.apex_keymaster_secrets;
$$;

create or replace function public.resolve_apex_keymaster_secret_for_broker(
  p_secret_ref text,
  p_provider text,
  p_request_id text,
  p_actor text,
  p_operation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_row public.apex_keymaster_secrets%rowtype;
  v_secret text;
  v_receipt uuid;
begin
  select * into v_row
  from public.apex_keymaster_secrets
  where secret_ref = p_secret_ref and status = 'active';

  if not found then
    raise exception 'active_secret_ref_not_found' using errcode = 'P0002';
  end if;
  if lower(trim(p_provider)) <> v_row.provider then
    raise exception 'provider_mismatch' using errcode = '28000';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id = v_row.vault_secret_id
  limit 1;

  if v_secret is null then
    raise exception 'vault_secret_unavailable' using errcode = 'P0002';
  end if;

  v_receipt := public.apex_keymaster_write_receipt(
    p_request_id, v_row.secret_ref, 'resolved', p_actor, v_row.provider,
    p_operation, 'succeeded', v_row.fingerprint_sha256,
    jsonb_build_object('version', v_row.version, 'purpose', v_row.purpose)
  );

  return jsonb_build_object(
    'secret_ref', v_row.secret_ref,
    'provider', v_row.provider,
    'account_label', v_row.account_label,
    'purpose', v_row.purpose,
    'scope', v_row.scope,
    'version', v_row.version,
    'secret', v_secret,
    'resolve_receipt_id', v_receipt
  );
end;
$$;

create or replace function public.record_apex_keymaster_use(
  p_secret_ref text,
  p_request_id text,
  p_actor text,
  p_operation text,
  p_outcome text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.apex_keymaster_secrets%rowtype;
  v_receipt uuid;
begin
  select * into v_row
  from public.apex_keymaster_secrets
  where secret_ref = p_secret_ref;

  if not found then
    raise exception 'secret_ref_not_found' using errcode = 'P0002';
  end if;
  if p_outcome not in ('succeeded', 'failed', 'blocked') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'invalid_use_metadata' using errcode = '22023';
  end if;

  v_receipt := public.apex_keymaster_write_receipt(
    p_request_id, v_row.secret_ref, 'used', p_actor, v_row.provider,
    p_operation, p_outcome, v_row.fingerprint_sha256, p_metadata
  );

  return jsonb_build_object(
    'recorded', true,
    'secret_ref', v_row.secret_ref,
    'receipt_id', v_receipt
  );
end;
$$;

-- Migrate the already-connected Notion token into the generic metadata registry
-- without copying plaintext outside Vault.
do $$
declare
  v_existing vault.decrypted_secrets%rowtype;
  v_ref text;
begin
  select * into v_existing
  from vault.decrypted_secrets
  where name = 'apex_notion_token'
  limit 1;

  if found and not exists (
    select 1 from public.apex_keymaster_secrets
    where provider = 'notion' and purpose = 'api_token' and status = 'active'
  ) then
    v_ref := 'km_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.apex_keymaster_secrets(
      secret_ref, vault_secret_id, provider, account_label, purpose, scope,
      fingerprint_sha256, verification_status, verification_detail,
      last_verified_at
    ) values (
      v_ref, v_existing.id, 'notion', 'default', 'api_token',
      '["search","read","write-as-configured"]'::jsonb,
      encode(digest(v_existing.decrypted_secret, 'sha256'), 'hex'),
      'verified', jsonb_build_object('source', 'legacy_apex_notion_token'), now()
    );
    perform public.apex_keymaster_write_receipt(
      'migration-20260806-notion', v_ref, 'inserted', 'colossus-migration',
      'notion', 'migrate_existing_vault_secret', 'succeeded',
      encode(digest(v_existing.decrypted_secret, 'sha256'), 'hex'),
      jsonb_build_object('source', 'legacy_apex_notion_token', 'copied_plaintext', false)
    );
  end if;
end;
$$;

revoke all on function public.prevent_apex_keymaster_audit_mutation() from public, anon, authenticated;
revoke all on function public.apex_keymaster_write_receipt(text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.store_apex_keymaster_secret(text,text,text,jsonb,text,timestamptz,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.replace_apex_keymaster_secret(text,text,timestamptz,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.revoke_apex_keymaster_secret(text,text,text,text) from public, anon, authenticated;
revoke all on function public.verify_apex_keymaster_secret(text,text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.apex_keymaster_inventory() from public, anon, authenticated;
revoke all on function public.resolve_apex_keymaster_secret_for_broker(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.record_apex_keymaster_use(text,text,text,text,text,jsonb) from public, anon, authenticated;

grant execute on function public.apex_keymaster_write_receipt(text,text,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.store_apex_keymaster_secret(text,text,text,jsonb,text,timestamptz,text,text,text,jsonb) to service_role;
grant execute on function public.replace_apex_keymaster_secret(text,text,timestamptz,text,text,text,jsonb) to service_role;
grant execute on function public.revoke_apex_keymaster_secret(text,text,text,text) to service_role;
grant execute on function public.verify_apex_keymaster_secret(text,text,jsonb,text,text) to service_role;
grant execute on function public.apex_keymaster_inventory() to service_role;
grant execute on function public.resolve_apex_keymaster_secret_for_broker(text,text,text,text,text) to service_role;
grant execute on function public.record_apex_keymaster_use(text,text,text,text,text,jsonb) to service_role;
