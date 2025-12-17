-- Migration 018: Unified File Processing
-- Adds upload_intent column to source_files for proper file routing

-- Add upload_intent column to track what type of processing the user intended
ALTER TABLE source_files
  ADD COLUMN IF NOT EXISTS upload_intent VARCHAR(50);

-- Values: 'vendor', 'deal', 'email', 'transcript', 'vendor_spreadsheet', 'auto'
COMMENT ON COLUMN source_files.upload_intent IS 'User-specified intent for file processing: vendor, deal, email, transcript, vendor_spreadsheet, auto';

-- Add index for filtering by intent
CREATE INDEX IF NOT EXISTS idx_files_upload_intent ON source_files(upload_intent);

-- Add detected_intent for auto-detection results (may differ from upload_intent)
ALTER TABLE source_files
  ADD COLUMN IF NOT EXISTS detected_intent VARCHAR(50);

COMMENT ON COLUMN source_files.detected_intent IS 'System-detected file intent based on content analysis';

-- Add parser_used to track which parser processed the file
ALTER TABLE source_files
  ADD COLUMN IF NOT EXISTS parser_used VARCHAR(100);

COMMENT ON COLUMN source_files.parser_used IS 'Name of the parser strategy that processed this file';
