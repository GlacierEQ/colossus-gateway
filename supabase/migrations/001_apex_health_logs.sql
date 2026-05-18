-- APEX Health Logs Table
-- Stores daily health engine output for trend analysis via MotherDuck

create table if not exists apex_health_logs (
  id uuid default gen_random_uuid() primary key,
  generated_at timestamptz not null,
  ok_count integer not null,
  total_count integer not null,
  action_items jsonb default '[]',
  full_report jsonb,
  created_at timestamptz default now()
);

-- Index for time-series queries
create index if not exists idx_apex_health_logs_generated_at
  on apex_health_logs (generated_at desc);

-- Row-level security: operator only
alter table apex_health_logs enable row level security;

comment on table apex_health_logs is
  'APEX Daily Engine health reports — all 10 platform probe results';
