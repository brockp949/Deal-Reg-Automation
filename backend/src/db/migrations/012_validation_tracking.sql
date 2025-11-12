-- Phase 4.2: System 2 Validation Layer
-- Adds validation tracking, business rules, and validation failure logging

-- Validation rules configuration table
-- Stores configurable business rules for validation
CREATE TABLE IF NOT EXISTS validation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_name VARCHAR(100) UNIQUE NOT NULL,
  rule_type VARCHAR(50) NOT NULL, -- 'range', 'format', 'logic', 'cross_ref', 'required'
  entity_type VARCHAR(50) NOT NULL, -- 'deal', 'vendor', 'contact'
  field_name VARCHAR(100) NOT NULL,
  rule_config JSONB DEFAULT '{}'::jsonb, -- Flexible rule configuration
  is_active BOOLEAN DEFAULT true,
  severity VARCHAR(20) DEFAULT 'warning', -- 'critical', 'error', 'warning'
  confidence_impact DECIMAL(3, 2) DEFAULT -0.1, -- Impact on confidence score (-1.0 to +1.0)
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick rule lookups
CREATE INDEX IF NOT EXISTS idx_validation_rules_entity_type ON validation_rules(entity_type);
CREATE INDEX IF NOT EXISTS idx_validation_rules_active ON validation_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_validation_rules_name ON validation_rules(rule_name);

-- Validation failure log table
-- Tracks all validation failures for analysis and improvement
CREATE TABLE IF NOT EXISTS validation_failures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  extraction_log_id UUID REFERENCES ai_extraction_logs(id) ON DELETE CASCADE,
  rule_name VARCHAR(100) NOT NULL,
  field_name VARCHAR(100) NOT NULL,
  expected_value TEXT,
  actual_value TEXT,
  failure_reason TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL, -- 'critical', 'error', 'warning'
  auto_corrected BOOLEAN DEFAULT false,
  corrected_value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for validation failure queries
CREATE INDEX IF NOT EXISTS idx_validation_failures_log ON validation_failures(extraction_log_id);
CREATE INDEX IF NOT EXISTS idx_validation_failures_rule ON validation_failures(rule_name);
CREATE INDEX IF NOT EXISTS idx_validation_failures_severity ON validation_failures(severity);
CREATE INDEX IF NOT EXISTS idx_validation_failures_created ON validation_failures(created_at DESC);

-- Enhance extracted_entities table with validation metadata
-- (checking if columns already exist to handle re-runs)
DO $$
BEGIN
  -- Add validation status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='extracted_entities' AND column_name='validation_status')
  THEN
    ALTER TABLE extracted_entities ADD COLUMN validation_status VARCHAR(50) DEFAULT 'pending';
  END IF;

  -- Add validation rules applied
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='extracted_entities' AND column_name='validation_rules_applied')
  THEN
    ALTER TABLE extracted_entities ADD COLUMN validation_rules_applied TEXT[];
  END IF;

  -- Add validation failures
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='extracted_entities' AND column_name='validation_failures')
  THEN
    ALTER TABLE extracted_entities ADD COLUMN validation_failures JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- Add validation warnings
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='extracted_entities' AND column_name='validation_warnings')
  THEN
    ALTER TABLE extracted_entities ADD COLUMN validation_warnings JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- Add final confidence score
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='extracted_entities' AND column_name='final_confidence_score')
  THEN
    ALTER TABLE extracted_entities ADD COLUMN final_confidence_score DECIMAL(3, 2);
  END IF;

  -- Add validated at timestamp
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='extracted_entities' AND column_name='validated_at')
  THEN
    ALTER TABLE extracted_entities ADD COLUMN validated_at TIMESTAMP;
  END IF;

  -- Add validation notes
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='extracted_entities' AND column_name='validation_notes')
  THEN
    ALTER TABLE extracted_entities ADD COLUMN validation_notes TEXT;
  END IF;
END $$;

-- Index for filtering by validation status
CREATE INDEX IF NOT EXISTS idx_extracted_entities_validation_status ON extracted_entities(validation_status);

