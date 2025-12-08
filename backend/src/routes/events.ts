import express, { Request, Response } from 'express';
import { processingEvents, ProcessingEvent } from '../services/processingEvents';
import logger from '../utils/logger';

const router = express.Router();

/**
 * Server-Sent Events endpoint for real-time processing updates
 * GET /api/events/processing/:fileId
 */
router.get('/processing/:fileId', (req: Request, res: Response) => {
  const { fileId } = req.params;

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Enable CORS for SSE
  res.setHeader('Access-Control-Allow-Origin', '*');

  logger.info(`SSE connection established for file ${fileId}`);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', fileId })}\n\n`);

  // Callback for sending events to this client
  const sendEvent = (event: ProcessingEvent) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
      logger.error('Error sending SSE event:', error);
    }
  };

  // Register this connection
  processingEvents.registerConnection(fileId, sendEvent);

  // Keep-alive ping every 30 seconds
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (error) {
      clearInterval(keepAliveInterval);
    }
  }, 30000);

  // Cleanup on connection close
  req.on('close', () => {
    logger.info(`SSE connection closed for file ${fileId}`);
    clearInterval(keepAliveInterval);
    processingEvents.unregisterConnection(fileId, sendEvent);
  });
});

/**
 * Get status of active SSE connections (for debugging)
 * GET /api/events/status
 */
router.get('/status', (req: Request, res: Response) => {
  const totalConnections = processingEvents.getActiveConnectionCount();

  res.json({
    success: true,
    data: {
      activeConnections: totalConnections,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
