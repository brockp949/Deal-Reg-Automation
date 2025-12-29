/**
 * Email Threads Routes
 * 
 * Provides endpoints for fetching email thread data for visualization.
 */

import { Router, Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { parseEnhancedMboxFile } from '../parsers/enhancedMboxMain';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/email-threads/by-file/:fileId
 * Fetch email thread data for a given source file
 */
router.get('/by-file/:fileId', async (req: Request, res: Response) => {
    try {
        const { fileId } = req.params;

        if (!fileId) {
            return res.status(400).json({
                success: false,
                error: 'File ID is required',
            });
        }

        // Get file info from database
        const fileResult = await query(
            'SELECT * FROM source_files WHERE id = $1',
            [fileId]
        );

        if (fileResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'File not found',
            });
        }

        const file = fileResult.rows[0];

        // Only support mbox files
        if (file.file_type !== 'mbox') {
            return res.status(400).json({
                success: false,
                error: 'Email threads are only available for MBOX files',
            });
        }

        // Check if file exists
        try {
            await readFile(file.storage_path);
        } catch {
            return res.status(404).json({
                success: false,
                error: 'Source file no longer exists on disk',
            });
        }

        // Re-parse the MBOX file to get thread data
        // (In production, you'd cache this in the database)
        const result = await parseEnhancedMboxFile(file.storage_path, {
            confidenceThreshold: 0.15,
        });

        // Transform threads to a frontend-friendly format
        const threads = result.threads.map((thread) => ({
            thread_id: thread.thread_id,
            subject_normalized: thread.subject_normalized,
            first_message_date: thread.first_message_date,
            last_message_date: thread.last_message_date,
            participant_emails: thread.participant_emails,
            messages: thread.messages.map((msg) => ({
                message_id: msg.message_id,
                from: msg.from,
                to: msg.to,
                cc: msg.cc,
                subject: msg.subject,
                date: msg.date,
                cleaned_body: msg.cleaned_body,
                tier1_matches: msg.tier1_matches,
                tier2_matches: msg.tier2_matches,
                tier3_matches: msg.tier3_matches,
            })),
        }));

        res.json({
            success: true,
            data: {
                fileId,
                fileName: file.filename,
                threadCount: threads.length,
                totalMessages: result.totalMessages,
                relevantMessages: result.relevantMessages,
                threads,
            },
        });
    } catch (error: any) {
        logger.error('Failed to fetch email threads', {
            fileId: req.params.fileId,
            error: error.message,
            stack: error.stack,
        });

        res.status(500).json({
            success: false,
            error: 'Failed to fetch email threads',
            message: error.message,
        });
    }
});

export default router;
