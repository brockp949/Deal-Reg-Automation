import { Router, Request, Response } from 'express';
import { requireRole } from '../api/middleware/apiKeyAuth';
import { addFileProcessingJob } from '../queues/fileProcessingQueue';
import { performDetailedReprocessing } from '../services/detailedReprocessor';
import { createJob, startJob, updateJobProgress, completeJob, failJob } from '../services/jobTracker';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/reprocess/detailed
 * Trigger detailed reprocessing of all eligible files.
 */
router.post('/detailed', requireRole(['write', 'admin']), async (req: Request, res: Response) => {
  try {
    const jobId = createJob('reprocess', { mode: 'detailed' });

    res.status(202).json({
      success: true,
      message: 'Detailed reprocessing started',
      data: { jobId },
    });

    setImmediate(async () => {
      try {
        startJob(jobId, 'Detailed reprocessing running');
        const result = await performDetailedReprocessing({
          onProgress: (progress, message) => updateJobProgress(jobId, progress, message),
        });
        completeJob(jobId, result);
      } catch (error: any) {
        logger.error('Detailed reprocessing failed', { error: error.message });
        failJob(jobId, error.message);
      }
    });
  } catch (error: any) {
    logger.error('Failed to start detailed reprocessing', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to start detailed reprocessing' });
  }
});

/**
 * POST /api/reprocess/:fileId
 * Requeue a file for processing (admin only).
 */
router.post('/:fileId', requireRole(['admin']), async (req: Request, res: Response) => {
  const { fileId } = req.params;

  if (!fileId) {
    return res.status(400).json({ success: false, error: 'fileId required' });
  }

  try {
    const job = await addFileProcessingJob(fileId);
    logger.info('File reprocess requested', { fileId, jobId: job.id });
    res.json({ success: true, data: { jobId: job.id, fileId } });
  } catch (error: any) {
    logger.error('Failed to reprocess file', { fileId, error: error.message });
    res.status(500).json({ success: false, error: 'Failed to reprocess file' });
  }
});

export default router;
