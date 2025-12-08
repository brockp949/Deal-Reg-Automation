/**
 * File Progress SSE (Server-Sent Events) Routes
 * 
 * Real-time streaming of file processing progress
 */

import { Router, Request, Response } from 'express';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router();

// Store active SSE connections
const activeConnections = new Map<string, Response>();

/**
 * GET /api/files/progress/:fileId
 * Server-Sent Events endpoint for real-time progress updates
 */
router.get('/progress/:fileId', async (req: Request, res: Response) => {
    const { fileId } = req.params;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ fileId, message: 'Connected to progress stream' })}\n\n`);

    // Store connection
    activeConnections.set(fileId, res);

    logger.debug('SSE connection established', { fileId });

    // Poll for progress updates
    const intervalId = setInterval(async () => {
        try {
            const result = await query(
                `SELECT processing_status, metadata, error_message FROM source_files WHERE id = $1`,
                [fileId]
            );

            if (result.rows.length === 0) {
                res.write(`event: error\ndata: ${JSON.stringify({ error: 'File not found' })}\n\n`);
                clearInterval(intervalId);
                res.end();
                return;
            }

            const file = result.rows[0];
            const progress = file.metadata?.progress || 0;
            const status = file.processing_status;

            // Send progress event
            res.write(`event: progress\ndata: ${JSON.stringify({
                fileId,
                status,
                progress,
                timestamp: new Date().toISOString(),
            })}\n\n`);

            // Check if processing is complete
            if (status === 'completed' || status === 'failed') {
                res.write(`event: complete\ndata: ${JSON.stringify({
                    fileId,
                    status,
                    progress: status === 'completed' ? 100 : progress,
                    error: file.error_message,
                    timestamp: new Date().toISOString(),
                })}\n\n`);

                clearInterval(intervalId);
                activeConnections.delete(fileId);
                res.end();
            }
        } catch (error: any) {
            logger.error('Error polling file progress', { fileId, error: error.message });
        }
    }, 1000); // Poll every second

    // Handle client disconnect
    req.on('close', () => {
        clearInterval(intervalId);
        activeConnections.delete(fileId);
        logger.debug('SSE connection closed', { fileId });
    });
});

/**
 * Broadcast progress update to connected clients (called from file processor)
 */
export function broadcastProgress(fileId: string, progress: number, status: string): void {
    const connection = activeConnections.get(fileId);
    if (connection) {
        try {
            connection.write(`event: progress\ndata: ${JSON.stringify({
                fileId,
                status,
                progress,
                timestamp: new Date().toISOString(),
            })}\n\n`);
        } catch (error) {
            activeConnections.delete(fileId);
        }
    }
}

/**
 * Get count of active SSE connections
 */
export function getActiveConnectionCount(): number {
    return activeConnections.size;
}

export default router;
