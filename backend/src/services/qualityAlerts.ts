/**
 * Quality Alerts Service
 * 
 * Monitors data quality metrics and triggers alerts when thresholds are breached.
 */

import { query } from '../db';
import logger from '../utils/logger';
import { config } from '../config';
import { calculateDataQualityScore, identifyQualityIssues } from './qualityMetrics';

export interface QualityAlert {
    id: string;
    alertType: 'quality_drop' | 'duplicate_spike' | 'validation_failure_rate' | 'stale_data';
    severity: 'critical' | 'high' | 'medium' | 'low';
    entityType: 'deal' | 'vendor' | 'contact';
    threshold: number;
    currentValue: number;
    message: string;
    triggeredAt: Date;
    acknowledgedAt?: Date;
    acknowledgedBy?: string;
    resolved: boolean;
}

export interface AlertThresholds {
    qualityScoreMin: number;     // Alert if quality score drops below this (default: 0.7)
    duplicatePercentMax: number; // Alert if duplicate % exceeds this (default: 10)
    validationFailMax: number;   // Alert if validation failure rate exceeds (default: 20%)
    staleDaysMax: number;        // Alert if avg staleness exceeds days (default: 30)
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
    qualityScoreMin: 0.7,
    duplicatePercentMax: 10,
    validationFailMax: 20,
    staleDaysMax: 30,
};

/**
 * Check all quality metrics and generate alerts
 */
export async function checkQualityAlerts(
    entityType: 'deal' | 'vendor' | 'contact' = 'deal',
    thresholds: Partial<AlertThresholds> = {}
): Promise<QualityAlert[]> {
    const config = { ...DEFAULT_THRESHOLDS, ...thresholds };
    const alerts: QualityAlert[] = [];
    const now = new Date();

    try {
        // Get current quality score
        const qualityScore = await calculateDataQualityScore(entityType);

        // Check overall quality score
        if (qualityScore.overall < config.qualityScoreMin) {
            alerts.push({
                id: `alert_${Date.now()}_quality`,
                alertType: 'quality_drop',
                severity: qualityScore.overall < 0.5 ? 'critical' : 'high',
                entityType,
                threshold: config.qualityScoreMin,
                currentValue: qualityScore.overall,
                message: `${entityType} data quality score (${(qualityScore.overall * 100).toFixed(1)}%) dropped below threshold (${config.qualityScoreMin * 100}%)`,
                triggeredAt: now,
                resolved: false,
            });
        }

        // Check duplicate rate
        if (qualityScore.uniqueness < (100 - config.duplicatePercentMax) / 100) {
            const dupPercent = (1 - qualityScore.uniqueness) * 100;
            alerts.push({
                id: `alert_${Date.now()}_duplicates`,
                alertType: 'duplicate_spike',
                severity: dupPercent > 20 ? 'critical' : 'high',
                entityType,
                threshold: config.duplicatePercentMax,
                currentValue: dupPercent,
                message: `${entityType} duplicate rate (${dupPercent.toFixed(1)}%) exceeds threshold (${config.duplicatePercentMax}%)`,
                triggeredAt: now,
                resolved: false,
            });
        }

        // Check validation failure rate
        const failRate = 100 - (qualityScore.accuracy * 100);
        if (failRate > config.validationFailMax) {
            alerts.push({
                id: `alert_${Date.now()}_validation`,
                alertType: 'validation_failure_rate',
                severity: failRate > 40 ? 'critical' : 'medium',
                entityType,
                threshold: config.validationFailMax,
                currentValue: failRate,
                message: `${entityType} validation failure rate (${failRate.toFixed(1)}%) exceeds threshold (${config.validationFailMax}%)`,
                triggeredAt: now,
                resolved: false,
            });
        }

        // Check data staleness
        const staleScore = qualityScore.timeliness;
        if (staleScore < 0.5) { // More than half stale
            alerts.push({
                id: `alert_${Date.now()}_stale`,
                alertType: 'stale_data',
                severity: staleScore < 0.3 ? 'high' : 'medium',
                entityType,
                threshold: config.staleDaysMax,
                currentValue: Math.round((1 - staleScore) * 60), // Approximate days
                message: `${entityType} data staleness is high - ${((1 - staleScore) * 100).toFixed(0)}% of records haven't been updated recently`,
                triggeredAt: now,
                resolved: false,
            });
        }

        // Store alerts in database
        for (const alert of alerts) {
            await storeAlert(alert);
        }

        if (alerts.length > 0) {
            logger.warn(`Quality alerts triggered: ${alerts.length}`, {
                entityType,
                alertTypes: alerts.map(a => a.alertType),
            });
        }

        return alerts;
    } catch (error: any) {
        logger.error('Failed to check quality alerts', { error: error.message });
        throw error;
    }
}

