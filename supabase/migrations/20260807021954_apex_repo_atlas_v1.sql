create table if not exists public.apex_repo_atlas_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  installation_id bigint not null,
  repository_count integer not null check (repository_count >= 0),
  source text not null default 'github_app_installation',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.apex_repo_atlas_repositories (
  snapshot_id uuid not null references public.apex_repo_atlas_snapshots(snapshot_id) on delete cascade,
  repository_id bigint not null,
  full_name text not null,
  name text not null,
  visibility text,
  is_private boolean not null default false,
  is_fork boolean not null default false,
  is_archived boolean not null default false,
  default_branch text,
  size_kb bigint,
  language text,
  description text,
  homepage text,
  pushed_at timestamptz,
  updated_at timestamptz,
  family text not null,
  lifecycle text not null,
  name_signature text not null,
  ignition_score integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  primary key (snapshot_id, repository_id)
);

create index if not exists apex_repo_atlas_repositories_full_name_idx on public.apex_repo_atlas_repositories(full_name);
create index if not exists apex_repo_atlas_repositories_family_idx on public.apex_repo_atlas_repositories(snapshot_id, family);
create index if not exists apex_repo_atlas_repositories_signature_idx on public.apex_repo_atlas_repositories(snapshot_id, name_signature);
create index if not exists apex_repo_atlas_repositories_ignition_idx on public.apex_repo_atlas_repositories(snapshot_id, ignition_score desc);

create table if not exists public.apex_repo_ignition_queue (
  queue_id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.apex_repo_atlas_snapshots(snapshot_id) on delete cascade,
  full_name text not null,
  priority integer not null check (priority between 1 and 1000),
  score integer not null,
  family text not null,
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'queued' check (status in ('queued','inspecting','ready','blocked','completed','superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(snapshot_id, full_name)
);

alter table public.apex_repo_atlas_snapshots enable row level security;
alter table public.apex_repo_atlas_repositories enable row level security;
alter table public.apex_repo_ignition_queue enable row level security;

revoke all on public.apex_repo_atlas_snapshots from anon, authenticated;
revoke all on public.apex_repo_atlas_repositories from anon, authenticated;
revoke all on public.apex_repo_ignition_queue from anon, authenticated;
grant all on public.apex_repo_atlas_snapshots to service_role;
grant all on public.apex_repo_atlas_repositories to service_role;
grant all on public.apex_repo_ignition_queue to service_role;
