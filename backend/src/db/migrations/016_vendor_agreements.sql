-- Migration: Add vendor_agreements table for storing manufacturing/partner agreements
-- Supports AI extraction of commission rates and key terms from agreement PDFs

-- Create vendor_agreements table
CREATE TABLE IF NOT EXISTS vendor_agreements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  -- File information
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INTEGER,
  upload_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Extracted agreement metadata
  agreement_type VARCHAR(100), -- 'manufacturing', 'distribution', 'reseller', 'partnership'
  effective_date DATE,
  expiration_date DATE,
  auto_renewal BOOLEAN DEFAULT false,
  renewal_terms TEXT,

  -- Commission structure (JSONB for flexibility)
  -- Examples:
  -- Flat rate: { "type": "flat", "rates": [{ "percentage": 15, "description": "Standard commission" }] }
  -- Tiered: { "type": "tiered", "rates": [{ "min": 0, "max": 100000, "percentage": 10 }, ...] }
  -- Product-specific: { "type": "product", "rates": [{ "product": "Hardware", "percentage": 12 }, ...] }
  commission_structure JSONB,

  -- Key terms (JSONB for flexibility)
  -- Example: { "exclusivity": "non-exclusive", "territory": "North America", "payment_terms": "Net 30", ... }
  key_terms JSONB,

  -- AI extraction metadata
  extraction_confidence DECIMAL(3,2), -- 0.00 to 1.00
  extraction_model VARCHAR(100),
  raw_extracted_text TEXT,
  extraction_metadata JSONB, -- Additional AI extraction details

  -- Audit fields
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255),
  updated_by VARCHAR(255)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_vendor_id ON vendor_agreements(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_agreement_type ON vendor_agreements(agreement_type);
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_effective_date ON vendor_agreements(effective_date);
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_expiration_date ON vendor_agreements(expiration_date);
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_upload_date ON vendor_agreements(upload_date DESC);

-- GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_commission ON vendor_agreements USING gin(commission_structure);
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_key_terms ON vendor_agreements USING gin(key_terms);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_vendor_agreements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_agreements_updated_at ON vendor_agreements;
CREATE TRIGGER trg_vendor_agreements_updated_at
  BEFORE UPDATE ON vendor_agreements
  FOR EACH ROW
  EXECUTE FUNCTION update_vendor_agreements_updated_at();

-- Add comment for documentation
COMMENT ON TABLE vendor_agreements IS 'Stores vendor manufacturing/partner agreements with AI-extracted commission rates and key terms';
COMMENT ON COLUMN vendor_agreements.commission_structure IS 'JSONB containing commission structure: type (flat|tiered|product) and rates array';
COMMENT ON COLUMN vendor_agreements.key_terms IS 'JSONB containing extracted key terms: exclusivity, territory, payment_terms, min_order, termination, etc.';
COMMENT ON COLUMN vendor_agreements.extraction_confidence IS 'AI confidence score from 0.00 to 1.00 for the extraction accuracy';
