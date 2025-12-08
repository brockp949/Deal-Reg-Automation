-- Migration 006: Field-Level Provenance Tracking
-- Enables full transparency by tracking the source of every field value

-- Field Provenance Table
-- Tracks the origin of each field value for complete audit trail and transparency
CREATE TABLE IF NOT EXISTS field_provenance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- What entity and field this tracks
  entity_type VARCHAR(50) NOT NULL, -- 'deal', 'vendor', 'contact'
  entity_id UUID NOT NULL,
  field_name VARCHAR(100) NOT NULL,
  field_value TEXT,

  -- Source information
  source_file_id UUID REFERENCES source_files(id) ON DELETE CASCADE,
  source_type VARCHAR(50), -- 'email', 'transcript', 'csv', 'manual', 'ai', 'inference'
  source_location TEXT, -- 'Email line 45', 'Transcript page 2', 'CSV row 123', etc.

  -- Extraction metadata
  extraction_method VARCHAR(50), -- 'regex', 'keyword', 'ai', 'manual', 'inference', 'normalization'
  confidence DECIMAL(3, 2), -- 0.0 to 1.0

  -- Context and validation
  extraction_context JSONB DEFAULT '{}'::jsonb, -- Additional context (surrounding text, etc.)
  validation_status VARCHAR(50), -- 'validated', 'unvalidated', 'rejected', 'corrected'

  -- Tracking
  extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  extracted_by VARCHAR(100), -- 'system', 'user:email', 'ai:claude', etc.

  -- Superseded tracking (when field is updated)
  is_current BOOLEAN DEFAULT true,
  superseded_by UUID REFERENCES field_provenance(id) ON DELETE SET NULL,
  superseded_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_provenance_entity ON field_provenance(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_provenance_field ON field_provenance(field_name);
CREATE INDEX IF NOT EXISTS idx_provenance_source_file ON field_provenance(source_file_id);
CREATE INDEX IF NOT EXISTS idx_provenance_current ON field_provenance(is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_provenance_entity_current ON field_provenance(entity_type, entity_id, is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_provenance_confidence ON field_provenance(confidence DESC);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_provenance_entity_field_current ON field_provenance(entity_type, entity_id, field_name, is_current) WHERE is_current = true;

-- Comments for documentation
COMMENT ON TABLE field_provenance IS 'Tracks the source and extraction method for every field value, enabling full transparency and audit trail';
COMMENT ON COLUMN field_provenance.entity_type IS 'Type of entity (deal, vendor, contact)';
COMMENT ON COLUMN field_provenance.entity_id IS 'ID of the entity (references deals, vendors, or contacts)';
COMMENT ON COLUMN field_provenance.field_name IS 'Name of the field (e.g., deal_value, customer_name, vendor_email)';
COMMENT ON COLUMN field_provenance.source_location IS 'Human-readable location in source (e.g., "Email line 45", "Transcript page 2")';
COMMENT ON COLUMN field_provenance.extraction_method IS 'How the value was extracted (regex, AI, manual entry, etc.)';
COMMENT ON COLUMN field_provenance.is_current IS 'Whether this is the current value (false if superseded by newer extraction)';

-- Function to supersede old provenance when field is updated
CREATE OR REPLACE FUNCTION supersede_old_provenance()
RETURNS TRIGGER AS $$
BEGIN
  -- Mark old provenance as superseded
  UPDATE field_provenance
  SET
    is_current = false,
    superseded_by = NEW.id,
    superseded_at = CURRENT_TIMESTAMP
  WHERE
    entity_type = NEW.entity_type
    AND entity_id = NEW.entity_id
    AND field_name = NEW.field_name
    AND is_current = true
    AND id != NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically supersede old provenance
DROP TRIGGER IF EXISTS trigger_supersede_provenance ON field_provenance;
CREATE TRIGGER trigger_supersede_provenance
  AFTER INSERT ON field_provenance
  FOR EACH ROW
  EXECUTE FUNCTION supersede_old_provenance();

-- View for easily getting current field provenance
CREATE OR REPLACE VIEW current_field_provenance AS
SELECT
  fp.*,
  sf.filename as source_filename,
  sf.file_type as source_file_type,
  sf.upload_date as source_upload_date
FROM field_provenance fp
LEFT JOIN source_files sf ON fp.source_file_id = sf.id
WHERE fp.is_current = true;

COMMENT ON VIEW current_field_provenance IS 'Shows only current (non-superseded) field provenance with source file details';
