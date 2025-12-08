/**
 * Merge Audit API Routes
 */

import { Router, Request, Response } from 'express';
import { exportMergeHistory } from '../services/mergeAudit';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/merge/audit/export
 * Export merge history as CSV
 */
router.get('/audit/export', async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, mergedBy, entityType } = req.query;

        const filter = {
            startDate: startDate ? new Date(startDate as string) : undefined,
            endDate: endDate ? new Date(endDate as string) : undefined,
            mergedBy: mergedBy as string,
            entityType: entityType as string
        };

        const csv = await exportMergeHistory(filter);

        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="merge-audit-${Date.now()}.csv"`);
        res.send(csv);

    } catch (error: any) {
        logger.error('Failed to export merge audit', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
