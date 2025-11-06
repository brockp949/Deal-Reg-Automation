import { Router, Request, Response } from 'express';
import { getQueueStats, getJobStatus, retryJob } from '../queues/fileProcessingQueue';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/queue/stats
 * Get queue statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getQueueStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    logger.error('Error getting queue stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get queue statistics',
    });
  }
});

/**
 * GET /api/queue/jobs/:jobId
 * Get job status
 */
router.get('/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const status = await getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    logger.error('Error getting job status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get job status',
    });
  }
});

/**
 * POST /api/queue/jobs/:jobId/retry
 * Retry a failed job
 */
router.post('/jobs/:jobId/retry', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    await retryJob(jobId);

    res.json({
      success: true,
      message: 'Job retry initiated',
    });
  } catch (error: any) {
    logger.error('Error retrying job', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retry job',
    });
  }
});

export default router;