-- Insert default validation rules
INSERT INTO validation_rules (rule_name, rule_type, entity_type, field_name, rule_config, severity, confidence_impact, description)
VALUES
  -- Deal validation rules
  ('deal_name_required', 'required', 'deal', 'deal_name', '{"minLength": 5}'::jsonb, 'critical', -0.5, 'Deal name must be present and at least 5 characters'),
  ('deal_value_positive', 'range', 'deal', 'deal_value', '{"min": 0}'::jsonb, 'error', -0.3, 'Deal value must be positive'),
  ('deal_value_reasonable', 'range', 'deal', 'deal_value', '{"min": 100, "max": 10000000}'::jsonb, 'warning', -0.1, 'Deal value should be in reasonable range ($100 - $10M)'),
  ('customer_name_required', 'required', 'deal', 'customer_name', '{"minLength": 2}'::jsonb, 'critical', -0.5, 'Customer name must be present'),
  ('customer_name_not_person', 'logic', 'deal', 'customer_name', '{}'::jsonb, 'warning', -0.1, 'Customer name should be a company, not a person'),
  ('close_date_future', 'logic', 'deal', 'close_date', '{"allowPast": false}'::jsonb, 'warning', -0.1, 'Close date should typically be in the future'),
  ('registration_date_past', 'logic', 'deal', 'registration_date', '{"allowFuture": false}'::jsonb, 'error', -0.2, 'Registration date must be in the past'),
  ('status_valid', 'format', 'deal', 'status', '{"validValues": ["prospecting", "qualified", "proposal", "negotiation", "closed_won", "closed_lost", "registered", "pending", "new"]}'::jsonb, 'warning', -0.05, 'Status must be a valid deal stage'),

  -- Vendor validation rules
  ('vendor_name_required', 'required', 'vendor', 'name', '{"minLength": 2}'::jsonb, 'critical', -0.5, 'Vendor name must be present'),
  ('vendor_email_domain_format', 'format', 'vendor', 'email_domains', '{"pattern": "^[a-z0-9.-]+\\.[a-z]{2,}$"}'::jsonb, 'warning', -0.1, 'Email domain must be valid format'),

  -- Contact validation rules
  ('contact_name_required', 'required', 'contact', 'name', '{"minLength": 2}'::jsonb, 'critical', -0.5, 'Contact name must be present'),
  ('contact_email_format', 'format', 'contact', 'email', '{"pattern": "^[^@]+@[^@]+\\.[^@]+$"}'::jsonb, 'warning', -0.1, 'Email must be valid format'),
  ('contact_phone_format', 'format', 'contact', 'phone', '{"pattern": "^\\+?[0-9\\s\\-\\(\\)]+$"}'::jsonb, 'warning', -0.05, 'Phone number should contain only valid characters')
ON CONFLICT (rule_name) DO NOTHING;

-- View: Validation statistics by rule
-- Shows which rules fail most often
CREATE OR REPLACE VIEW validation_failure_stats AS
SELECT
  rule_name,
  field_name,
  severity,
  COUNT(*) AS failure_count,
  COUNT(DISTINCT extraction_log_id) AS affected_extractions,
  MIN(created_at) AS first_failure,
  MAX(created_at) AS latest_failure
FROM validation_failures
GROUP BY rule_name, field_name, severity
ORDER BY failure_count DESC;

-- View: Recent validation failures
-- Shows latest validation issues for monitoring
CREATE OR REPLACE VIEW recent_validation_failures AS
SELECT
  vf.id,
  vf.rule_name,
  vf.field_name,
  vf.failure_reason,
  vf.severity,
  vf.actual_value,
  vf.created_at,
  ael.extraction_type,
  ael.ai_model,
  ael.confidence_score AS extraction_confidence,
  sf.filename AS source_file
FROM validation_failures vf
JOIN ai_extraction_logs ael ON vf.extraction_log_id = ael.id
LEFT JOIN source_files sf ON ael.source_file_id = sf.id
ORDER BY vf.created_at DESC
LIMIT 100;

-- View: Validation pass rates by extraction type
-- Monitor how well different extraction types validate
CREATE OR REPLACE VIEW validation_pass_rates AS
SELECT
  ee.entity_type,
  ee.validation_status,
  COUNT(*) AS count,
  ROUND(AVG(ee.ai_confidence_score)::numeric, 2) AS avg_extraction_confidence,
  ROUND(AVG(ee.final_confidence_score)::numeric, 2) AS avg_final_confidence,
  ROUND(AVG(ee.final_confidence_score - ee.ai_confidence_score)::numeric, 3) AS avg_confidence_adjustment
