/**
 * Migration: Error Tracking System
 *
 * Creates comprehensive error tracking for file parsing and processing.
 * Tracks parsing errors, extraction failures, validation issues, and processing errors.
 */

-- ============================================================================
-- ERROR LOGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Error classification
  error_category VARCHAR(50) NOT NULL,  -- 'parsing', 'extraction', 'validation', 'processing', 'integration'
  error_type VARCHAR(100) NOT NULL,     -- Specific error type
  error_severity VARCHAR(20) NOT NULL,  -- 'critical', 'error', 'warning', 'info'

  -- Error details
  error_message TEXT NOT NULL,
  error_code VARCHAR(50),               -- Optional error code
  error_stack TEXT,                     -- Stack trace if available

  -- Context
  source_component VARCHAR(100),        -- Which component generated the error
  source_file_id UUID REFERENCES source_files(id) ON DELETE CASCADE,
  entity_type VARCHAR(50),              -- 'vendor', 'deal', 'contact', 'email', 'transcript'
  entity_id UUID,                       -- Related entity ID if applicable

  -- Location information
  file_name VARCHAR(255),
  file_type VARCHAR(50),
  line_number INTEGER,
  column_number INTEGER,
  location_context TEXT,                -- Additional location info (e.g., "Email subject line", "Deal registration section")

  -- Error data
  error_data JSONB DEFAULT '{}'::jsonb, -- Additional structured error data
  input_data TEXT,                      -- The input that caused the error (if relevant)
  expected_format TEXT,                 -- What format was expected

  -- Resolution
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(100),
  resolution_notes TEXT,

  -- Metadata
  occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_id VARCHAR(100),                 -- User who triggered the operation (if applicable)
  session_id VARCHAR(100),              -- Session identifier

  -- Indexing
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Query by category and severity
CREATE INDEX IF NOT EXISTS idx_error_logs_category_severity
  ON error_logs(error_category, error_severity, occurred_at DESC);

-- Query by source file
CREATE INDEX IF NOT EXISTS idx_error_logs_source_file
  ON error_logs(source_file_id, occurred_at DESC);

-- Query by entity
CREATE INDEX IF NOT EXISTS idx_error_logs_entity
  ON error_logs(entity_type, entity_id);

-- Query by resolution status
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved
  ON error_logs(is_resolved, occurred_at DESC);

-- Query by error type
CREATE INDEX IF NOT EXISTS idx_error_logs_type
  ON error_logs(error_type, occurred_at DESC);

-- Query by date range
CREATE INDEX IF NOT EXISTS idx_error_logs_occurred
  ON error_logs(occurred_at DESC);

-- JSONB index for error_data queries
CREATE INDEX IF NOT EXISTS idx_error_logs_data
  ON error_logs USING GIN (error_data);

-- ============================================================================
-- ERROR STATISTICS VIEW
-- ============================================================================

CREATE OR REPLACE VIEW error_statistics AS
SELECT
  error_category,
  error_severity,
  error_type,
  COUNT(*) as error_count,
  COUNT(*) FILTER (WHERE is_resolved) as resolved_count,
  COUNT(*) FILTER (WHERE NOT is_resolved) as unresolved_count,
  MAX(occurred_at) as last_occurred,
  MIN(occurred_at) as first_occurred
FROM error_logs
GROUP BY error_category, error_severity, error_type;

-- ============================================================================
-- RECENT ERRORS VIEW (Last 7 Days)
-- ============================================================================

CREATE OR REPLACE VIEW recent_errors AS
SELECT
  id,
  error_category,
  error_type,
  error_severity,
  error_message,
  source_component,
  source_file_id,
  file_name,
  occurred_at,
  is_resolved
FROM error_logs
WHERE occurred_at >= NOW() - INTERVAL '7 days'
ORDER BY occurred_at DESC
LIMIT 100;

-- ============================================================================
-- UNRESOLVED CRITICAL ERRORS VIEW
-- ============================================================================

CREATE OR REPLACE VIEW unresolved_critical_errors AS
SELECT
  id,
  error_category,
  error_type,
  error_message,
  source_component,
  source_file_id,
  file_name,
  entity_type,
  entity_id,
  occurred_at,
  error_data
FROM error_logs
WHERE is_resolved = false
  AND error_severity IN ('critical', 'error')
ORDER BY occurred_at DESC;

-- ============================================================================
-- AUTO UPDATE TIMESTAMP TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_error_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_error_logs_updated_at ON error_logs;
CREATE TRIGGER trigger_error_logs_updated_at
  BEFORE UPDATE ON error_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_error_logs_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE error_logs IS 'Comprehensive error tracking for file parsing and processing';
COMMENT ON COLUMN error_logs.error_category IS 'High-level error classification: parsing, extraction, validation, processing, integration';
COMMENT ON COLUMN error_logs.error_severity IS 'Error severity: critical, error, warning, info';
COMMENT ON COLUMN error_logs.error_data IS 'Additional structured error data in JSONB format';
COMMENT ON COLUMN error_logs.location_context IS 'Human-readable location context (e.g., "Email body line 45")';
COMMENT ON VIEW error_statistics IS 'Aggregated error statistics by category, severity, and type';
COMMENT ON VIEW recent_errors IS 'Most recent errors in the last 7 days';
COMMENT ON VIEW unresolved_critical_errors IS 'Unresolved critical and error-level issues requiring attention';
