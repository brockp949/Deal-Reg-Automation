-- Phase 5.1: Advanced Vendor Matching & Association
-- Adds vendor alias support, product keywords, and matching configuration

-- ============================================================================
-- Vendor Aliases Table
-- ============================================================================

-- Stores alternative names and variations for vendors
-- Enables fuzzy matching and handles multiple vendor name formats
CREATE TABLE IF NOT EXISTS vendor_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  alias VARCHAR(255) NOT NULL,
  normalized_alias VARCHAR(255) NOT NULL,
  alias_type VARCHAR(50) NOT NULL, -- 'abbreviation', 'subsidiary', 'product', 'domain', 'nickname'
  confidence DECIMAL(3, 2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source VARCHAR(50) DEFAULT 'manual', -- 'manual', 'learned', 'imported', 'suggested'
  usage_count INTEGER DEFAULT 0, -- How many times this alias was matched
  last_used_at TIMESTAMP,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_vendor_aliases_vendor ON vendor_aliases(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_aliases_normalized ON vendor_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_vendor_aliases_type ON vendor_aliases(alias_type);
CREATE INDEX IF NOT EXISTS idx_vendor_aliases_confidence ON vendor_aliases(confidence DESC);

-- Unique constraint to prevent duplicate aliases
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_aliases_unique
  ON vendor_aliases(vendor_id, normalized_alias);

-- ============================================================================
-- Enhance Vendors Table
-- ============================================================================

-- Add product keywords for matching
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='vendors' AND column_name='product_keywords')
  THEN
    ALTER TABLE vendors ADD COLUMN product_keywords TEXT[] DEFAULT '{}';
  END IF;

  -- Add matching rules configuration
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='vendors' AND column_name='matching_rules')
  THEN
    ALTER TABLE vendors ADD COLUMN matching_rules JSONB DEFAULT '{}'::jsonb;
  END IF;

  -- Add matching statistics
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='vendors' AND column_name='match_count')
  THEN
    ALTER TABLE vendors ADD COLUMN match_count INTEGER DEFAULT 0;
  END IF;

  -- Add last matched timestamp
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='vendors' AND column_name='last_matched_at')
  THEN
    ALTER TABLE vendors ADD COLUMN last_matched_at TIMESTAMP;
  END IF;
END $$;

-- Index for product keyword searches
CREATE INDEX IF NOT EXISTS idx_vendors_product_keywords ON vendors USING GIN(product_keywords);

-- ============================================================================
-- Vendor Matching Logs Table
-- ============================================================================

-- Track all vendor matching attempts for analysis and improvement
CREATE TABLE IF NOT EXISTS vendor_matching_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  extracted_name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255),
  matched_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  match_strategy VARCHAR(50), -- 'exact_name', 'alias_match', 'fuzzy_high', 'product_match', etc.
  match_confidence DECIMAL(3, 2),
  match_details JSONB DEFAULT '{}'::jsonb,
  alternative_matches JSONB DEFAULT '[]'::jsonb,
  source_file_id UUID REFERENCES source_files(id) ON DELETE SET NULL,
  source_context TEXT,
  was_manual_override BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for analysis queries
CREATE INDEX IF NOT EXISTS idx_matching_logs_vendor ON vendor_matching_logs(matched_vendor_id);
CREATE INDEX IF NOT EXISTS idx_matching_logs_strategy ON vendor_matching_logs(match_strategy);
CREATE INDEX IF NOT EXISTS idx_matching_logs_confidence ON vendor_matching_logs(match_confidence DESC);
CREATE INDEX IF NOT EXISTS idx_matching_logs_created ON vendor_matching_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matching_logs_extracted ON vendor_matching_logs(extracted_name);

-- ============================================================================
-- Unmatched Vendor Names Table
-- ============================================================================

-- Track vendor names that couldn't be matched
-- Useful for suggesting new aliases and improving matching
CREATE TABLE IF NOT EXISTS unmatched_vendor_names (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  extracted_name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255),
  occurrence_count INTEGER DEFAULT 1,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source_files TEXT[], -- Array of source file IDs where this name appeared
  suggested_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  suggestion_confidence DECIMAL(3, 2),
  resolution_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'resolved', 'ignored'
  resolved_at TIMESTAMP,
  resolved_to_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_unmatched_names_normalized ON unmatched_vendor_names(normalized_name);
