-- Add name and dismissed_at columns to scout_batches
ALTER TABLE scout_batches ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE scout_batches ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
