-- 005_vendor_approval_workflow.sql
-- Introduce vendor approval workflow and review queue so that only
-- user-provided/approved vendors are allowed to participate in deals.

BEGIN;

-- Extend vendors table with approval metadata
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS origin VARCHAR(50) DEFAULT 'user_upload',
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approval_metadata JSONB DEFAULT '{}'::jsonb;

-- Ensure existing vendors are marked as approved
UPDATE vendors
SET approval_status = COALESCE(approval_status, 'approved');

CREATE INDEX IF NOT EXISTS idx_vendors_approval_status ON vendors(approval_status);
CREATE INDEX IF NOT EXISTS idx_vendors_origin ON vendors(origin);

-- Vendor review queue to capture inferred vendors awaiting user decision
CREATE TABLE IF NOT EXISTS vendor_review_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alias_name VARCHAR(255) NOT NULL,
  normalized_alias VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | denied
  detection_count INTEGER NOT NULL DEFAULT 1,
  first_detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  latest_context JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  approved_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  decision_notes TEXT,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(255)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_review_normalized_alias
  ON vendor_review_queue(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_vendor_review_status
  ON vendor_review_queue(status);

COMMIT;
