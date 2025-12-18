/**
 * Monitoring API Routes
 *
 * Provides upload and processing metrics for the monitoring dashboard:
 * - Upload statistics (success rates, timing, chunked uploads)
 * - Processing performance (parallel processing speedup, throughput)
 * - Recent upload history
 * - System health indicators
 */

import { Router, Request, Response } from 'express';
import pool from '../db';
import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';

const router = Router();

// Redis client for upload metadata
const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

/**
 * GET /api/monitoring/metrics
 * Returns comprehensive metrics for the monitoring dashboard
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const timeRange = req.query.timeRange || '24h'; // 24h, 7d, 30d
    const timeRangeHours = parseTimeRange(timeRange as string);

    // Run all queries in parallel for performance
    const [uploadMetrics, processingMetrics, recentUploads, systemHealth] = await Promise.all([
      getUploadMetrics(timeRangeHours),
      getProcessingMetrics(timeRangeHours),
      getRecentUploads(20),
      getSystemHealth(),
    ]);

    res.json({
      success: true,
      data: {
        uploads: uploadMetrics,
        processing: processingMetrics,
        recent: recentUploads,
        health: systemHealth,
        timeRange,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching monitoring metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch monitoring metrics',
      message: error.message,
    });
  }
});

/**
 * GET /api/monitoring/upload-stats
 * Returns detailed upload statistics
 */
router.get('/upload-stats', async (req: Request, res: Response) => {
  try {
    const timeRange = req.query.timeRange || '24h';
    const timeRangeHours = parseTimeRange(timeRange as string);
    const uploadMetrics = await getUploadMetrics(timeRangeHours);

    res.json({
      success: true,
      data: uploadMetrics,
    });
  } catch (error: any) {
    logger.error('Error fetching upload stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch upload stats',
      message: error.message,
    });
  }
});

/**
 * GET /api/monitoring/processing-stats
 * Returns detailed processing performance statistics
 */
router.get('/processing-stats', async (req: Request, res: Response) => {
  try {
    const timeRange = req.query.timeRange || '24h';
    const timeRangeHours = parseTimeRange(timeRange as string);
    const processingMetrics = await getProcessingMetrics(timeRangeHours);

    res.json({
      success: true,
      data: processingMetrics,
    });
  } catch (error: any) {
    logger.error('Error fetching processing stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch processing stats',
      message: error.message,
    });
  }
});

/**
 * GET /api/monitoring/recent-uploads
 * Returns recent upload history
 */
router.get('/recent-uploads', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const recentUploads = await getRecentUploads(limit);

    res.json({
      success: true,
      data: recentUploads,
    });
  } catch (error: any) {
    logger.error('Error fetching recent uploads:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent uploads',
      message: error.message,
    });
  }
});

/**
 * GET /api/monitoring/health
 * Returns system health status
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await getSystemHealth();

    res.json({
      success: true,
      data: health,
    });
  } catch (error: any) {
    logger.error('Error fetching system health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch system health',
      message: error.message,
    });
  }
});

// Helper Functions

/**
 * Parse time range string to hours
 */
function parseTimeRange(range: string): number {
  const match = range.match(/^(\d+)([hdw])$/);
  if (!match) return 24; // Default to 24 hours

  const [, value, unit] = match;
  const num = parseInt(value);

  switch (unit) {
    case 'h':
      return num;
    case 'd':
      return num * 24;
    case 'w':
      return num * 24 * 7;
    default:
      return 24;
  }
}

/**
 * Get upload metrics (success rates, timing, chunked uploads)
 */
async function getUploadMetrics(timeRangeHours: number) {
  const query = `
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN metadata->>'isChunkedUpload' = 'true' THEN 1 END) as chunked_uploads,
      COUNT(CASE WHEN status = 'completed' AND metadata->>'isChunkedUpload' = 'true' THEN 1 END) as chunked_successful,
      AVG(CASE
        WHEN status = 'completed' AND metadata->>'uploadTimeMs' IS NOT NULL
        THEN (metadata->>'uploadTimeMs')::numeric
      END) as avg_upload_time_ms
    FROM uploaded_files
    WHERE created_at >= NOW() - INTERVAL '${timeRangeHours} hours'
  `;

  const result = await pool.query(query);
  const row = result.rows[0];

  const total = parseInt(row.total) || 0;
  const successful = parseInt(row.successful) || 0;
  const failed = parseInt(row.failed) || 0;
  const chunkedUploads = parseInt(row.chunked_uploads) || 0;
  const chunkedSuccessful = parseInt(row.chunked_successful) || 0;
  const avgUploadTimeMs = parseFloat(row.avg_upload_time_ms) || 0;

  const successRate = total > 0 ? (successful / total) * 100 : 0;
  const chunkedSuccessRate = chunkedUploads > 0 ? (chunkedSuccessful / chunkedUploads) * 100 : 0;

  return {
    total,
    successful,
    failed,
    successRate: Math.round(successRate * 10) / 10,
    avgUploadTime: formatDuration(avgUploadTimeMs),
    avgUploadTimeMs,
    chunkedUploads,
    chunkedSuccessRate: Math.round(chunkedSuccessRate * 10) / 10,
  };
}

/**
 * Get processing performance metrics (parallel processing, throughput)
 */
