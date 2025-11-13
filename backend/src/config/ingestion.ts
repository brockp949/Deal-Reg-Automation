/**
 * Ingestion Configuration - Phase 1
 * Centralized configuration for MBOX ingestion and processing
 */

export interface IngestionConfig {
  ingestion: {
    chunk_size_mb: number;
    chunk_output_dir: string;
    max_parallel_workers: number;
    resume_on_failure: boolean;
  };
  gmail_filter: {
    min_priority_score: number;
    high_value_labels: Array<{ label: string; score: number }>;
    low_value_labels: Array<{ label: string; score: number }>;
  };
  performance: {
    buffer_size_kb: number;
    max_memory_mb: number;
    io_timeout_seconds: number;
  };
  file_locks: {
    timeout_ms: number;
    retry_interval_ms: number;
    stale_lock_timeout_ms: number;
  };
}

export const DEFAULT_INGESTION_CONFIG: IngestionConfig = {
  ingestion: {
    chunk_size_mb: 500,
    chunk_output_dir: './data/chunks',
    max_parallel_workers: 4,
    resume_on_failure: true,
  },
  gmail_filter: {
    min_priority_score: 30,
    high_value_labels: [
      { label: 'SENT', score: 50 },
      { label: 'IMPORTANT', score: 40 },
      { label: 'INBOX', score: 30 },
      { label: 'STARRED', score: 25 },
      { label: 'CATEGORY_PRIMARY', score: 20 },
    ],
    low_value_labels: [
      { label: 'SPAM', score: -100 },
      { label: 'TRASH', score: -100 },
      { label: 'CATEGORY_PROMOTIONS', score: -30 },
      { label: 'CATEGORY_FORUMS', score: -20 },
      { label: 'CATEGORY_SOCIAL', score: -15 },
      { label: 'CATEGORY_UPDATES', score: -10 },
      { label: 'DRAFT', score: -5 },
    ],
  },
  performance: {
    buffer_size_kb: 4,
    max_memory_mb: 500,
    io_timeout_seconds: 30,
  },
  file_locks: {
    timeout_ms: 30000,
    retry_interval_ms: 100,
    stale_lock_timeout_ms: 300000,
  },
};

/**
 * Get ingestion config with overrides
 */
export function getIngestionConfig(
  overrides?: Partial<IngestionConfig>
): IngestionConfig {
  if (!overrides) {
    return DEFAULT_INGESTION_CONFIG;
  }

  return {
    ingestion: {
      ...DEFAULT_INGESTION_CONFIG.ingestion,
      ...(overrides.ingestion || {}),
    },
    gmail_filter: {
      ...DEFAULT_INGESTION_CONFIG.gmail_filter,
      ...(overrides.gmail_filter || {}),
    },
    performance: {
      ...DEFAULT_INGESTION_CONFIG.performance,
      ...(overrides.performance || {}),
    },
    file_locks: {
      ...DEFAULT_INGESTION_CONFIG.file_locks,
      ...(overrides.file_locks || {}),
    },
  };
}

/**
 * Environment-based configuration loader
 */
export function loadIngestionConfigFromEnv(): IngestionConfig {
  const config = { ...DEFAULT_INGESTION_CONFIG };

  // Load from environment variables if present
  if (process.env.CHUNK_SIZE_MB) {
    config.ingestion.chunk_size_mb = parseInt(process.env.CHUNK_SIZE_MB, 10);
  }

  if (process.env.CHUNK_OUTPUT_DIR) {
    config.ingestion.chunk_output_dir = process.env.CHUNK_OUTPUT_DIR;
  }

  if (process.env.MAX_PARALLEL_WORKERS) {
    config.ingestion.max_parallel_workers = parseInt(
      process.env.MAX_PARALLEL_WORKERS,
      10
    );
  }

  if (process.env.MIN_PRIORITY_SCORE) {
    config.gmail_filter.min_priority_score = parseInt(
      process.env.MIN_PRIORITY_SCORE,
      10
    );
  }

  if (process.env.MAX_MEMORY_MB) {
    config.performance.max_memory_mb = parseInt(
      process.env.MAX_MEMORY_MB,
      10
    );
  }

  return config;
}
