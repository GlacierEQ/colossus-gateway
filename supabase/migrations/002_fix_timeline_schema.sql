-- Migration: Fix schema mismatch in apex_case_timeline
-- Add 'agent' column to track which agent created the event
-- Date: 2026-05-16

-- Ensure the table exists (it should, as per documentation)
CREATE TABLE IF NOT EXISTS apex_case_timeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add 'agent' column if it's missing (in case the table already exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='apex_case_timeline' AND column_name='agent') THEN
        ALTER TABLE apex_case_timeline ADD COLUMN agent TEXT;
    END IF;
END $$;

-- Also update apex_integration_events for consistency
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='apex_integration_events') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='apex_integration_events' AND column_name='agent') THEN
            ALTER TABLE apex_integration_events ADD COLUMN agent TEXT;
        END IF;
    END IF;
END $$;
