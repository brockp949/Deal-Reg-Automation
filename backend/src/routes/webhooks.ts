/**
 * Webhook API Routes
 */

import { Router, Request, Response } from 'express';
import { subscribeToWebhooks, triggerWebhook } from '../services/webhookService';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/webhooks/subscribe
 * Subscribe to webhook events
 */
router.post('/subscribe', async (req: Request, res: Response) => {
    try {
        const { url, events, secret } = req.body;

        if (!url || !events || !Array.isArray(events)) {
            return res.status(400).json({
                success: false,
                error: 'url and events array are required'
            });
        }

        const subscription = await subscribeToWebhooks(url, events, secret);

        res.json({
            success: true,
            data: subscription
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/webhooks/test
 * Test webhook trigger (admin only)
 */
router.post('/test', async (req: Request, res: Response) => {
    try {
        const { eventType, payload } = req.body;

        await triggerWebhook(eventType || 'test.event', payload || { message: 'Test webhook' });

        res.json({
            success: true,
            message: 'Test webhook triggered'
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
