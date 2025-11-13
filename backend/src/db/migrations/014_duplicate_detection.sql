-- Migration 014: Duplicate Detection & Merge Tracking
-- Created: 2025-11-12
-- Description: Add tables and functions for duplicate detection, clustering, and merge management

-- ============================================================================
-- Table: duplicate_detections
-- Purpose: Track all duplicate detection results
-- ============================================================================

CREATE TABLE IF NOT EXISTS duplicate_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,              -- 'deal', 'vendor', 'contact'
  entity_id_1 UUID NOT NULL,                     -- First entity
  entity_id_2 UUID NOT NULL,                     -- Potentially duplicate entity
  similarity_score DECIMAL(5,4) NOT NULL,        -- 0.0000-1.0000
  confidence_level DECIMAL(5,4) NOT NULL,        -- 0.0000-1.0000
  detection_strategy VARCHAR(50) NOT NULL,       -- exact_match, fuzzy_name, etc.
  similarity_factors JSONB DEFAULT '{}'::jsonb,  -- Detailed similarity breakdown
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  detected_by VARCHAR(100),                      -- user_id or 'system'
  status VARCHAR(20) DEFAULT 'pending',          -- pending, confirmed, rejected
  resolution_notes TEXT,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(100),

  -- Ensure we don't duplicate the same pair
  CONSTRAINT unique_duplicate_pair UNIQUE (entity_type, entity_id_1, entity_id_2),

  -- Ensure entity_id_1 < entity_id_2 for consistent ordering
  CONSTRAINT ordered_entity_ids CHECK (entity_id_1 < entity_id_2),

  -- Valid status values
  CONSTRAINT valid_status CHECK (status IN ('pending', 'confirmed', 'rejected', 'auto_merged')),

  -- Valid entity types
  CONSTRAINT valid_entity_type CHECK (entity_type IN ('deal', 'vendor', 'contact'))
);

CREATE INDEX idx_duplicate_detections_entity1 ON duplicate_detections(entity_id_1);
CREATE INDEX idx_duplicate_detections_entity2 ON duplicate_detections(entity_id_2);
CREATE INDEX idx_duplicate_detections_status ON duplicate_detections(status);
CREATE INDEX idx_duplicate_detections_confidence ON duplicate_detections(confidence_level DESC);
CREATE INDEX idx_duplicate_detections_detected_at ON duplicate_detections(detected_at DESC);
CREATE INDEX idx_duplicate_detections_entity_type ON duplicate_detections(entity_type);

-- Composite index for finding high-confidence duplicates
CREATE INDEX idx_duplicate_high_confidence ON duplicate_detections(entity_type, status, confidence_level DESC)
WHERE status = 'pending' AND confidence_level >= 0.85;

COMMENT ON TABLE duplicate_detections IS 'Tracks all duplicate detection results with confidence scores';
COMMENT ON COLUMN duplicate_detections.similarity_factors IS 'JSONB: {dealName: 0.95, customerName: 0.88, ...}';

-- ============================================================================
-- Table: duplicate_clusters
-- Purpose: Group multiple duplicate entities together
-- ============================================================================

CREATE TABLE IF NOT EXISTS duplicate_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key VARCHAR(500) NOT NULL UNIQUE,     -- Deterministic key from sorted entity IDs
  entity_type VARCHAR(50) NOT NULL,
  entity_ids UUID[] NOT NULL,                    -- Array of all entities in cluster
  master_entity_id UUID,                         -- Primary/master entity for the cluster
  cluster_size INTEGER NOT NULL,                 -- Denormalized count
  confidence_score DECIMAL(5,4),                 -- Average confidence of all pairs
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active',           -- active, merged, split, ignored
  merge_history_id UUID,                         -- Reference to merge if merged
  notes TEXT,

  -- Ensure cluster has at least 2 entities
  CONSTRAINT min_cluster_size CHECK (cluster_size >= 2),
  CONSTRAINT array_length_matches CHECK (array_length(entity_ids, 1) = cluster_size),

  -- Valid status
  CONSTRAINT valid_cluster_status CHECK (status IN ('active', 'merged', 'split', 'ignored')),

  -- Valid entity types
  CONSTRAINT valid_cluster_entity_type CHECK (entity_type IN ('deal', 'vendor', 'contact'))
);

