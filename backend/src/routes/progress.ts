/**
 * Progress Routes - Server-Sent Events for Real-time Progress
 *
 * Provides SSE endpoints for real-time progress updates during file processing.
 */

import { Router, Request, Response } from 'express';
import { subscribeToProgress, findJobByFileId, getUnifiedQueueStats } from '../queues/unifiedProcessingQueue';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/progress/:fileId
 * Server-Sent Events endpoint for real-time progress updates
 */
router.get('/:fileId', async (req: Request, res: Response) => {
  const { fileId } = req.params;

  // Validate file exists
  const fileResult = await query('SELECT id, filename, processing_status FROM source_files WHERE id = $1', [fileId]);
  if (fileResult.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }

  const file = fileResult.rows[0];

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // Disable nginx buffering

  // Send initial status
  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send current status
  sendEvent('status', {
    fileId,
    filename: file.filename,
    status: file.processing_status,
  });

  // If already completed or failed, send final status and close
  if (file.processing_status === 'completed' || file.processing_status === 'failed') {
    const fullFile = await query('SELECT * FROM source_files WHERE id = $1', [fileId]);
    sendEvent('complete', {
      fileId,
      status: file.processing_status,
      result: fullFile.rows[0].metadata?.result,
      error: fullFile.rows[0].error_message,
    });
    res.end();
    return;
  }

  // Subscribe to progress events
  const unsubscribe = subscribeToProgress(fileId, (event) => {
    sendEvent('progress', event);

    // Close connection when complete or failed
    if (event.stage === 'completed' || event.stage === 'failed') {
      setTimeout(() => {
        res.end();
      }, 100);
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    unsubscribe();
    logger.debug('SSE client disconnected', { fileId });
  });

  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });

  logger.info('SSE progress connection established', { fileId });
});

/**
 * GET /api/progress/:fileId/status
 * Get current processing status (non-SSE)
 */
router.get('/:fileId/status', async (req: Request, res: Response) => {
  const { fileId } = req.params;

  try {
    const fileResult = await query(
      `SELECT id, filename, file_type, processing_status, error_message,
              upload_intent, detected_intent, parser_used,
              metadata, processing_started_at, processing_completed_at
       FROM source_files WHERE id = $1`,
      [fileId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const file = fileResult.rows[0];

    // Get job status from queue
    const jobStatus = await findJobByFileId(fileId);

    res.json({
      success: true,
      data: {
        fileId: file.id,
        filename: file.filename,
        fileType: file.file_type,
        status: file.processing_status,
        intent: file.upload_intent,
        detectedIntent: file.detected_intent,
        parserUsed: file.parser_used,
        progress: file.metadata?.progress || 0,
        result: file.metadata?.result,
        error: file.error_message,
        startedAt: file.processing_started_at,
        completedAt: file.processing_completed_at,
        job: jobStatus,
      },
    });
  } catch (error: any) {
    logger.error('Error getting progress status', { fileId, error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

/**
 * GET /api/progress/queue/stats
 * Get queue statistics
 */
router.get('/queue/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getUnifiedQueueStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    logger.error('Error getting queue stats', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get queue stats' });
  }
});

/**
 * GET /api/progress/files/processing
 * Get all files currently being processed
 */
router.get('/files/processing', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, filename, file_type, processing_status, upload_intent,
              metadata->>'progress' as progress,
              processing_started_at
       FROM source_files
       WHERE processing_status IN ('pending', 'processing')
       ORDER BY upload_date DESC
       LIMIT 50`
    );

    res.json({
      success: true,
      data: result.rows.map(row => ({
        fileId: row.id,
        filename: row.filename,
        fileType: row.file_type,
        status: row.processing_status,
        intent: row.upload_intent,
        progress: parseInt(row.progress) || 0,
        startedAt: row.processing_started_at,
      })),
    });
  } catch (error: any) {
    logger.error('Error getting processing files', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get processing files' });
  }
});

export default router;
