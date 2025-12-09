import { Router, Request, Response } from 'express';
import { getQueueStats } from '../queues/fileProcessingQueue';
import { getJobStats } from '../services/jobTracker';
import { query } from '../db';
import { requireRole } from '../api/middleware/apiKeyAuth';

const router = Router();

type CacheEntry = {
  key: string;
  data: any;
  expiresAt: number;
};

const cache: CacheEntry = { key: '', data: null, expiresAt: 0 };
const CACHE_TTL_MS = 30_000;

/**
 * GET /api/ops/ingestion
 * Aggregated ingestion health snapshot for ops/UI.
 */
router.get('/ingestion', requireRole(['admin']), async (req: Request, res: Response) => {
  const limitParam = parseInt(req.query.limit as string, 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 50 ? limitParam : 10;
  const offsetParam = parseInt(req.query.offset as string, 10);
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 && offsetParam <= 500 ? offsetParam : 0;
  const stalledParam = parseInt(req.query.stalledThresholdMinutes as string, 10);
  const stalledThresholdMinutes =
    Number.isFinite(stalledParam) && stalledParam > 0 && stalledParam <= 240 ? stalledParam : 30;
  const trendHoursParam = parseInt(req.query.trendHours as string, 10);
  const trendHours = Number.isFinite(trendHoursParam) && trendHoursParam >= 1 && trendHoursParam <= 168 ? trendHoursParam : 48;

  const statusParam = (req.query.status as string | undefined) || '';
  const statuses = statusParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const cacheKey = JSON.stringify({
    limit,
    offset,
    statuses,
    stalledThresholdMinutes,
    trendHours,
  });

  const bypassCache = (req.query.bypassCache as string | undefined) === 'true';

  if (!bypassCache && cache.key === cacheKey && cache.expiresAt > Date.now()) {
    return res.json({ success: true, data: cache.data });
  }

  const [queue, jobs, recentFiles, failureTrends, successTrends, processingTrends, stalled] = await Promise.all([
    getQueueStats(),
    getJobStats(),
    fetchRecentFilesWithProvenance(limit, offset, statuses),
    getTrend(['failed', 'blocked'], trendHours),
    getTrend(['completed'], trendHours),
    getTrend(['processing', 'queued'], trendHours),
    getStalledCounts(stalledThresholdMinutes),
  ]);

  const [statusCounts, statusCounts24h] = await Promise.all([
    getStatusCounts(),
    getStatusCounts(24),
  ]);

  res.json({
    success: true,
    data: {
      queue,
      jobs,
      recentFiles,
      statusCounts,
      statusCounts24h,
      failureTrends,
      successTrends,
      processingTrends,
      stalled,
      stalledThresholdMinutes,
      trendHours,
    },
  });

  cache.key = cacheKey;
  cache.data = {
    queue,
    jobs,
    recentFiles,
    statusCounts,
    statusCounts24h,
    failureTrends,
    successTrends,
    processingTrends,
    stalled,
    stalledThresholdMinutes,
    trendHours,
    cachedAt: new Date().toISOString(),
    cacheTtlMs: CACHE_TTL_MS,
  };
  cache.expiresAt = Date.now() + CACHE_TTL_MS;
});

async function fetchRecentFilesWithProvenance(limit: number, offset: number, statuses: string[]) {
  const filters: string[] = [];
  const params: any[] = [];

  if (statuses.length > 0) {
    params.push(statuses);
    filters.push(`sf.processing_status = ANY($${params.length})`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await query(
    `SELECT
        sf.id,
        sf.filename,
        sf.processing_status,
        sf.error_message,
        COALESCE((sf.metadata->>'progress')::int, 0) AS progress,
        sf.metadata->'parserWarnings' AS parser_warnings,
        COALESCE(sf.metadata->'parserSourceTags', sf.metadata->'sourceTags') AS parser_source_tags,
        (SELECT COUNT(*) FROM field_provenance fp WHERE fp.source_file_id = sf.id) AS provenance_count,
        sf.processing_started_at,
        sf.processing_completed_at
     FROM source_files sf
     ${whereClause}
     ORDER BY sf.processing_started_at DESC NULLS LAST, sf.upload_date DESC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    filename: row.filename,
    status: row.processing_status,
    errorMessage: row.error_message,
    progress: row.progress ?? 0,
    parserWarnings: row.parser_warnings ?? [],
    parserSourceTags: row.parser_source_tags ?? [],
    provenanceCount: Number(row.provenance_count || 0),
    startedAt: row.processing_started_at,
    completedAt: row.processing_completed_at,
  }));
}

async function getStatusCounts(windowHours: number = 0) {
  const filters: string[] = [];
  const params: any[] = [];

  if (windowHours > 0) {
    filters.push(`sf.upload_date >= NOW() - INTERVAL '${windowHours} hours'`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await query(
    `SELECT processing_status, COUNT(*)::int AS count
     FROM source_files sf
     ${whereClause}
     GROUP BY processing_status`,
    params
  );
  const counts: Record<string, number> = {};
  result.rows.forEach((row: any) => {
    counts[row.processing_status || 'unknown'] = row.count;
  });
  return counts;
}

async function getTrend(statuses: string[], windowHours: number) {
  const result = await query(
    `SELECT
        date_trunc('hour', COALESCE(processing_completed_at, upload_date)) AS bucket,
        processing_status,
        COUNT(*)::int AS count
     FROM source_files
     WHERE processing_status = ANY($1::text[])
       AND COALESCE(processing_completed_at, upload_date) >= NOW() - ($2 || ' hours')::interval
     GROUP BY bucket, processing_status
     ORDER BY bucket DESC`,
    [statuses, windowHours]
  );

  return result.rows.map((row: any) => ({
    bucket: row.bucket,
    status: row.processing_status,
    count: row.count,
  }));
}

async function getStalledCounts(thresholdMinutes: number = 30) {
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM source_files
     WHERE processing_status = 'processing'
       AND processing_started_at IS NOT NULL
       AND processing_started_at <= NOW() - ($1 || ' minutes')::interval`,
    [thresholdMinutes]
  );

  return {
    processingOverThreshold: result.rows[0]?.count || 0,
    thresholdMinutes,
  };
}

export default router;
