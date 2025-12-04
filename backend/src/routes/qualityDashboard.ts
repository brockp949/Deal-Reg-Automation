/**
 * Quality Dashboard API Routes
 * 
 * Aggregates quality metrics for the frontend dashboard
 */

import { Router, Request, Response } from 'express';
import { calculateDataQualityScore } from '../services/qualityMetrics';
import { getAlertStats, getActiveAlerts } from '../services/qualityAlerts';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/quality/dashboard
 * Get aggregated quality dashboard data
 */
router.get('/dashboard', async (req: Request, res: Response) => {
    try {
        // Parallelize data fetching
        const [
            dealQuality,
            vendorQuality,
            contactQuality,
            alertStats,
            recentAlerts,
            trendData
        ] = await Promise.all([
            calculateDataQualityScore('deal'),
            calculateDataQualityScore('vendor'),
            calculateDataQualityScore('contact'),
            getAlertStats(),
            getActiveAlerts(),
            getQualityTrendData()
        ]);

        res.json({
            success: true,
            data: {
                scores: {
                    deal: dealQuality,
                    vendor: vendorQuality,
                    contact: contactQuality,
                    overall: (dealQuality.overall + vendorQuality.overall + contactQuality.overall) / 3
                },
                alerts: {
                    stats: alertStats,
                    recent: recentAlerts.slice(0, 5) // Top 5 recent alerts
                },
                trends: trendData,
                timestamp: new Date()
            }
        });
    } catch (error: any) {
        logger.error('Failed to fetch quality dashboard data', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Helper to get historical trend data (mock implementation for now)
 * In a real system, this would query a metrics history table
 */
async function getQualityTrendData() {
    // Return last 30 days of mock trend data
    const trends = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);

        // Simulate some realistic variation
        const baseScore = 0.85;
        const randomVar = (Math.random() * 0.1) - 0.05;

        trends.push({
            date: date.toISOString().split('T')[0],
            score: Math.min(1, Math.max(0, baseScore + randomVar)),
            issues: Math.floor(Math.random() * 5)
        });
    }

    return trends;
}

export default router;
