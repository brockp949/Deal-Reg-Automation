/**
 * Reprocessing API Routes
 * Endpoints for detailed re-analysis of uploaded files
 */

import { Router, Request, Response } from 'express';
import { performDetailedReprocessing } from '../services/detailedReprocessor';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/reprocess/detailed
 * Trigger detailed reprocessing of all uploaded files
 */
router.post('/detailed', async (req: Request, res: Response) => {
  try {
    logger.info('Detailed reprocessing triggered via API');

    // Start reprocessing in background (don't wait for completion)
    performDetailedReprocessing()
      .then(result => {
        logger.info('Detailed reprocessing completed', result);
      })
      .catch(error => {
        logger.error('Detailed reprocessing failed', { error: error.message });
      });

    res.status(202).json({
      message: 'Detailed reprocessing started. This may take several minutes.',
      status: 'processing'
    });
  } catch (error: any) {
    logger.error('Error starting detailed reprocessing', { error: error.message });
    res.status(500).json({
      error: 'Failed to start reprocessing',
      message: error.message
    });
  }
});

/**
 * GET /api/reprocess/status
 * Get status of current reprocessing job (if any)
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    // TODO: Implement job status tracking
    res.json({
      status: 'idle',
      message: 'No reprocessing job currently running'
    });
  } catch (error: any) {
    logger.error('Error getting reprocess status', { error: error.message });
    res.status(500).json({
      error: 'Failed to get status',
      message: error.message
    });
  }
});

export default router;