FROM extracted_entities ee
WHERE ee.validation_status IS NOT NULL
GROUP BY ee.entity_type, ee.validation_status;

-- Function: Update validation rule
-- Allows dynamic updating of validation rules
CREATE OR REPLACE FUNCTION update_validation_rule(
  p_rule_name VARCHAR(100),
  p_is_active BOOLEAN DEFAULT NULL,
  p_severity VARCHAR(20) DEFAULT NULL,
  p_confidence_impact DECIMAL(3,2) DEFAULT NULL,
  p_rule_config JSONB DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  rows_affected INTEGER;
BEGIN
  UPDATE validation_rules
  SET
    is_active = COALESCE(p_is_active, is_active),
    severity = COALESCE(p_severity, severity),
    confidence_impact = COALESCE(p_confidence_impact, confidence_impact),
    rule_config = COALESCE(p_rule_config, rule_config),
    updated_at = CURRENT_TIMESTAMP
  WHERE rule_name = p_rule_name;

  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql;

-- Function: Get validation statistics
-- Returns overall validation metrics
CREATE OR REPLACE FUNCTION get_validation_statistics(
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE(
  total_validations BIGINT,
  passed_validations BIGINT,
  failed_validations BIGINT,
  pending_validations BIGINT,
  pass_rate DECIMAL(5,2),
  avg_confidence_before DECIMAL(3,2),
  avg_confidence_after DECIMAL(3,2),
  total_failures BIGINT,
  critical_failures BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_validations,
    COUNT(*) FILTER (WHERE ee.validation_status = 'passed')::BIGINT AS passed_validations,
    COUNT(*) FILTER (WHERE ee.validation_status = 'failed')::BIGINT AS failed_validations,
    COUNT(*) FILTER (WHERE ee.validation_status = 'pending')::BIGINT AS pending_validations,
    ROUND((COUNT(*) FILTER (WHERE ee.validation_status = 'passed')::DECIMAL / NULLIF(COUNT(*), 0)) * 100, 2) AS pass_rate,
    ROUND(AVG(ee.ai_confidence_score)::numeric, 2) AS avg_confidence_before,
    ROUND(AVG(ee.final_confidence_score)::numeric, 2) AS avg_confidence_after,
    (SELECT COUNT(*)::BIGINT FROM validation_failures WHERE created_at >= CURRENT_DATE - p_days * INTERVAL '1 day') AS total_failures,
    (SELECT COUNT(*)::BIGINT FROM validation_failures WHERE severity = 'critical' AND created_at >= CURRENT_DATE - p_days * INTERVAL '1 day') AS critical_failures
  FROM extracted_entities ee
  WHERE ee.validated_at IS NOT NULL
    AND ee.validated_at >= CURRENT_DATE - p_days * INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update timestamp on validation rule changes
CREATE OR REPLACE FUNCTION update_validation_rule_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_validation_rule_timestamp
  BEFORE UPDATE ON validation_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_validation_rule_timestamp();

-- Comments for documentation
COMMENT ON TABLE validation_rules IS 'Configurable business rules for validating extracted entities';
COMMENT ON TABLE validation_failures IS 'Log of all validation failures for analysis and improvement';
COMMENT ON COLUMN validation_rules.rule_config IS 'JSON configuration for the rule (thresholds, patterns, etc.)';
COMMENT ON COLUMN validation_rules.confidence_impact IS 'Impact on confidence score when rule fails (-1.0 to +1.0)';
COMMENT ON COLUMN validation_failures.auto_corrected IS 'Whether the system automatically corrected the failure';
COMMENT ON VIEW validation_failure_stats IS 'Statistics showing which validation rules fail most often';
COMMENT ON VIEW recent_validation_failures IS 'Recent validation failures with context for debugging';
COMMENT ON VIEW validation_pass_rates IS 'Validation pass rates by entity type and status';
COMMENT ON FUNCTION update_validation_rule IS 'Update validation rule configuration dynamically';
COMMENT ON FUNCTION get_validation_statistics IS 'Get comprehensive validation statistics for a time period';
