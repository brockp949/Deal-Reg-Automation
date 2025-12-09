import { Router, Request, Response } from 'express';
import { requireRole } from '../api/middleware/apiKeyAuth';
import { addFileProcessingJob } from '../queues/fileProcessingQueue';
import logger from '../utils/logger';

const router = Router();

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
