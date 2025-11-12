-- File Security & Audit Enhancements
-- Adds checksum + scan metadata to source_files and introduces audit trail for upload lifecycle events

ALTER TABLE source_files
  ADD COLUMN IF NOT EXISTS checksum_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS checksum_verified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS scan_status VARCHAR(20) NOT NULL DEFAULT 'not_scanned',
  ADD COLUMN IF NOT EXISTS scan_engine VARCHAR(100),
  ADD COLUMN IF NOT EXISTS scan_details JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scan_completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS upload_metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_source_files_checksum ON source_files(checksum_sha256);
CREATE INDEX IF NOT EXISTS idx_source_files_scan_status ON source_files(scan_status);

CREATE TABLE IF NOT EXISTS file_security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id UUID REFERENCES source_files(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  actor VARCHAR(255),
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_file_security_events_file_id
  ON file_security_events(source_file_id);

CREATE INDEX IF NOT EXISTS idx_file_security_events_type
  ON file_security_events(event_type);
