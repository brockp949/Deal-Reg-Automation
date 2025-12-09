import { Router, Request, Response } from 'express';
import { getQueueStats } from '../queues/fileProcessingQueue';
import { getJobStats } from '../services/jobTracker';
import { poolMetrics } from '../utils/poolMetrics';
import { metricsRegistry } from '../utils/metricsRegistry';

const router = Router();

/**
 * GET /api/dashboard/ingestion
 * Lightweight dashboard payload combining queue/job/db/custom metrics.
 */
router.get('/ingestion', async (_req: Request, res: Response) => {
  const [queue, jobs] = await Promise.all([getQueueStats(), getJobStats()]);
  const db = poolMetrics();
  const custom = metricsRegistry.snapshot();

  res.json({
    success: true,
    data: {
      queue,
      jobs,
      db,
      custom,
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
});

export default router;
