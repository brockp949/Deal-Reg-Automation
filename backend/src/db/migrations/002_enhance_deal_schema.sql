-- Migration 002: Enhance Deal Registration Schema with Blueprint Fields
-- Based on "Blueprint for an Automated Deal Registration Discovery Tool"

-- Add new fields to deal_registrations table
ALTER TABLE deal_registrations
ADD COLUMN IF NOT EXISTS end_user_address TEXT,
ADD COLUMN IF NOT EXISTS decision_maker_contact VARCHAR(255),
ADD COLUMN IF NOT EXISTS decision_maker_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS decision_maker_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS deployment_environment VARCHAR(100), -- Azure, on-premise, etc.
ADD COLUMN IF NOT EXISTS solution_category VARCHAR(100), -- networking security, cloud, etc.
ADD COLUMN IF NOT EXISTS contract_start_date DATE,
ADD COLUMN IF NOT EXISTS contract_end_date DATE,
ADD COLUMN IF NOT EXISTS pricing_model VARCHAR(50), -- perpetual, subscription, pay-as-you-go
ADD COLUMN IF NOT EXISTS deal_type VARCHAR(50), -- co-sell, partner-led, RFP, Public Tender
ADD COLUMN IF NOT EXISTS project_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS pre_sales_efforts TEXT,
ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3, 2) DEFAULT 0.0, -- 0-1 score
ADD COLUMN IF NOT EXISTS source_email_id VARCHAR(255), -- Message-ID from email
ADD COLUMN IF NOT EXISTS registration_term_days INTEGER; -- 90 days, etc.

-- Add new fields to vendors table
ALTER TABLE vendors
ADD COLUMN IF NOT EXISTS partner_contact_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS partner_contact_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS partner_contact_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS vendor_contact_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS vendor_contact_email VARCHAR(255);

-- Add new fields to contacts table
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS contact_role VARCHAR(50), -- decision-maker, partner, vendor, etc.
ADD COLUMN IF NOT EXISTS source_email_id VARCHAR(255);

-- Create email threads table for thread correlation
CREATE TABLE IF NOT EXISTS email_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id VARCHAR(255) UNIQUE, -- X-GM-THRID or generated ID
  subject_normalized VARCHAR(500),
  first_message_date TIMESTAMP,
  last_message_date TIMESTAMP,
  message_count INTEGER DEFAULT 0,
  participant_emails TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create email messages table for individual emails within threads
CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID REFERENCES email_threads(id) ON DELETE CASCADE,
  message_id VARCHAR(255) UNIQUE, -- Message-ID header
  source_file_id UUID REFERENCES source_files(id) ON DELETE CASCADE,
  from_address VARCHAR(255),
  to_addresses TEXT[],
  cc_addresses TEXT[],
  subject TEXT,
  date_sent TIMESTAMP,
  body_text TEXT,
  body_html TEXT,
  in_reply_to VARCHAR(255),
  email_references TEXT[], -- renamed from 'references' to avoid SQL keyword conflict
  confidence_tier INTEGER, -- 1, 2, or 3 based on keyword tier
  has_tier1_keywords BOOLEAN DEFAULT false,
  has_tier2_keywords BOOLEAN DEFAULT false,
  has_tier3_keywords BOOLEAN DEFAULT false,
  extracted_entities JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_deals_confidence ON deal_registrations(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_deals_deal_type ON deal_registrations(deal_type);
CREATE INDEX IF NOT EXISTS idx_deals_source_email ON deal_registrations(source_email_id);
CREATE INDEX IF NOT EXISTS idx_deals_contract_start ON deal_registrations(contract_start_date);
CREATE INDEX IF NOT EXISTS idx_deals_contract_end ON deal_registrations(contract_end_date);

CREATE INDEX IF NOT EXISTS idx_email_threads_subject ON email_threads(subject_normalized);
CREATE INDEX IF NOT EXISTS idx_email_threads_date ON email_threads(last_message_date DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON email_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_source ON email_messages(source_file_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_from ON email_messages(from_address);
CREATE INDEX IF NOT EXISTS idx_email_messages_date ON email_messages(date_sent DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_message_id ON email_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_tier1 ON email_messages(has_tier1_keywords) WHERE has_tier1_keywords = true;

-- Create keyword matches table for tracking which keywords were found
CREATE TABLE IF NOT EXISTS keyword_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_message_id UUID REFERENCES email_messages(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  keyword_tier INTEGER NOT NULL, -- 1, 2, or 3
  match_count INTEGER DEFAULT 1,
  match_context TEXT, -- surrounding text for context
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_keyword_matches_email ON keyword_matches(email_message_id);
CREATE INDEX IF NOT EXISTS idx_keyword_matches_tier ON keyword_matches(keyword_tier);

COMMENT ON TABLE email_threads IS 'Email conversation threads reconstructed from MBOX files';
COMMENT ON TABLE email_messages IS 'Individual email messages with extraction metadata';
COMMENT ON TABLE keyword_matches IS 'Tracks which keywords were found in each email for confidence scoring';
