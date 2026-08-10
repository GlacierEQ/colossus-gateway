create table if not exists public.apex_repo_atlas_repository_enrichment (
  snapshot_id uuid not null,
  repository_id bigint not null,
  default_branch text,
  default_head_sha text,
  parent_repository_id bigint,
  parent_full_name text,
  source_repository_id bigint,
  source_full_name text,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (snapshot_id, repository_id),
  constraint apex_repo_atlas_repository_enrichment_repo_fk
    foreign key (snapshot_id, repository_id)
    references public.apex_repo_atlas_repositories(snapshot_id, repository_id)
    on delete cascade,
  constraint apex_repo_atlas_repository_enrichment_head_sha_check
    check (default_head_sha is null or default_head_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  constraint apex_repo_atlas_repository_enrichment_parent_pair_check
    check (
      (parent_repository_id is null and parent_full_name is null)
      or (parent_repository_id is not null and parent_full_name is not null)
    ),
  constraint apex_repo_atlas_repository_enrichment_source_pair_check
    check (
      (source_repository_id is null and source_full_name is null)
      or (source_repository_id is not null and source_full_name is not null)
    )
);

create index if not exists apex_repo_atlas_repository_enrichment_parent_idx
  on public.apex_repo_atlas_repository_enrichment(snapshot_id, parent_repository_id)
  where parent_repository_id is not null;

create index if not exists apex_repo_atlas_repository_enrichment_source_idx
  on public.apex_repo_atlas_repository_enrichment(snapshot_id, source_repository_id)
  where source_repository_id is not null;

create table if not exists public.apex_repo_atlas_enrichment_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null unique
    references public.apex_repo_atlas_snapshots(snapshot_id) on delete cascade,
  repository_count integer not null check (repository_count >= 0),
  enriched_count integer not null check (enriched_count >= 0),
  default_head_count integer not null check (default_head_count >= 0),
  fork_lineage_count integer not null check (fork_lineage_count >= 0),
  enrichment_root_sha256 text not null
    check (enrichment_root_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint apex_repo_atlas_enrichment_receipts_count_check
    check (
      enriched_count <= repository_count
      and default_head_count <= enriched_count
      and fork_lineage_count <= enriched_count
    )
);

alter table public.apex_repo_atlas_repository_enrichment enable row level security;
alter table public.apex_repo_atlas_enrichment_receipts enable row level security;

revoke all on public.apex_repo_atlas_repository_enrichment from anon, authenticated;
revoke all on public.apex_repo_atlas_enrichment_receipts from anon, authenticated;
grant all on public.apex_repo_atlas_repository_enrichment to service_role;
grant all on public.apex_repo_atlas_enrichment_receipts to service_role;

comment on table public.apex_repo_atlas_repository_enrichment is
  'Immutable, snapshot-keyed head-SHA and fork-lineage projection for finalized Repo Atlas inventories.';
comment on table public.apex_repo_atlas_enrichment_receipts is
  'Integrity receipt for one complete Repo Atlas enrichment projection; base inventory snapshots remain immutable.';
