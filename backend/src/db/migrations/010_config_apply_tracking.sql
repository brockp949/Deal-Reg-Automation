-- Track when config snapshots are applied

ALTER TABLE config_snapshots
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS applied_notes TEXT;
