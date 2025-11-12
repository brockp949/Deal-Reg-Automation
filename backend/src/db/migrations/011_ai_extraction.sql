-- Phase 4.1: AI-Powered Entity Extraction
-- Adds tables and columns for AI extraction logging, caching, and usage tracking

-- AI extraction logs table
-- Tracks every AI extraction call with full context for debugging and improvement
CREATE TABLE IF NOT EXISTS ai_extraction_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id UUID REFERENCES source_files(id) ON DELETE SET NULL,
  extraction_type VARCHAR(50) NOT NULL, -- 'deal', 'vendor', 'contact', 'value', 'status', 'all'
  input_text TEXT NOT NULL,
  input_text_hash CHAR(64) NOT NULL, -- SHA-256 hash for caching and deduplication
  ai_model VARCHAR(50) NOT NULL, -- 'claude-3-5-sonnet-20241022', etc.
  prompt_template VARCHAR(100) NOT NULL, -- 'entity-extraction', 'deal-identification', etc.
  prompt_version VARCHAR(20) NOT NULL, -- 'v1.0.0'
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb, -- Full AI response
  extracted_entities JSONB NOT NULL DEFAULT '[]'::jsonb, -- Parsed entities array
  tokens_used INTEGER NOT NULL DEFAULT 0, -- Total tokens (input + output)
  extraction_time_ms INTEGER NOT NULL, -- Processing time in milliseconds
  confidence_score DECIMAL(3, 2), -- Average confidence across all entities (0.0-1.0)
  success BOOLEAN DEFAULT true, -- Whether extraction succeeded
  error_message TEXT, -- Error details if failed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ai_logs_source_file ON ai_extraction_logs(source_file_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_type ON ai_extraction_logs(extraction_type);
CREATE INDEX IF NOT EXISTS idx_ai_logs_hash ON ai_extraction_logs(input_text_hash);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_extraction_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_success ON ai_extraction_logs(success);
CREATE INDEX IF NOT EXISTS idx_ai_logs_model ON ai_extraction_logs(ai_model);

-- AI extraction cache table
-- Caches AI responses for identical inputs to save API costs
CREATE TABLE IF NOT EXISTS ai_extraction_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  input_hash CHAR(64) UNIQUE NOT NULL, -- SHA-256 hash of input text + extraction type + prompt version
  extraction_type VARCHAR(50) NOT NULL,
  prompt_version VARCHAR(20) NOT NULL,
  cached_response JSONB NOT NULL, -- The full AIExtractionResult to return
  hit_count INTEGER DEFAULT 1, -- How many times this cache entry was used
  last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for cache lookups
CREATE INDEX IF NOT EXISTS idx_ai_cache_hash ON ai_extraction_cache(input_hash);
CREATE INDEX IF NOT EXISTS idx_ai_cache_type ON ai_extraction_cache(extraction_type);
CREATE INDEX IF NOT EXISTS idx_ai_cache_last_used ON ai_extraction_cache(last_used_at);

-- AI usage statistics table
-- Daily aggregated statistics for monitoring and cost tracking
CREATE TABLE IF NOT EXISTS ai_usage_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE DEFAULT CURRENT_DATE NOT NULL,
  extraction_type VARCHAR(50) NOT NULL,
  total_requests INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cache_hits INTEGER DEFAULT 0,
  average_confidence DECIMAL(3, 2),
  success_rate DECIMAL(3, 2), -- Percentage of successful extractions (0.0-1.0)
  UNIQUE(date, extraction_type)
);

-- Index for time-series queries
CREATE INDEX IF NOT EXISTS idx_ai_stats_date ON ai_usage_stats(date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_stats_type ON ai_usage_stats(extraction_type);

-- Enhance extracted_entities table with AI metadata
-- Tracks which extraction method was used (regex, AI, manual) and AI-specific info
ALTER TABLE extracted_entities
  ADD COLUMN IF NOT EXISTS ai_model VARCHAR(50), -- Model used for AI extraction
  ADD COLUMN IF NOT EXISTS ai_prompt_version VARCHAR(20), -- Prompt version used
  ADD COLUMN IF NOT EXISTS extraction_method VARCHAR(50) DEFAULT 'regex', -- 'regex', 'ai', 'nlp', 'manual'
  ADD COLUMN IF NOT EXISTS extraction_metadata JSONB DEFAULT '{}'::jsonb, -- Additional extraction context
  ADD COLUMN IF NOT EXISTS ai_confidence_score DECIMAL(3, 2); -- AI confidence for this specific entity

-- Index for filtering by extraction method
CREATE INDEX IF NOT EXISTS idx_extracted_entities_method ON extracted_entities(extraction_method);

-- Enhance deal_registrations table with AI extraction tracking
-- Links deals back to their AI extraction logs
ALTER TABLE deal_registrations
  ADD COLUMN IF NOT EXISTS ai_extracted BOOLEAN DEFAULT false, -- Whether this was AI-extracted
  ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3, 2), -- Overall AI confidence for this deal
  ADD COLUMN IF NOT EXISTS extraction_log_id UUID REFERENCES ai_extraction_logs(id) ON DELETE SET NULL; -- Link to extraction log

