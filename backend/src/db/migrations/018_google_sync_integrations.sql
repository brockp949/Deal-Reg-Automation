-- Migration: Add Google OAuth and Sync Integration tables
-- Supports Gmail and Google Drive as alternative input sources for deal extraction

-- Create google_oauth_tokens table for storing encrypted OAuth tokens
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,              -- Operator/user identifier
  account_email VARCHAR(255) NOT NULL,        -- Google account email
  access_token TEXT NOT NULL,                 -- Encrypted access token
  refresh_token TEXT NOT NULL,                -- Encrypted refresh token
  token_expiry TIMESTAMP WITH TIME ZONE NOT NULL,
  scopes TEXT[] NOT NULL,                     -- Array of granted scopes
  service_type VARCHAR(20) NOT NULL CHECK (service_type IN ('gmail', 'drive')),

  -- Audit fields
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP WITH TIME ZONE,        -- NULL if active

  UNIQUE(user_id, account_email, service_type)
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_tokens_user ON google_oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_google_oauth_tokens_service ON google_oauth_tokens(service_type);
CREATE INDEX IF NOT EXISTS idx_google_oauth_tokens_active ON google_oauth_tokens(user_id) WHERE revoked_at IS NULL;

-- Create sync_configurations table for storing sync settings
CREATE TABLE IF NOT EXISTS sync_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_id UUID NOT NULL REFERENCES google_oauth_tokens(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,                 -- User-friendly name
  service_type VARCHAR(20) NOT NULL CHECK (service_type IN ('gmail', 'drive')),
  enabled BOOLEAN DEFAULT true,

  -- Gmail-specific configuration
  gmail_label_ids TEXT[],                     -- Selected label IDs to sync
  gmail_query TEXT,                           -- Additional Gmail search query
  gmail_date_from DATE,                       -- Date range start
  gmail_date_to DATE,                         -- Date range end (NULL = now)

  -- Drive-specific configuration
  drive_folder_id VARCHAR(255),               -- Root folder to sync
  drive_folder_url TEXT,                      -- Original URL if pasted by user
  drive_include_subfolders BOOLEAN DEFAULT true,
  drive_mime_types TEXT[] DEFAULT ARRAY['application/vnd.google-apps.document'],

  -- Sync schedule
  sync_frequency VARCHAR(20) DEFAULT 'manual' CHECK (sync_frequency IN ('manual', 'hourly', 'daily', 'weekly')),
  sync_cron_expression VARCHAR(100),          -- Optional cron for custom schedules
  last_sync_at TIMESTAMP WITH TIME ZONE,
  next_sync_at TIMESTAMP WITH TIME ZONE,

  -- Audit fields
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_sync_configurations_token ON sync_configurations(token_id);
CREATE INDEX IF NOT EXISTS idx_sync_configurations_service ON sync_configurations(service_type);
CREATE INDEX IF NOT EXISTS idx_sync_configurations_enabled ON sync_configurations(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_sync_configurations_next_sync ON sync_configurations(next_sync_at) WHERE enabled = true AND sync_frequency != 'manual';

-- Create sync_runs table for tracking sync execution history
CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES sync_configurations(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Results
  items_found INT DEFAULT 0,
  items_processed INT DEFAULT 0,
  items_skipped INT DEFAULT 0,                -- Already synced items
  deals_created INT DEFAULT 0,
  vendors_created INT DEFAULT 0,
  contacts_created INT DEFAULT 0,
  errors_count INT DEFAULT 0,

  -- Error tracking
  error_message TEXT,
  error_details JSONB,

  -- Metadata
  details JSONB DEFAULT '{}'::jsonb,          -- Full extraction results
  trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  triggered_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_config ON sync_runs(config_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);

-- Create synced_items table to track which items have been synced (avoid duplicates)
CREATE TABLE IF NOT EXISTS synced_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES sync_configurations(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,          -- Gmail message ID or Drive file ID
  external_item_hash CHAR(64),                -- SHA-256 hash of content for change detection
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sync_run_id UUID REFERENCES sync_runs(id) ON DELETE SET NULL,
  source_file_id UUID REFERENCES source_files(id) ON DELETE SET NULL,

  UNIQUE(config_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_synced_items_config ON synced_items(config_id);
CREATE INDEX IF NOT EXISTS idx_synced_items_external ON synced_items(external_id);
CREATE INDEX IF NOT EXISTS idx_synced_items_source_file ON synced_items(source_file_id) WHERE source_file_id IS NOT NULL;

-- Add trigger for updated_at on google_oauth_tokens
CREATE OR REPLACE FUNCTION update_google_oauth_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_google_oauth_tokens_updated_at ON google_oauth_tokens;
CREATE TRIGGER trg_google_oauth_tokens_updated_at
  BEFORE UPDATE ON google_oauth_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_google_oauth_tokens_updated_at();

-- Add trigger for updated_at on sync_configurations
CREATE OR REPLACE FUNCTION update_sync_configurations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_configurations_updated_at ON sync_configurations;
CREATE TRIGGER trg_sync_configurations_updated_at
  BEFORE UPDATE ON sync_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_sync_configurations_updated_at();

-- Add comments for documentation
COMMENT ON TABLE google_oauth_tokens IS 'Stores encrypted OAuth2 tokens for Google Gmail and Drive access';
COMMENT ON TABLE sync_configurations IS 'Stores sync configuration settings for Gmail and Drive imports';
COMMENT ON TABLE sync_runs IS 'Tracks execution history and results of sync operations';
COMMENT ON TABLE synced_items IS 'Tracks individual items that have been synced to avoid duplicates';

COMMENT ON COLUMN google_oauth_tokens.access_token IS 'AES-256 encrypted access token';
COMMENT ON COLUMN google_oauth_tokens.refresh_token IS 'AES-256 encrypted refresh token';
COMMENT ON COLUMN sync_configurations.gmail_label_ids IS 'Array of Gmail label IDs to filter messages';
COMMENT ON COLUMN sync_configurations.drive_mime_types IS 'Array of MIME types to include (default: Google Docs only)';
COMMENT ON COLUMN synced_items.external_item_hash IS 'SHA-256 hash of content for detecting changes on re-sync';