CREATE INDEX idx_duplicate_clusters_entity_type ON duplicate_clusters(entity_type);
CREATE INDEX idx_duplicate_clusters_status ON duplicate_clusters(status);
CREATE INDEX idx_duplicate_clusters_confidence ON duplicate_clusters(confidence_score DESC);
CREATE INDEX idx_duplicate_clusters_created_at ON duplicate_clusters(created_at DESC);
CREATE INDEX idx_duplicate_clusters_master ON duplicate_clusters(master_entity_id);

-- GIN index for entity_ids array queries
CREATE INDEX idx_duplicate_clusters_entity_ids ON duplicate_clusters USING GIN(entity_ids);

COMMENT ON TABLE duplicate_clusters IS 'Groups of duplicate entities identified through detection';
COMMENT ON COLUMN duplicate_clusters.cluster_key IS 'Deterministic key: pipe-separated sorted entity IDs';

-- ============================================================================
-- Table: merge_history
-- Purpose: Complete audit trail of all entity merges
-- ============================================================================

CREATE TABLE IF NOT EXISTS merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_type VARCHAR(20) NOT NULL,               -- manual, automatic
  entity_type VARCHAR(50) NOT NULL,
  source_entity_ids UUID[] NOT NULL,             -- Entities that were merged
  target_entity_id UUID NOT NULL,                -- Resulting merged entity
  merged_data JSONB NOT NULL,                    -- Complete merged data
  conflict_resolution JSONB DEFAULT '{}'::jsonb, -- How conflicts were resolved
  merge_strategy VARCHAR(50),                    -- newest, quality, weighted, manual
  merged_by VARCHAR(100) NOT NULL,               -- user_id or 'system'
  merged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  can_unmerge BOOLEAN DEFAULT true,              -- Whether unmerge is allowed
  unmerged BOOLEAN DEFAULT false,
  unmerged_at TIMESTAMP,
  unmerged_by VARCHAR(100),
  unmerge_reason TEXT,

  -- Ensure at least 2 source entities
  CONSTRAINT min_merge_sources CHECK (array_length(source_entity_ids, 1) >= 2),

  -- Valid merge type
  CONSTRAINT valid_merge_type CHECK (merge_type IN ('manual', 'automatic')),

  -- Valid entity type
  CONSTRAINT valid_merge_entity_type CHECK (entity_type IN ('deal', 'vendor', 'contact')),

  -- Valid merge strategy
  CONSTRAINT valid_merge_strategy CHECK (
    merge_strategy IN ('newest', 'quality', 'weighted', 'manual', 'first', 'complete')
  )
);

CREATE INDEX idx_merge_history_target ON merge_history(target_entity_id);
CREATE INDEX idx_merge_history_merged_at ON merge_history(merged_at DESC);
CREATE INDEX idx_merge_history_merged_by ON merge_history(merged_by);
CREATE INDEX idx_merge_history_entity_type ON merge_history(entity_type);
CREATE INDEX idx_merge_history_unmerged ON merge_history(unmerged);

-- GIN index for source_entity_ids array queries
CREATE INDEX idx_merge_history_source_ids ON merge_history USING GIN(source_entity_ids);

COMMENT ON TABLE merge_history IS 'Complete audit trail of all entity merge operations';
COMMENT ON COLUMN merge_history.merged_data IS 'JSONB snapshot of the merged entity data';
COMMENT ON COLUMN merge_history.conflict_resolution IS 'JSONB: {field: {chosen: value, reason: ...}}';

-- ============================================================================
-- Table: field_conflicts
-- Purpose: Track field-level conflicts during merges
-- ============================================================================

CREATE TABLE IF NOT EXISTS field_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_history_id UUID NOT NULL REFERENCES merge_history(id) ON DELETE CASCADE,
  field_name VARCHAR(100) NOT NULL,
  source_values JSONB NOT NULL,                  -- Array of {entityId, value, confidence}
  chosen_value TEXT,                             -- The value that was selected
  resolution_strategy VARCHAR(50),               -- source, target, complete, manual, etc.
  confidence DECIMAL(5,4),                       -- Confidence in the chosen value
  manual_override BOOLEAN DEFAULT false,         -- Was this manually selected?
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Valid resolution strategies
  CONSTRAINT valid_resolution_strategy CHECK (
    resolution_strategy IN ('source', 'target', 'complete', 'validated', 'manual', 'newest', 'merge_arrays')
  )
);

