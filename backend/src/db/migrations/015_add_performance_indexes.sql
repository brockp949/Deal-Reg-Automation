-- Migration: Add performance indexes for frequently queried columns
-- This improves query performance for common operations

-- Indexes for deal_registrations table
CREATE INDEX IF NOT EXISTS idx_deals_vendor_id ON deal_registrations(vendor_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deal_registrations(status);
CREATE INDEX IF NOT EXISTS idx_deals_deal_value ON deal_registrations(deal_value);
CREATE INDEX IF NOT EXISTS idx_deals_created_at ON deal_registrations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_registration_date ON deal_registrations(registration_date);
CREATE INDEX IF NOT EXISTS idx_deals_expected_close_date ON deal_registrations(expected_close_date);

-- Composite index for common filter combinations
CREATE INDEX IF NOT EXISTS idx_deals_vendor_status ON deal_registrations(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_status_created ON deal_registrations(status, created_at DESC);

-- Indexes for vendors table
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendors_approval_status ON vendors(approval_status);
CREATE INDEX IF NOT EXISTS idx_vendors_created_at ON vendors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendors_normalized_name ON vendors(normalized_name);

-- Composite index for vendor search with approval status
CREATE INDEX IF NOT EXISTS idx_vendors_approval_created ON vendors(approval_status, created_at DESC);

-- Indexes for contacts table
CREATE INDEX IF NOT EXISTS idx_contacts_vendor_id ON contacts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_is_primary ON contacts(is_primary, vendor_id);

-- Indexes for source_files table
CREATE INDEX IF NOT EXISTS idx_files_processing_status ON source_files(processing_status);
CREATE INDEX IF NOT EXISTS idx_files_scan_status ON source_files(scan_status);
CREATE INDEX IF NOT EXISTS idx_files_file_type ON source_files(file_type);
CREATE INDEX IF NOT EXISTS idx_files_upload_date ON source_files(upload_date DESC);

-- Text search index for vendor names (for fast search)
CREATE INDEX IF NOT EXISTS idx_vendors_name_trgm ON vendors USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_vendors_normalized_name_trgm ON vendors USING gin(normalized_name gin_trgm_ops);

-- Text search index for deal names
CREATE INDEX IF NOT EXISTS idx_deals_name_trgm ON deal_registrations USING gin(deal_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_deals_customer_name_trgm ON deal_registrations USING gin(customer_name gin_trgm_ops);

-- Note: pg_trgm extension must be enabled for trigram indexes
-- Run: CREATE EXTENSION IF NOT EXISTS pg_trgm;
