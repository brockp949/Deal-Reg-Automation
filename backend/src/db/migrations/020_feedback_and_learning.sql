-- Migration: Feedback and Continuous Learning
-- Description: Tables for storing user feedback and learned insights
-- Author: Claude Skills & Agents System
-- Date: 2025-12-16

-- Create feedback_events table to store user corrections and feedback
CREATE TABLE IF NOT EXISTS feedback_events (
  id SERIAL PRIMARY KEY,

  -- Feedback type and entity info
  type VARCHAR(50) NOT NULL CHECK (type IN ('correction', 'validation', 'rejection')),
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('vendor', 'deal', 'contact')),

  -- Data
  extracted_data JSONB NOT NULL,
  corrected_data JSONB,

  -- Context
  file_id VARCHAR(255) NOT NULL,
  file_name TEXT,
  user_id VARCHAR(255),
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Indexes for common queries
  CONSTRAINT fk_file FOREIGN KEY (file_id) REFERENCES source_files(id) ON DELETE CASCADE
);

-- Indexes for feedback_events
CREATE INDEX IF NOT EXISTS idx_feedback_events_type ON feedback_events(type);
CREATE INDEX IF NOT EXISTS idx_feedback_events_entity_type ON feedback_events(entity_type);
CREATE INDEX IF NOT EXISTS idx_feedback_events_file_id ON feedback_events(file_id);
CREATE INDEX IF NOT EXISTS idx_feedback_events_created_at ON feedback_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_events_user_id ON feedback_events(user_id);

-- Create learned_insights table to store patterns learned from feedback
CREATE TABLE IF NOT EXISTS learned_insights (
  id SERIAL PRIMARY KEY,

  -- Pattern identification
  pattern TEXT NOT NULL UNIQUE, -- Description of the pattern
  correction TEXT NOT NULL,      -- How to apply the correction

  -- Metrics
  frequency INTEGER NOT NULL DEFAULT 1,        -- How many times this pattern appears
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1), -- 0-1

  -- Applicability
  applicable_to_files JSONB, -- Array of file patterns: ["*.xlsx", "Vendor - *"]
  applicable_to_vendors JSONB, -- Array of vendor names

  -- Timestamps
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Examples
  examples JSONB, -- Array of {extracted, corrected, fileId} objects

  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for learned_insights
CREATE INDEX IF NOT EXISTS idx_learned_insights_pattern ON learned_insights(pattern);
CREATE INDEX IF NOT EXISTS idx_learned_insights_confidence ON learned_insights(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_learned_insights_frequency ON learned_insights(frequency DESC);
CREATE INDEX IF NOT EXISTS idx_learned_insights_last_seen ON learned_insights(last_seen DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_learned_insights_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_learned_insights_updated_at ON learned_insights;
CREATE TRIGGER trigger_update_learned_insights_updated_at
  BEFORE UPDATE ON learned_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_learned_insights_updated_at();

-- Add comments for documentation
COMMENT ON TABLE feedback_events IS 'User feedback and corrections for continuous learning';
COMMENT ON COLUMN feedback_events.type IS 'Type of feedback: correction (user fixed data), validation (user confirmed), rejection (user rejected)';
COMMENT ON COLUMN feedback_events.entity_type IS 'Type of entity: vendor, deal, or contact';
COMMENT ON COLUMN feedback_events.extracted_data IS 'What the system originally extracted';
COMMENT ON COLUMN feedback_events.corrected_data IS 'What the user corrected it to (null for validation/rejection)';

COMMENT ON TABLE learned_insights IS 'Patterns learned from user feedback to improve future extractions';
COMMENT ON COLUMN learned_insights.pattern IS 'Description of the pattern (e.g., "Vendor names always capitalized")';
COMMENT ON COLUMN learned_insights.correction IS 'How to apply this correction (e.g., "Capitalize first letter of each word")';
COMMENT ON COLUMN learned_insights.frequency IS 'Number of times this pattern has been observed';
COMMENT ON COLUMN learned_insights.confidence IS 'Confidence in this insight (0-1), higher = more reliable';
COMMENT ON COLUMN learned_insights.applicable_to_files IS 'File patterns this applies to (glob patterns)';
COMMENT ON COLUMN learned_insights.applicable_to_vendors IS 'Specific vendor names this applies to';

-- Grant permissions (adjust as needed for your user)
-- GRANT SELECT, INSERT, UPDATE ON feedback_events TO dealreg_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON learned_insights TO dealreg_user;
-- GRANT USAGE ON SEQUENCE feedback_events_id_seq TO dealreg_user;
-- GRANT USAGE ON SEQUENCE learned_insights_id_seq TO dealreg_user;
