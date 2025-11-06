-- Deal Registration Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Vendors Table
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) NOT NULL,
  email_domains TEXT[],
  industry VARCHAR(100),
  website VARCHAR(255),
  notes TEXT,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_vendors_normalized_name ON vendors(normalized_name);
CREATE INDEX IF NOT EXISTS idx_vendors_email_domains ON vendors USING GIN(email_domains);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);

-- Deal Registrations Table
CREATE TABLE IF NOT EXISTS deal_registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  deal_name VARCHAR(255),
  deal_value DECIMAL(12, 2),
  currency VARCHAR(3) DEFAULT 'USD',
  customer_name VARCHAR(255),
  customer_industry VARCHAR(100),
  registration_date DATE,
  expected_close_date DATE,
  status VARCHAR(50) DEFAULT 'registered',
  deal_stage VARCHAR(50),
  probability INTEGER CHECK (probability >= 0 AND probability <= 100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_deals_vendor ON deal_registrations(vendor_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deal_registrations(status);
CREATE INDEX IF NOT EXISTS idx_deals_reg_date ON deal_registrations(registration_date);
CREATE INDEX IF NOT EXISTS idx_deals_close_date ON deal_registrations(expected_close_date);

-- Source Files Table
CREATE TABLE IF NOT EXISTS source_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  file_size BIGINT,
  storage_path VARCHAR(500),
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processing_status VARCHAR(50) DEFAULT 'pending',
  processing_started_at TIMESTAMP,
  processing_completed_at TIMESTAMP,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_files_status ON source_files(processing_status);
CREATE INDEX IF NOT EXISTS idx_files_upload_date ON source_files(upload_date);

-- Extracted Entities Table
CREATE TABLE IF NOT EXISTS extracted_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id UUID REFERENCES source_files(id) ON DELETE CASCADE,
  entity_type VARCHAR(50),
  raw_text TEXT,
  normalized_data JSONB DEFAULT '{}'::jsonb,
  confidence_score DECIMAL(3, 2),
  source_location TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entities_source ON extracted_entities(source_file_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON extracted_entities(entity_type);

-- Entity Mappings Table
CREATE TABLE IF NOT EXISTS entity_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  extracted_entity_id UUID REFERENCES extracted_entities(id),
  vendor_id UUID REFERENCES vendors(id),
  deal_id UUID REFERENCES deal_registrations(id),
  mapping_confidence DECIMAL(3, 2),
  manually_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mappings_entity ON entity_mappings(extracted_entity_id);
CREATE INDEX IF NOT EXISTS idx_mappings_vendor ON entity_mappings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_mappings_deal ON entity_mappings(deal_id);

-- Contacts Table
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  role VARCHAR(100),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contacts_vendor ON contacts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);

-- Processing Jobs Table
CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id UUID REFERENCES source_files(id) ON DELETE CASCADE,
  job_type VARCHAR(50),
  status VARCHAR(50) DEFAULT 'queued',
  progress INTEGER DEFAULT 0,
  result_summary JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_source_file ON processing_jobs(source_file_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_vendors_updated_at ON vendors;
CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON vendors
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_deals_updated_at ON deal_registrations;
CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON deal_registrations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_jobs_updated_at ON processing_jobs;
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON processing_jobs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