async function getProcessingMetrics(timeRangeHours: number) {
  const query = `
    SELECT
      COUNT(*) as total_files,
      COUNT(CASE WHEN metadata->>'usedParallelProcessing' = 'true' THEN 1 END) as parallel_processed,
      AVG(CASE
        WHEN status = 'completed' AND metadata->>'processingTimeMs' IS NOT NULL
        THEN (metadata->>'processingTimeMs')::numeric
      END) as avg_processing_time_ms,
      AVG(CASE
        WHEN status = 'completed' AND metadata->>'usedParallelProcessing' = 'true' AND metadata->>'speedup' IS NOT NULL
        THEN (metadata->>'speedup')::numeric
      END) as avg_speedup,
      SUM(CASE
        WHEN metadata->>'recordsProcessed' IS NOT NULL
        THEN (metadata->>'recordsProcessed')::numeric
        ELSE 0
      END) as total_records,
      AVG(CASE
        WHEN status = 'completed' AND metadata->>'recordsProcessed' IS NOT NULL AND metadata->>'processingTimeMs' IS NOT NULL
        THEN (metadata->>'recordsProcessed')::numeric / ((metadata->>'processingTimeMs')::numeric / 1000.0)
      END) as avg_records_per_second
    FROM uploaded_files
    WHERE created_at >= NOW() - INTERVAL '${timeRangeHours} hours'
      AND status = 'completed'
  `;

  const result = await pool.query(query);
  const row = result.rows[0];

  const totalFiles = parseInt(row.total_files) || 0;
  const parallelProcessed = parseInt(row.parallel_processed) || 0;
  const avgProcessingTimeMs = parseFloat(row.avg_processing_time_ms) || 0;
  const avgSpeedup = parseFloat(row.avg_speedup) || 0;
  const totalRecords = parseInt(row.total_records) || 0;
  const avgRecordsPerSecond = parseFloat(row.avg_records_per_second) || 0;

  return {
    totalFiles,
    avgProcessingTime: formatDuration(avgProcessingTimeMs),
    avgProcessingTimeMs,
    parallelProcessed,
    parallelSpeedup: avgSpeedup > 0 ? `${avgSpeedup.toFixed(1)}x` : 'N/A',
    recordsProcessed: totalRecords,
    avgRecordsPerSecond: Math.round(avgRecordsPerSecond),
  };
}

/**
 * Get recent upload history
 */
async function getRecentUploads(limit: number) {
  const query = `
    SELECT
      id,
      filename,
      file_size as size,
      status,
      error_message,
      created_at,
      metadata
    FROM uploaded_files
    ORDER BY created_at DESC
    LIMIT $1
  `;

  const result = await pool.query(query, [limit]);

  return result.rows.map((row: any) => {
    const metadata = row.metadata || {};
    const uploadTimeMs = parseFloat(metadata.uploadTimeMs) || 0;
    const processingTimeMs = parseFloat(metadata.processingTimeMs) || 0;
    const recordsProcessed = parseInt(metadata.recordsProcessed) || 0;
    const isChunkedUpload = metadata.isChunkedUpload === true || metadata.isChunkedUpload === 'true';

    return {
      fileName: row.filename,
      size: formatBytes(row.size),
      uploadTime: formatDuration(uploadTimeMs),
      processingTime: formatDuration(processingTimeMs),
      recordsProcessed,
      status: row.status,
      isChunked: isChunkedUpload,
      timestamp: formatTimestamp(row.created_at),
      error: row.error_message || undefined,
    };
  });
}

/**
 * Get system health status
 */
async function getSystemHealth() {
  const health = {
    redis: { status: 'unknown', details: '' },
    database: { status: 'unknown', details: '' },
    queue: { status: 'unknown', details: '' },
    storage: { status: 'unknown', details: '' },
  };

  // Check Redis connection
  try {
    const pong = await redis.ping();
    if (pong === 'PONG') {
      health.redis.status = 'healthy';
      health.redis.details = 'Connected';
    } else {
      health.redis.status = 'degraded';
      health.redis.details = 'Unexpected ping response';
    }
  } catch (error: any) {
    health.redis.status = 'unhealthy';
    health.redis.details = error.message;
  }

  // Check database connection
  try {
    const result = await pool.query('SELECT 1');
    if (result.rowCount === 1) {
      health.database.status = 'healthy';
      health.database.details = 'Connected';
    } else {
      health.database.status = 'degraded';
      health.database.details = 'Unexpected query result';
    }
  } catch (error: any) {
    health.database.status = 'unhealthy';
    health.database.details = error.message;
  }

  // Check queue (Bull uses Redis, so if Redis is healthy, queue should be too)
  if (health.redis.status === 'healthy') {
    health.queue.status = 'healthy';
    health.queue.details = 'Active';
  } else {
    health.queue.status = health.redis.status;
    health.queue.details = 'Depends on Redis';
  }

  // Check storage (simple check - could be enhanced to check actual disk space)
  health.storage.status = 'healthy';
  health.storage.details = 'Available';

  return health;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format duration (milliseconds) to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);

  if (seconds > 0) {
    return `${minutes}.${Math.round(seconds / 6)}min`;
  }
  return `${minutes}min`;
}

/**
 * Format timestamp to relative time
 */
function formatTimestamp(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export default router;
