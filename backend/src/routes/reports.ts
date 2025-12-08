/**
 * Report API Routes
 */

import { Router, Request, Response } from 'express';
import { generateQualityReport, generatePerformanceReport } from '../services/reportService';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/reports/generate
 * Generate a report on demand
 */
router.post('/generate', async (req: Request, res: Response) => {
    try {
        const { type } = req.body;

        let report;
        if (type === 'quality') {
            report = await generateQualityReport();
        } else if (type === 'performance') {
            report = await generatePerformanceReport();
        } else {
            return res.status(400).json({ success: false, error: 'Invalid report type' });
        }

        res.json({
            success: true,
            data: report
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
