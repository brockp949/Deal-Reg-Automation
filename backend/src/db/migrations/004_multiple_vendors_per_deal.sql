-- Migration: Support Multiple Vendors Per Deal
-- Description: Creates junction table to allow deals to have multiple vendors
-- Date: 2025-11-06

-- Create junction table for deal-vendor many-to-many relationship
CREATE TABLE IF NOT EXISTS deal_vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deal_registrations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'partner', -- 'primary', 'partner', 'subcontractor', 'reseller'
  contribution_percentage INTEGER DEFAULT 100, -- For revenue/credit split
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(deal_id, vendor_id) -- Prevent duplicate vendor assignments
);

-- Create indexes for performance
CREATE INDEX idx_deal_vendors_deal_id ON deal_vendors(deal_id);
CREATE INDEX idx_deal_vendors_vendor_id ON deal_vendors(vendor_id);
CREATE INDEX idx_deal_vendors_role ON deal_vendors(role);

-- Migrate existing vendor_id relationships to junction table
-- Only migrate where vendor_id is not null
INSERT INTO deal_vendors (deal_id, vendor_id, role, contribution_percentage)
SELECT
  id as deal_id,
  vendor_id,
  'primary' as role,
  100 as contribution_percentage
FROM deal_registrations
WHERE vendor_id IS NOT NULL
ON CONFLICT (deal_id, vendor_id) DO NOTHING;

-- Add comment explaining the schema
COMMENT ON TABLE deal_vendors IS 'Junction table supporting many-to-many relationship between deals and vendors';
COMMENT ON COLUMN deal_vendors.role IS 'Vendor role: primary, partner, subcontractor, reseller';
COMMENT ON COLUMN deal_vendors.contribution_percentage IS 'Percentage of deal credit/revenue attributed to this vendor';

-- Create view for backward compatibility
CREATE OR REPLACE VIEW deal_registrations_with_primary_vendor AS
SELECT
  dr.*,
  dv.vendor_id as primary_vendor_id,
  v.name as primary_vendor_name
FROM deal_registrations dr
LEFT JOIN deal_vendors dv ON dr.id = dv.deal_id AND dv.role = 'primary'
LEFT JOIN vendors v ON dv.vendor_id = v.id;

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_deal_vendors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_deal_vendors_updated_at
  BEFORE UPDATE ON deal_vendors
  FOR EACH ROW
  EXECUTE FUNCTION update_deal_vendors_updated_at();

-- Note: vendor_id column in deal_registrations is kept for backward compatibility
-- but should be considered deprecated. Use deal_vendors table instead.