-- Index for finding AI-extracted deals
CREATE INDEX IF NOT EXISTS idx_deals_ai_extracted ON deal_registrations(ai_extracted);
CREATE INDEX IF NOT EXISTS idx_deals_extraction_log ON deal_registrations(extraction_log_id);

-- View: Recent AI extractions with stats
-- Useful for monitoring and debugging
CREATE OR REPLACE VIEW recent_ai_extractions AS
SELECT
  ael.id,
  ael.extraction_type,
  ael.ai_model,
  ael.prompt_version,
  ael.tokens_used,
  ael.extraction_time_ms,
  ael.confidence_score,
  ael.success,
  ael.created_at,
  sf.filename AS source_filename,
  sf.file_type AS source_file_type,
  jsonb_array_length(ael.extracted_entities) AS entities_count
FROM ai_extraction_logs ael
LEFT JOIN source_files sf ON ael.source_file_id = sf.id
ORDER BY ael.created_at DESC
LIMIT 100;

-- View: AI extraction statistics summary
-- Aggregated stats for dashboards
CREATE OR REPLACE VIEW ai_extraction_stats_summary AS
SELECT
  extraction_type,
  COUNT(*) AS total_extractions,
  COUNT(*) FILTER (WHERE success = true) AS successful_extractions,
  COUNT(*) FILTER (WHERE success = false) AS failed_extractions,
  ROUND(AVG(confidence_score)::numeric, 2) AS avg_confidence,
  SUM(tokens_used) AS total_tokens,
  ROUND(AVG(extraction_time_ms)::numeric, 0) AS avg_time_ms,
  MIN(created_at) AS first_extraction,
  MAX(created_at) AS latest_extraction
FROM ai_extraction_logs
GROUP BY extraction_type;

-- View: AI cache effectiveness
-- Monitor cache hit rates
CREATE OR REPLACE VIEW ai_cache_effectiveness AS
SELECT
  extraction_type,
  COUNT(*) AS cached_entries,
  SUM(hit_count) AS total_hits,
  ROUND(AVG(hit_count)::numeric, 1) AS avg_hits_per_entry,
  MIN(created_at) AS oldest_cache_entry,
  MAX(last_used_at) AS most_recent_hit
FROM ai_extraction_cache
GROUP BY extraction_type;

-- Function: Clean up old AI logs
-- Keeps logs for 90 days by default, can be called with custom retention period
CREATE OR REPLACE FUNCTION cleanup_old_ai_logs(retention_days INTEGER DEFAULT 90)
RETURNS TABLE(deleted_logs BIGINT, deleted_cache BIGINT) AS $$
DECLARE
  deleted_logs_count BIGINT;
  deleted_cache_count BIGINT;
BEGIN
  -- Delete old logs
  DELETE FROM ai_extraction_logs
  WHERE created_at < CURRENT_DATE - retention_days * INTERVAL '1 day';
  GET DIAGNOSTICS deleted_logs_count = ROW_COUNT;

  -- Delete cache entries not used in retention period
  DELETE FROM ai_extraction_cache
  WHERE last_used_at < CURRENT_DATE - retention_days * INTERVAL '1 day';
  GET DIAGNOSTICS deleted_cache_count = ROW_COUNT;

  RETURN QUERY SELECT deleted_logs_count, deleted_cache_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update cache hit statistics
-- Automatically update usage stats when cache is hit
CREATE OR REPLACE FUNCTION update_cache_hit_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.hit_count > OLD.hit_count THEN
    -- Increment cache hits for today's stats
    INSERT INTO ai_usage_stats (date, extraction_type, cache_hits)
    VALUES (CURRENT_DATE, NEW.extraction_type, 1)
    ON CONFLICT (date, extraction_type)
    DO UPDATE SET cache_hits = ai_usage_stats.cache_hits + 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_cache_hit_stats
  AFTER UPDATE ON ai_extraction_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_cache_hit_stats();

-- Comments for documentation
COMMENT ON TABLE ai_extraction_logs IS 'Logs all AI extraction attempts with full context for debugging and improvement';
COMMENT ON TABLE ai_extraction_cache IS 'Caches AI responses to reduce API costs and improve performance';
COMMENT ON TABLE ai_usage_stats IS 'Daily aggregated statistics for monitoring AI usage and costs';
COMMENT ON COLUMN ai_extraction_logs.input_text_hash IS 'SHA-256 hash for deduplication and cache lookups';
COMMENT ON COLUMN ai_extraction_logs.confidence_score IS 'Average confidence across all extracted entities (0.0-1.0)';
COMMENT ON COLUMN ai_extraction_cache.hit_count IS 'Number of times this cached response was reused';
COMMENT ON VIEW recent_ai_extractions IS 'Recent AI extractions with basic stats for monitoring';
COMMENT ON VIEW ai_extraction_stats_summary IS 'Aggregated extraction statistics by type';
COMMENT ON VIEW ai_cache_effectiveness IS 'Cache performance metrics by extraction type';
COMMENT ON FUNCTION cleanup_old_ai_logs IS 'Deletes AI logs and cache entries older than specified retention period';