CREATE INDEX IF NOT EXISTS idx_unmatched_names_count ON unmatched_vendor_names(occurrence_count DESC);
CREATE INDEX IF NOT EXISTS idx_unmatched_names_status ON unmatched_vendor_names(resolution_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unmatched_names_unique ON unmatched_vendor_names(normalized_name);

-- ============================================================================
-- Views for Analysis and Monitoring
-- ============================================================================

-- View: Vendor Alias Statistics
-- Shows how many aliases each vendor has and usage patterns
CREATE OR REPLACE VIEW vendor_alias_stats AS
SELECT
  v.id AS vendor_id,
  v.name AS vendor_name,
  COUNT(va.id) AS alias_count,
  SUM(va.usage_count) AS total_alias_uses,
  AVG(va.confidence) AS avg_alias_confidence,
  MAX(va.last_used_at) AS most_recent_alias_use
FROM vendors v
LEFT JOIN vendor_aliases va ON v.id = va.vendor_id
GROUP BY v.id, v.name
ORDER BY alias_count DESC;

-- View: Matching Strategy Effectiveness
-- Shows which matching strategies work best
CREATE OR REPLACE VIEW matching_strategy_stats AS
SELECT
  match_strategy,
  COUNT(*) AS usage_count,
  AVG(match_confidence) AS avg_confidence,
  COUNT(*) FILTER (WHERE match_confidence >= 0.9) AS high_confidence_matches,
  COUNT(*) FILTER (WHERE match_confidence >= 0.7 AND match_confidence < 0.9) AS medium_confidence_matches,
  COUNT(*) FILTER (WHERE match_confidence < 0.7) AS low_confidence_matches,
  MIN(created_at) AS first_used,
  MAX(created_at) AS last_used
FROM vendor_matching_logs
WHERE match_strategy IS NOT NULL
GROUP BY match_strategy
ORDER BY usage_count DESC;

-- View: Top Unmatched Vendor Names
-- Prioritize which unmatched names should be resolved
CREATE OR REPLACE VIEW top_unmatched_vendors AS
SELECT
  uvn.id,
  uvn.extracted_name,
  uvn.occurrence_count,
  uvn.first_seen_at,
  uvn.last_seen_at,
  uvn.suggested_vendor_id,
  v.name AS suggested_vendor_name,
  uvn.suggestion_confidence,
  uvn.resolution_status
FROM unmatched_vendor_names uvn
LEFT JOIN vendors v ON uvn.suggested_vendor_id = v.id
WHERE uvn.resolution_status = 'pending'
ORDER BY uvn.occurrence_count DESC, uvn.last_seen_at DESC
LIMIT 50;

-- View: Vendor Matching Performance
-- Overall matching performance metrics
CREATE OR REPLACE VIEW vendor_matching_performance AS
SELECT
  DATE(vml.created_at) AS match_date,
  COUNT(*) AS total_attempts,
  COUNT(vml.matched_vendor_id) AS successful_matches,
  COUNT(*) FILTER (WHERE vml.matched_vendor_id IS NULL) AS failed_matches,
  ROUND(AVG(vml.match_confidence)::numeric, 2) AS avg_confidence,
  COUNT(*) FILTER (WHERE vml.match_confidence >= 0.9) AS high_confidence,
  COUNT(*) FILTER (WHERE vml.match_confidence >= 0.7 AND vml.match_confidence < 0.9) AS medium_confidence,
  COUNT(*) FILTER (WHERE vml.match_confidence < 0.7) AS low_confidence
FROM vendor_matching_logs vml
GROUP BY DATE(vml.created_at)
ORDER BY match_date DESC;

-- ============================================================================
-- Functions for Vendor Matching
-- ============================================================================

-- Function: Log vendor match
CREATE OR REPLACE FUNCTION log_vendor_match(
  p_extracted_name VARCHAR,
  p_matched_vendor_id UUID,
  p_strategy VARCHAR,
  p_confidence DECIMAL,
  p_details JSONB DEFAULT NULL,
  p_source_file_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
  v_normalized VARCHAR;
BEGIN
  -- Normalize the name
  v_normalized := LOWER(TRIM(REGEXP_REPLACE(p_extracted_name, '[^a-z0-9\s]', '', 'gi')));

  -- Insert matching log
  INSERT INTO vendor_matching_logs (
    extracted_name,
    normalized_name,
    matched_vendor_id,
    match_strategy,
    match_confidence,
    match_details,
    source_file_id
  ) VALUES (
    p_extracted_name,
    v_normalized,
    p_matched_vendor_id,
    p_strategy,
    p_confidence,
    p_details,
    p_source_file_id
  )
  RETURNING id INTO v_log_id;

  -- Update vendor match count
  IF p_matched_vendor_id IS NOT NULL THEN
    UPDATE vendors
    SET
      match_count = COALESCE(match_count, 0) + 1,
      last_matched_at = CURRENT_TIMESTAMP
    WHERE id = p_matched_vendor_id;
  END IF;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Log unmatched vendor name
CREATE OR REPLACE FUNCTION log_unmatched_vendor(
  p_extracted_name VARCHAR,
  p_source_file_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_normalized VARCHAR;
  v_unmatched_id UUID;
BEGIN
  -- Normalize the name
  v_normalized := LOWER(TRIM(REGEXP_REPLACE(p_extracted_name, '[^a-z0-9\s]', '', 'gi')));

  -- Check if already exists
  SELECT id INTO v_unmatched_id
  FROM unmatched_vendor_names
  WHERE normalized_name = v_normalized;

  IF v_unmatched_id IS NOT NULL THEN
    -- Update existing entry
    UPDATE unmatched_vendor_names
    SET
      occurrence_count = occurrence_count + 1,
      last_seen_at = CURRENT_TIMESTAMP,
      source_files = ARRAY_APPEND(source_files, p_source_file_id::TEXT)
    WHERE id = v_unmatched_id;
  ELSE
    -- Insert new entry
    INSERT INTO unmatched_vendor_names (
      extracted_name,
      normalized_name,
      source_files
    ) VALUES (
      p_extracted_name,
      v_normalized,
      ARRAY[p_source_file_id::TEXT]
    )
    RETURNING id INTO v_unmatched_id;
  END IF;

  RETURN v_unmatched_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Update alias usage
CREATE OR REPLACE FUNCTION update_alias_usage(p_alias_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE vendor_aliases
  SET
    usage_count = usage_count + 1,
    last_used_at = CURRENT_TIMESTAMP
  WHERE id = p_alias_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Get vendor matching statistics
CREATE OR REPLACE FUNCTION get_vendor_matching_stats(p_days INTEGER DEFAULT 30)
RETURNS TABLE(
  total_matches BIGINT,
  successful_matches BIGINT,
  failed_matches BIGINT,
  success_rate DECIMAL,
  avg_confidence DECIMAL,
  high_confidence_matches BIGINT,
  aliases_in_use BIGINT,
  unmatched_names BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_matches,
    COUNT(vml.matched_vendor_id)::BIGINT AS successful_matches,
    COUNT(*) FILTER (WHERE vml.matched_vendor_id IS NULL)::BIGINT AS failed_matches,
    ROUND((COUNT(vml.matched_vendor_id)::DECIMAL / NULLIF(COUNT(*), 0)) * 100, 2) AS success_rate,
    ROUND(AVG(vml.match_confidence)::numeric, 2) AS avg_confidence,
    COUNT(*) FILTER (WHERE vml.match_confidence >= 0.9)::BIGINT AS high_confidence_matches,
    (SELECT COUNT(*)::BIGINT FROM vendor_aliases WHERE last_used_at >= CURRENT_DATE - p_days * INTERVAL '1 day') AS aliases_in_use,
    (SELECT COUNT(*)::BIGINT FROM unmatched_vendor_names WHERE resolution_status = 'pending') AS unmatched_names
  FROM vendor_matching_logs vml
  WHERE vml.created_at >= CURRENT_DATE - p_days * INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Triggers
-- ============================================================================

-- Trigger: Update vendor_aliases updated_at timestamp
CREATE OR REPLACE FUNCTION update_vendor_alias_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_vendor_alias_timestamp ON vendor_aliases;
CREATE TRIGGER trigger_update_vendor_alias_timestamp
  BEFORE UPDATE ON vendor_aliases
  FOR EACH ROW
  EXECUTE FUNCTION update_vendor_alias_timestamp();

-- ============================================================================
-- Seed Data: Example Vendor Aliases
-- ============================================================================

-- Insert example aliases for demonstration
-- (Only if vendors exist; this is optional)
DO $$
DECLARE
  v_vendor_id UUID;
BEGIN
  -- Example: If you have a vendor named "Microsoft Corporation"
  SELECT id INTO v_vendor_id FROM vendors WHERE name ILIKE '%microsoft%' LIMIT 1;

  IF v_vendor_id IS NOT NULL THEN
    INSERT INTO vendor_aliases (vendor_id, alias, normalized_alias, alias_type, confidence)
    VALUES
      (v_vendor_id, 'MSFT', 'msft', 'abbreviation', 0.95),
      (v_vendor_id, 'MS', 'ms', 'abbreviation', 0.85)
    ON CONFLICT (vendor_id, normalized_alias) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE vendor_aliases IS 'Alternative names and variations for vendors to improve matching';
COMMENT ON TABLE vendor_matching_logs IS 'Audit trail of all vendor matching attempts for analysis';
COMMENT ON TABLE unmatched_vendor_names IS 'Track vendor names that could not be matched to suggest improvements';
COMMENT ON COLUMN vendor_aliases.confidence IS 'How confident we are that this alias refers to the vendor (0.0-1.0)';
COMMENT ON COLUMN vendor_aliases.usage_count IS 'How many times this alias was used in successful matches';
COMMENT ON COLUMN vendors.product_keywords IS 'Product names/keywords associated with this vendor for matching';
COMMENT ON COLUMN vendors.matching_rules IS 'Custom matching rules specific to this vendor (JSONB)';
COMMENT ON FUNCTION log_vendor_match IS 'Log a vendor matching attempt and update statistics';
COMMENT ON FUNCTION log_unmatched_vendor IS 'Log a vendor name that could not be matched';
COMMENT ON VIEW vendor_alias_stats IS 'Statistics on vendor aliases and their usage';
COMMENT ON VIEW matching_strategy_stats IS 'Effectiveness of different matching strategies';
COMMENT ON VIEW top_unmatched_vendors IS 'Top unmatched vendor names that need resolution';
COMMENT ON VIEW vendor_matching_performance IS 'Daily vendor matching performance metrics';
