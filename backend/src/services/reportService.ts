/**
 * Report Service
 * 
 * Generates and schedules quality and performance reports
 */

import { query } from '../db';
import logger from '../utils/logger';
import { calculateDataQualityScore } from './qualityMetrics';
import { getAlertStats } from './qualityAlerts';

export interface ReportConfig {
    id: string;
    name: string;
    type: 'quality' | 'performance' | 'audit';
    schedule: 'daily' | 'weekly' | 'monthly';
    recipients: string[];
    lastRun?: Date;
    nextRun?: Date;
    isActive: boolean;
}

/**
 * Generate a quality report
 */
export async function generateQualityReport(): Promise<any> {
    logger.info('Generating quality report');

    const [dealQuality, vendorQuality, contactQuality, alertStats] = await Promise.all([
        calculateDataQualityScore('deal'),
        calculateDataQualityScore('vendor'),
        calculateDataQualityScore('contact'),
        getAlertStats()
    ]);

    const report = {
        generatedAt: new Date(),
        summary: {
            overallScore: (dealQuality.overall + vendorQuality.overall + contactQuality.overall) / 3,
            totalAlerts: alertStats.total,
            activeAlerts: alertStats.activeCount
        },
        details: {
            dealQuality,
            vendorQuality,
            contactQuality,
            alerts: alertStats
        }
    };

    // In a real system, we would email this report or store it
    await logReportGeneration('quality', report);

    return report;
}

/**
 * Generate a performance report (mock implementation)
 */
export async function generatePerformanceReport(): Promise<any> {
    logger.info('Generating performance report');

    const report = {
        generatedAt: new Date(),
        metrics: {
            avgResponseTime: 120, // ms
            uptime: 99.9, // %
            requestsPerMinute: 450,
            errorRate: 0.05 // %
        }
    };

    await logReportGeneration('performance', report);

    return report;
}

/**
 * Log report generation
 */
async function logReportGeneration(type: string, data: any): Promise<void> {
    try {
        await query(
            `INSERT INTO generated_reports (type, data, created_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)`,
            [type, JSON.stringify(data)]
        );
    } catch (error) {
        // Ignore logging errors
    }
}

/**
 * Run scheduled reports (to be called by cron job)
 */
export async function runScheduledReports(): Promise<void> {
    try {
        // Get due reports
        const dueReports = await query(
            `SELECT * FROM report_configs 
       WHERE is_active = true AND (next_run <= CURRENT_TIMESTAMP OR next_run IS NULL)`
        );

        for (const config of dueReports.rows) {
            try {
                if (config.type === 'quality') {
                    await generateQualityReport();
                } else if (config.type === 'performance') {
                    await generatePerformanceReport();
                }

                // Update next run time
                const nextRun = calculateNextRun(config.schedule);
                await query(
                    `UPDATE report_configs SET last_run = CURRENT_TIMESTAMP, next_run = $1 WHERE id = $2`,
                    [nextRun, config.id]
                );

            } catch (error: any) {
                logger.error('Failed to run scheduled report', { reportId: config.id, error: error.message });
            }
        }
    } catch (error: any) {
        logger.error('Failed to check scheduled reports', { error: error.message });
    }
}

function calculateNextRun(schedule: string): Date {
    const now = new Date();
    if (schedule === 'daily') {
        now.setDate(now.getDate() + 1);
    } else if (schedule === 'weekly') {
        now.setDate(now.getDate() + 7);
    } else if (schedule === 'monthly') {
        now.setMonth(now.getMonth() + 1);
    }
    return now;
}

export default {
    generateQualityReport,
    generatePerformanceReport,
    runScheduledReports
};
