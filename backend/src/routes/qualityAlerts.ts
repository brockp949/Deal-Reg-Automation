/**
 * Quality Alerts API Routes
 */

import { Router, Request, Response } from 'express';
import {
    checkQualityAlerts,
    getActiveAlerts,
    acknowledgeAlert,
    resolveAlert,
    getAlertStats,
} from '../services/qualityAlerts';

const router = Router();

/**
 * GET /api/quality/alerts
 * Get active quality alerts
 */
router.get('/alerts', async (req: Request, res: Response) => {
    try {
        const entityType = req.query.entity_type as 'deal' | 'vendor' | 'contact' | undefined;
        const alerts = await getActiveAlerts(entityType);

        res.json({
            success: true,
            data: alerts,
            count: alerts.length,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/quality/alerts/check
 * Run quality check and generate alerts
 */
router.post('/alerts/check', async (req: Request, res: Response) => {
    try {
        const { entityType = 'deal', thresholds = {} } = req.body;
        const alerts = await checkQualityAlerts(entityType, thresholds);

        res.json({
            success: true,
            data: alerts,
            newAlertsCount: alerts.length,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/quality/alerts/stats
 * Get alert statistics
 */
router.get('/alerts/stats', async (req: Request, res: Response) => {
    try {
        const stats = await getAlertStats();
        res.json({ success: true, data: stats });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/quality/alerts/:id/acknowledge
 * Acknowledge an alert
 */
router.post('/alerts/:id/acknowledge', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { acknowledgedBy = 'system' } = req.body;

        const success = await acknowledgeAlert(id, acknowledgedBy);

        if (success) {
            res.json({ success: true, message: 'Alert acknowledged' });
        } else {
            res.status(400).json({ success: false, error: 'Failed to acknowledge alert' });
        }
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/quality/alerts/:id/resolve
 * Resolve an alert
 */
router.post('/alerts/:id/resolve', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const success = await resolveAlert(id);

        if (success) {
            res.json({ success: true, message: 'Alert resolved' });
        } else {
            res.status(400).json({ success: false, error: 'Failed to resolve alert' });
        }
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