/**
 * Store alert in database
 */
async function storeAlert(alert: QualityAlert): Promise<void> {
    try {
        await query(
            `INSERT INTO quality_alerts (
        id, alert_type, severity, entity_type, threshold_value, 
        current_value, message, triggered_at, resolved
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING`,
            [
                alert.id,
                alert.alertType,
                alert.severity,
                alert.entityType,
                alert.threshold,
                alert.currentValue,
                alert.message,
                alert.triggeredAt,
                alert.resolved,
            ]
        );
    } catch (error: any) {
        logger.debug('Alert storage skipped (table may not exist)', { error: error.message });
    }
}

/**
 * Get active (unresolved) alerts
 */
export async function getActiveAlerts(
    entityType?: 'deal' | 'vendor' | 'contact'
): Promise<QualityAlert[]> {
    try {
        let queryText = `
      SELECT * FROM quality_alerts 
      WHERE resolved = false
    `;
        const params: any[] = [];

        if (entityType) {
            queryText += ' AND entity_type = $1';
            params.push(entityType);
        }

        queryText += ' ORDER BY triggered_at DESC';

        const result = await query(queryText, params);
        return result.rows;
    } catch (error: any) {
        logger.debug('Could not fetch alerts', { error: error.message });
        return [];
    }
}

/**
 * Acknowledge an alert
 */
export async function acknowledgeAlert(
    alertId: string,
    acknowledgedBy: string
): Promise<boolean> {
    try {
        await query(
            `UPDATE quality_alerts 
       SET acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by = $2
       WHERE id = $1`,
            [alertId, acknowledgedBy]
        );
        return true;
    } catch (error: any) {
        logger.error('Failed to acknowledge alert', { alertId, error: error.message });
        return false;
    }
}

/**
 * Resolve an alert
 */
export async function resolveAlert(alertId: string): Promise<boolean> {
    try {
        await query(
            `UPDATE quality_alerts SET resolved = true WHERE id = $1`,
            [alertId]
        );
        return true;
    } catch (error: any) {
        logger.error('Failed to resolve alert', { alertId, error: error.message });
        return false;
    }
}

/**
 * Get alert summary statistics
 */
export async function getAlertStats(): Promise<{
    total: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    activeCount: number;
}> {
    try {
        const result = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE resolved = false) as active_count,
        severity,
        alert_type
      FROM quality_alerts
      GROUP BY severity, alert_type
    `);

        const bySeverity: Record<string, number> = {};
        const byType: Record<string, number> = {};
        let total = 0;
        let activeCount = 0;

        for (const row of result.rows) {
            bySeverity[row.severity] = (bySeverity[row.severity] || 0) + parseInt(row.total);
            byType[row.alert_type] = (byType[row.alert_type] || 0) + parseInt(row.total);
            total += parseInt(row.total);
            activeCount += parseInt(row.active_count);
        }

        return { total, bySeverity, byType, activeCount };
    } catch (error: any) {
        return { total: 0, bySeverity: {}, byType: {}, activeCount: 0 };
    }
}

export default {
    checkQualityAlerts,
    getActiveAlerts,
    acknowledgeAlert,
    resolveAlert,
    getAlertStats,
};
