-- Config snapshot storage for JSON uploads

CREATE TABLE IF NOT EXISTS config_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id UUID REFERENCES source_files(id) ON DELETE CASCADE,
  config_name VARCHAR(255) NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  applied_by VARCHAR(255),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_config_snapshots_name
  ON config_snapshots(config_name);

CREATE INDEX IF NOT EXISTS idx_config_snapshots_source
  ON config_snapshots(source_file_id);
