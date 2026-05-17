-- COLOSSUS GATEWAY v2.1 — Supabase Migration
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Project: kjebemdgvjvuutzvhbtp

-- Main event log table (Aspen Grove persistence layer)
CREATE TABLE IF NOT EXISTS apex_integration_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     TEXT NOT NULL DEFAULT '1FDV-23-0001009',
  event_type  TEXT NOT NULL,
  title       TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast APEX queries
CREATE INDEX IF NOT EXISTS idx_apex_events_case_id    ON apex_integration_events (case_id);
CREATE INDEX IF NOT EXISTS idx_apex_events_event_type ON apex_integration_events (event_type);
CREATE INDEX IF NOT EXISTS idx_apex_events_created_at ON apex_integration_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apex_events_metadata   ON apex_integration_events USING gin (metadata);

-- Enable Row Level Security
ALTER TABLE apex_integration_events ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by Colossus Gateway)
CREATE POLICY "service_role_all" ON apex_integration_events
  FOR ALL USING (true) WITH CHECK (true);

-- SMB sync log table (referenced by MotherDuck threshold watcher)
CREATE TABLE IF NOT EXISTS smb_sync_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    TEXT NOT NULL DEFAULT '1FDV-23-0001009',
  source     TEXT NOT NULL,  -- 'jims-webcrawler' | 'gmail-court-comms'
  doc_count  INTEGER NOT NULL DEFAULT 1,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata   JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_smb_sync_synced_at ON smb_sync_log (synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_smb_sync_source    ON smb_sync_log (source);

ALTER TABLE smb_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON smb_sync_log
  FOR ALL USING (true) WITH CHECK (true);