CREATE INDEX idx_field_conflicts_merge ON field_conflicts(merge_history_id);
CREATE INDEX idx_field_conflicts_field ON field_conflicts(field_name);
CREATE INDEX idx_field_conflicts_manual ON field_conflicts(manual_override);

COMMENT ON TABLE field_conflicts IS 'Tracks field-level conflicts encountered during merges';
COMMENT ON COLUMN field_conflicts.source_values IS 'JSONB: [{entityId, value, confidence, lastUpdated}, ...]';

-- ============================================================================
-- Views for Duplicate Detection
-- ============================================================================

-- High confidence duplicates ready for review or auto-merge
CREATE OR REPLACE VIEW high_confidence_duplicates AS
SELECT
  dd.id,
  dd.entity_type,
  dd.entity_id_1,
  dd.entity_id_2,
  dd.similarity_score,
  dd.confidence_level,
  dd.detection_strategy,
  dd.similarity_factors,
  dd.detected_at,
  CASE
    WHEN dd.confidence_level >= 0.95 THEN 'auto_merge'
    WHEN dd.confidence_level >= 0.85 THEN 'high_confidence'
    ELSE 'medium_confidence'
  END as recommendation
FROM duplicate_detections dd
WHERE
  dd.status = 'pending'
  AND dd.confidence_level >= 0.70
ORDER BY dd.confidence_level DESC, dd.detected_at DESC;

COMMENT ON VIEW high_confidence_duplicates IS 'Duplicates with confidence >= 0.70, sorted by confidence';

-- Duplicate cluster summary
CREATE OR REPLACE VIEW duplicate_clusters_summary AS
SELECT
  dc.id,
  dc.entity_type,
  dc.cluster_size,
  dc.confidence_score,
  dc.status,
  dc.created_at,
  dc.master_entity_id,
  CASE
    WHEN dc.status = 'merged' THEN 'Merged'
    WHEN dc.status = 'split' THEN 'Split/Rejected'
    WHEN dc.confidence_score >= 0.95 THEN 'Ready for Auto-Merge'
    WHEN dc.confidence_score >= 0.85 THEN 'Ready for Manual Review'
    ELSE 'Low Confidence'
  END as cluster_status_text
FROM duplicate_clusters dc
ORDER BY dc.confidence_score DESC, dc.created_at DESC;

COMMENT ON VIEW duplicate_clusters_summary IS 'Summary of all duplicate clusters with status indicators';

-- Merge statistics
CREATE OR REPLACE VIEW merge_statistics AS
SELECT
  mh.entity_type,
  COUNT(*) as total_merges,
  COUNT(*) FILTER (WHERE mh.merge_type = 'automatic') as automatic_merges,
  COUNT(*) FILTER (WHERE mh.merge_type = 'manual') as manual_merges,
  COUNT(*) FILTER (WHERE mh.unmerged = true) as unmerged_count,
  AVG(array_length(mh.source_entity_ids, 1)) as avg_entities_per_merge,
  MAX(mh.merged_at) as last_merge_at,
  COUNT(DISTINCT mh.merged_by) as unique_users
FROM merge_history mh
GROUP BY mh.entity_type;

COMMENT ON VIEW merge_statistics IS 'Aggregate statistics on merge operations by entity type';

-- Unresolved duplicates by entity type
CREATE OR REPLACE VIEW unresolved_duplicates AS
SELECT
  entity_type,
  COUNT(*) as pending_count,
  AVG(confidence_level) as avg_confidence,
  MAX(detected_at) as last_detected_at,
  COUNT(*) FILTER (WHERE confidence_level >= 0.95) as auto_merge_candidates,
  COUNT(*) FILTER (WHERE confidence_level >= 0.85 AND confidence_level < 0.95) as manual_review_candidates
FROM duplicate_detections
WHERE status = 'pending'
GROUP BY entity_type;

