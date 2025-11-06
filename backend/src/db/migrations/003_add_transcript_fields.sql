-- Migration 003: Add Transcript-Specific Fields for Enhanced NLP Pipeline
-- Based on the 5-stage NLP framework for transcript processing

-- Add transcript-specific fields to deal_registrations table
ALTER TABLE deal_registrations
ADD COLUMN IF NOT EXISTS buying_signal_score DECIMAL(3, 2) DEFAULT 0.0, -- 0-1 score for buying signals
ADD COLUMN IF NOT EXISTS extraction_method VARCHAR(50), -- 'transcript_nlp', 'email_extraction', etc.
ADD COLUMN IF NOT EXISTS source_transcript_id VARCHAR(255), -- Reference to transcript file

-- Additional prospect/customer fields
ADD COLUMN IF NOT EXISTS prospect_company_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS prospect_website VARCHAR(255),
ADD COLUMN IF NOT EXISTS prospect_address TEXT,
ADD COLUMN IF NOT EXISTS prospect_contact_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS prospect_contact_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS prospect_contact_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS prospect_job_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS company_size VARCHAR(50), -- employees, revenue tier, etc.
ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50),

-- Partner/vendor representative fields
ADD COLUMN IF NOT EXISTS partner_company_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS partner_contact_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS partner_contact_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS partner_contact_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS partner_role VARCHAR(100),

-- Contextual sales intelligence fields
ADD COLUMN IF NOT EXISTS current_vendor VARCHAR(255), -- Incumbent vendor
ADD COLUMN IF NOT EXISTS reason_for_change TEXT, -- Why switching vendors
ADD COLUMN IF NOT EXISTS identified_competitors TEXT[], -- Array of competitor names
ADD COLUMN IF NOT EXISTS potential_challenges TEXT, -- Obstacles mentioned in conversation
ADD COLUMN IF NOT EXISTS requested_support TEXT, -- What support was requested

-- Deal specifics from transcript
ADD COLUMN IF NOT EXISTS deal_expiration_date DATE,
ADD COLUMN IF NOT EXISTS product_service_requirements TEXT,
ADD COLUMN IF NOT EXISTS new_or_existing_customer BOOLEAN;

-- Add indexes for commonly queried fields
CREATE INDEX IF NOT EXISTS idx_deals_buying_signal ON deal_registrations(buying_signal_score DESC);
CREATE INDEX IF NOT EXISTS idx_deals_extraction_method ON deal_registrations(extraction_method);
CREATE INDEX IF NOT EXISTS idx_deals_prospect_company ON deal_registrations(prospect_company_name);
CREATE INDEX IF NOT EXISTS idx_deals_partner_company ON deal_registrations(partner_company_name);
CREATE INDEX IF NOT EXISTS idx_deals_current_vendor ON deal_registrations(current_vendor);
CREATE INDEX IF NOT EXISTS idx_deals_expiration_date ON deal_registrations(deal_expiration_date);

-- Add comments for documentation
COMMENT ON COLUMN deal_registrations.buying_signal_score IS 'Score (0-1) indicating strength of buying signals detected in transcript';
COMMENT ON COLUMN deal_registrations.extraction_method IS 'Method used to extract deal data (transcript_nlp, email_extraction, manual, etc.)';
COMMENT ON COLUMN deal_registrations.confidence_score IS 'Overall confidence score (0-1) in the extracted deal data';
COMMENT ON COLUMN deal_registrations.identified_competitors IS 'Array of competitor names mentioned during conversation';
COMMENT ON COLUMN deal_registrations.current_vendor IS 'Name of incumbent vendor (if customer is switching)';
COMMENT ON COLUMN deal_registrations.reason_for_change IS 'Reason customer is considering vendor change';