COMMENT ON VIEW unresolved_duplicates IS 'Count of unresolved duplicates by entity type';

-- Recent merge activity
CREATE OR REPLACE VIEW recent_merge_activity AS
SELECT
  mh.id,
  mh.entity_type,
  mh.merge_type,
  mh.target_entity_id,
  array_length(mh.source_entity_ids, 1) as source_count,
  mh.merge_strategy,
  mh.merged_by,
  mh.merged_at,
  mh.unmerged,
  (SELECT COUNT(*) FROM field_conflicts fc WHERE fc.merge_history_id = mh.id) as conflict_count
FROM merge_history mh
ORDER BY mh.merged_at DESC
LIMIT 100;

COMMENT ON VIEW recent_merge_activity IS 'Last 100 merge operations with summary information';

-- ============================================================================
-- Functions for Duplicate Management
-- ============================================================================

-- Function: log_duplicate_detection
-- Purpose: Log a duplicate detection result
CREATE OR REPLACE FUNCTION log_duplicate_detection(
  p_entity_type VARCHAR,
  p_entity_id_1 UUID,
  p_entity_id_2 UUID,
  p_similarity_score DECIMAL,
  p_confidence_level DECIMAL,
  p_detection_strategy VARCHAR,
  p_similarity_factors JSONB DEFAULT '{}'::jsonb,
  p_detected_by VARCHAR DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_id1 UUID;
  v_id2 UUID;
BEGIN
  -- Ensure entity_id_1 < entity_id_2 for consistent ordering
  IF p_entity_id_1 < p_entity_id_2 THEN
    v_id1 := p_entity_id_1;
    v_id2 := p_entity_id_2;
  ELSE
    v_id1 := p_entity_id_2;
    v_id2 := p_entity_id_1;
  END IF;

  INSERT INTO duplicate_detections (
    entity_type, entity_id_1, entity_id_2,
    similarity_score, confidence_level, detection_strategy,
    similarity_factors, detected_by
  ) VALUES (
    p_entity_type, v_id1, v_id2,
    p_similarity_score, p_confidence_level, p_detection_strategy,
    p_similarity_factors, p_detected_by
  )
  ON CONFLICT (entity_type, entity_id_1, entity_id_2)
  DO UPDATE SET
    similarity_score = p_similarity_score,
    confidence_level = p_confidence_level,
    detection_strategy = p_detection_strategy,
    similarity_factors = p_similarity_factors,
    detected_at = CURRENT_TIMESTAMP
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION log_duplicate_detection IS 'Log or update a duplicate detection result';

-- Function: create_duplicate_cluster
-- Purpose: Create or update a duplicate cluster
CREATE OR REPLACE FUNCTION create_duplicate_cluster(
  p_entity_type VARCHAR,
  p_entity_ids UUID[],
  p_confidence_score DECIMAL DEFAULT 0.85,
  p_master_entity_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_cluster_id UUID;
  v_cluster_key VARCHAR(500);
  v_cluster_size INTEGER;
  v_sorted_ids UUID[];
BEGIN
  -- Sort entity IDs for deterministic cluster key
  SELECT array_agg(id ORDER BY id) INTO v_sorted_ids
  FROM unnest(p_entity_ids) as id;

  -- Generate cluster key
  v_cluster_key := array_to_string(v_sorted_ids, '|');
  v_cluster_size := array_length(v_sorted_ids, 1);

  -- Ensure minimum cluster size
  IF v_cluster_size < 2 THEN
    RAISE EXCEPTION 'Cluster must have at least 2 entities';
  END IF;

  -- Insert or update cluster
  INSERT INTO duplicate_clusters (
    cluster_key, entity_type, entity_ids, master_entity_id,
    cluster_size, confidence_score
  ) VALUES (
    v_cluster_key, p_entity_type, v_sorted_ids, p_master_entity_id,
    v_cluster_size, p_confidence_score
  )
  ON CONFLICT (cluster_key)
  DO UPDATE SET
    entity_ids = v_sorted_ids,
    cluster_size = v_cluster_size,
    confidence_score = p_confidence_score,
    master_entity_id = p_master_entity_id,
    updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO v_cluster_id;

  RETURN v_cluster_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_duplicate_cluster IS 'Create or update a duplicate cluster';

-- Function: get_duplicate_candidates
-- Purpose: Get duplicate candidates for an entity
CREATE OR REPLACE FUNCTION get_duplicate_candidates(
  p_entity_id UUID,
  p_threshold DECIMAL DEFAULT 0.70,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  candidate_id UUID,
  similarity_score DECIMAL,
  confidence_level DECIMAL,
  detection_strategy VARCHAR,
  similarity_factors JSONB,
  detected_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN dd.entity_id_1 = p_entity_id THEN dd.entity_id_2
      ELSE dd.entity_id_1
    END as candidate_id,
    dd.similarity_score,
    dd.confidence_level,
    dd.detection_strategy,
    dd.similarity_factors,
    dd.detected_at
  FROM duplicate_detections dd
  WHERE
    (dd.entity_id_1 = p_entity_id OR dd.entity_id_2 = p_entity_id)
    AND dd.status = 'pending'
    AND dd.confidence_level >= p_threshold
  ORDER BY dd.confidence_level DESC, dd.detected_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_duplicate_candidates IS 'Get duplicate candidates for a specific entity';

-- Function: get_merge_statistics
-- Purpose: Get comprehensive merge statistics
CREATE OR REPLACE FUNCTION get_merge_statistics(
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  entity_type VARCHAR,
  total_merges BIGINT,
  automatic_merges BIGINT,
  manual_merges BIGINT,
  unmerged_count BIGINT,
  avg_entities_per_merge NUMERIC,
  avg_conflicts_per_merge NUMERIC,
  success_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    mh.entity_type,
    COUNT(*) as total_merges,
    COUNT(*) FILTER (WHERE mh.merge_type = 'automatic') as automatic_merges,
    COUNT(*) FILTER (WHERE mh.merge_type = 'manual') as manual_merges,
    COUNT(*) FILTER (WHERE mh.unmerged = true) as unmerged_count,
    AVG(array_length(mh.source_entity_ids, 1))::NUMERIC as avg_entities_per_merge,
    AVG((
      SELECT COUNT(*)::NUMERIC
      FROM field_conflicts fc
      WHERE fc.merge_history_id = mh.id
    )) as avg_conflicts_per_merge,
    (1 - (COUNT(*) FILTER (WHERE mh.unmerged = true)::NUMERIC / NULLIF(COUNT(*), 0))) * 100 as success_rate
  FROM merge_history mh
  WHERE
    mh.merged_at >= CURRENT_TIMESTAMP - (p_days || ' days')::INTERVAL
  GROUP BY mh.entity_type;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_merge_statistics IS 'Get merge statistics for the last N days';

-- Function: get_entity_merge_history
-- Purpose: Get complete merge history for an entity
CREATE OR REPLACE FUNCTION get_entity_merge_history(
  p_entity_id UUID
)
RETURNS TABLE (
  merge_id UUID,
  merge_type VARCHAR,
  merged_at TIMESTAMP,
  merged_by VARCHAR,
  was_source BOOLEAN,
  was_target BOOLEAN,
  source_count INTEGER,
  unmerged BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    mh.id as merge_id,
    mh.merge_type,
    mh.merged_at,
    mh.merged_by,
    p_entity_id = ANY(mh.source_entity_ids) as was_source,
    mh.target_entity_id = p_entity_id as was_target,
    array_length(mh.source_entity_ids, 1) as source_count,
    mh.unmerged
  FROM merge_history mh
  WHERE
    p_entity_id = mh.target_entity_id
    OR p_entity_id = ANY(mh.source_entity_ids)
  ORDER BY mh.merged_at DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_entity_merge_history IS 'Get complete merge history for a specific entity';

-- ============================================================================
-- Enhance existing tables for correlation tracking
-- ============================================================================

-- Add correlation columns to deal_registrations
ALTER TABLE deal_registrations
  ADD COLUMN IF NOT EXISTS source_file_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS correlation_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS correlation_confidence DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS is_primary_record BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_deals_correlation_key ON deal_registrations(correlation_key)
WHERE correlation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deals_source_files ON deal_registrations USING GIN(source_file_ids)
WHERE array_length(source_file_ids, 1) > 0;

COMMENT ON COLUMN deal_registrations.source_file_ids IS 'Array of source file IDs that contributed to this deal';
COMMENT ON COLUMN deal_registrations.correlation_key IS 'Key for linking same entity across sources';
COMMENT ON COLUMN deal_registrations.is_primary_record IS 'Whether this is the master record for correlated entities';

-- Add correlation columns to vendors
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS source_file_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS correlation_key VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_vendors_correlation_key ON vendors(correlation_key)
WHERE correlation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vendors_source_files ON vendors USING GIN(source_file_ids)
WHERE array_length(source_file_ids, 1) > 0;

-- Add correlation columns to contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source_file_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS correlation_key VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_contacts_correlation_key ON contacts(correlation_key)
WHERE correlation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_source_files ON contacts USING GIN(source_file_ids)
WHERE array_length(source_file_ids, 1) > 0;

-- ============================================================================
-- Views for Multi-Source Correlation
-- ============================================================================

-- Multi-source entities (entities found in multiple files)
CREATE OR REPLACE VIEW multi_source_entities AS
SELECT
  'deal' as entity_type,
  id as entity_id,
  array_length(source_file_ids, 1) as source_count,
  correlation_key,
  is_primary_record,
  source_file_ids
FROM deal_registrations
WHERE array_length(source_file_ids, 1) > 1
UNION ALL
SELECT
  'vendor' as entity_type,
  id as entity_id,
  array_length(source_file_ids, 1) as source_count,
  correlation_key,
  true as is_primary_record,
  source_file_ids
FROM vendors
WHERE array_length(source_file_ids, 1) > 1
UNION ALL
SELECT
  'contact' as entity_type,
  id as entity_id,
  array_length(source_file_ids, 1) as source_count,
  correlation_key,
  true as is_primary_record,
  source_file_ids
FROM contacts
WHERE array_length(source_file_ids, 1) > 1;

COMMENT ON VIEW multi_source_entities IS 'Entities found in multiple source files';

-- Correlation statistics
CREATE OR REPLACE VIEW correlation_statistics AS
SELECT
  entity_type,
  COUNT(*) as total_multi_source,
  AVG(source_count) as avg_sources_per_entity,
  MAX(source_count) as max_sources,
  COUNT(DISTINCT correlation_key) as unique_correlation_keys
FROM multi_source_entities
GROUP BY entity_type;

COMMENT ON VIEW correlation_statistics IS 'Statistics on multi-source entity correlation';

-- ============================================================================
-- Grant Permissions (adjust based on your user roles)
-- ============================================================================

-- Tables
GRANT SELECT, INSERT, UPDATE ON duplicate_detections TO PUBLIC;
GRANT SELECT, INSERT, UPDATE ON duplicate_clusters TO PUBLIC;
GRANT SELECT, INSERT, UPDATE ON merge_history TO PUBLIC;
GRANT SELECT, INSERT, UPDATE ON field_conflicts TO PUBLIC;

-- Views
GRANT SELECT ON high_confidence_duplicates TO PUBLIC;
GRANT SELECT ON duplicate_clusters_summary TO PUBLIC;
GRANT SELECT ON merge_statistics TO PUBLIC;
GRANT SELECT ON unresolved_duplicates TO PUBLIC;
GRANT SELECT ON recent_merge_activity TO PUBLIC;
GRANT SELECT ON multi_source_entities TO PUBLIC;
GRANT SELECT ON correlation_statistics TO PUBLIC;

-- Functions
GRANT EXECUTE ON FUNCTION log_duplicate_detection TO PUBLIC;
GRANT EXECUTE ON FUNCTION create_duplicate_cluster TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_duplicate_candidates TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_merge_statistics TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_entity_merge_history TO PUBLIC;

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Insert default configuration
DO $$
BEGIN
  RAISE NOTICE 'Migration 014 completed successfully';
  RAISE NOTICE 'Created tables: duplicate_detections, duplicate_clusters, merge_history, field_conflicts';
  RAISE NOTICE 'Created views: 7 views for duplicate and correlation tracking';
  RAISE NOTICE 'Created functions: 5 management functions';
  RAISE NOTICE 'Enhanced tables: deal_registrations, vendors, contacts (correlation tracking)';
END $$;
