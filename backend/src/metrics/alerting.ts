/**
 * Pipeline Metrics Alerting
 *
 * Sends alerts to Slack and Datadog when pipeline metrics exceed thresholds
 * or connectors fail.
 *
 * Phase 7.3 - Deployment Hardening & Observability
 */

import logger from '../utils/logger';
import { PipelineMetric, getMetricsStore } from './pipelineMetrics';

export interface AlertThresholds {
  durationMs?: number; // Alert if duration exceeds this
  failureCount?: number; // Alert if failures exceed this count in window
  windowMinutes?: number; // Time window for failure count
}

export interface AlertConfig {
  enabled: boolean;
  slack?: {
    webhookUrl: string;
    channel?: string;
    username?: string;
  };
  datadog?: {
    apiKey: string;
    appKey?: string;
    site?: string; // e.g., 'datadoghq.com' or 'datadoghq.eu'
  };
  thresholds: Record<string, AlertThresholds>;
}

class AlertManager {
  private config: AlertConfig;

  constructor(config: AlertConfig) {
    this.config = config;
  }

  /**
   * Check metrics and send alerts if thresholds are exceeded
   */
  async checkAndAlert(metric: PipelineMetric): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const threshold = this.config.thresholds[metric.phase];
    if (!threshold) {
      // No threshold configured for this phase
      return;
    }

    const alerts: string[] = [];

    // Check duration threshold
    if (threshold.durationMs && metric.duration > threshold.durationMs) {
      alerts.push(
        `⚠️ Duration threshold exceeded for ${metric.phase}: ${metric.duration}ms > ${threshold.durationMs}ms`
      );
    }

    // Check failure status
    if (metric.status === 'failure') {
      alerts.push(`❌ Pipeline failed: ${metric.phase} - ${metric.errorMessage || 'Unknown error'}`);
    }

    // Check failure count in window
    if (threshold.failureCount && threshold.windowMinutes) {
      const windowStart = new Date(Date.now() - threshold.windowMinutes * 60 * 1000);
      const recentMetrics = getMetricsStore().query({
        phase: metric.phase,
        startDate: windowStart,
        status: 'failure',
      });

      if (recentMetrics.length >= threshold.failureCount) {
        alerts.push(
          `🚨 Failure count threshold exceeded for ${metric.phase}: ${recentMetrics.length} failures in ${threshold.windowMinutes} minutes`
        );
      }
    }

    // Send alerts
    for (const message of alerts) {
      await this.sendAlert(metric.phase, message, metric);
    }
  }

  /**
   * Send alert to configured channels
   */
  private async sendAlert(phase: string, message: string, metric: PipelineMetric): Promise<void> {
    logger.warn('Pipeline alert triggered', { phase, message });

    const promises: Promise<void>[] = [];

    if (this.config.slack) {
      promises.push(this.sendSlackAlert(message, metric));
    }

    if (this.config.datadog) {
      promises.push(this.sendDatadogEvent(phase, message, metric));
    }

    await Promise.allSettled(promises);
  }

  /**
   * Send alert to Slack
   */
  private async sendSlackAlert(message: string, metric: PipelineMetric): Promise<void> {
    if (!this.config.slack) return;

    try {
      const payload = {
        channel: this.config.slack.channel,
        username: this.config.slack.username || 'Pipeline Monitor',
        text: message,
        attachments: [
          {
            color: metric.status === 'success' ? 'warning' : 'danger',
            fields: [
              {
                title: 'Phase',
                value: metric.phase,
                short: true,
              },
              {
                title: 'Status',
                value: metric.status,
                short: true,
              },
              {
                title: 'Duration',
                value: `${metric.duration}ms`,
                short: true,
              },
              {
                title: 'Time',
                value: metric.startTime.toISOString(),
                short: true,
              },
              ...(metric.metadata
                ? [
                    {
                      title: 'Metadata',
                      value: JSON.stringify(metric.metadata, null, 2),
                      short: false,
                    },
                  ]
                : []),
            ],
          },
        ],
      };

      const response = await fetch(this.config.slack.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook failed: ${response.statusText}`);
      }

      logger.info('Slack alert sent', { phase: metric.phase });
    } catch (error: any) {
      logger.error('Failed to send Slack alert', { error: error.message });
    }
  }

  /**
   * Send event to Datadog
   */
  private async sendDatadogEvent(phase: string, message: string, metric: PipelineMetric): Promise<void> {
    if (!this.config.datadog) return;

    try {
      const site = this.config.datadog.site || 'datadoghq.com';
      const url = `https://api.${site}/api/v1/events`;

      const event = {
        title: `Pipeline Alert: ${phase}`,
        text: message,
        alert_type: metric.status === 'success' ? 'warning' : 'error',
        priority: metric.status === 'success' ? 'normal' : 'high',
        tags: [
          `phase:${phase}`,
          `status:${metric.status}`,
          'source:pipeline-monitor',
        ],
        date_happened: Math.floor(metric.startTime.getTime() / 1000),
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': this.config.datadog.apiKey,
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        throw new Error(`Datadog API failed: ${response.statusText}`);
      }

      logger.info('Datadog event sent', { phase: metric.phase });
    } catch (error: any) {
      logger.error('Failed to send Datadog event', { error: error.message });
    }
  }

  /**
   * Send metric to Datadog as a custom metric
   */
  async sendMetricToDatadog(metric: PipelineMetric): Promise<void> {
    if (!this.config.enabled || !this.config.datadog) {
      return;
    }

    try {
      const site = this.config.datadog.site || 'datadoghq.com';
      const url = `https://api.${site}/api/v1/series`;

      const now = Math.floor(Date.now() / 1000);
      const series = [
        {
          metric: `pipeline.duration`,
          points: [[now, metric.duration]],
          type: 'gauge',
          tags: [`phase:${metric.phase}`, `status:${metric.status}`],
        },
        {
          metric: `pipeline.execution`,
          points: [[now, 1]],
          type: 'count',
          tags: [`phase:${metric.phase}`, `status:${metric.status}`],
        },
      ];

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': this.config.datadog.apiKey,
        },
        body: JSON.stringify({ series }),
      });

      if (!response.ok) {
        throw new Error(`Datadog metrics API failed: ${response.statusText}`);
      }

      logger.debug('Datadog metrics sent', { phase: metric.phase });
    } catch (error: any) {
      logger.error('Failed to send Datadog metrics', { error: error.message });
    }
  }
}

// Default configuration from environment variables
export function getAlertConfig(): AlertConfig {
  return {
    enabled: process.env.ALERTS_ENABLED === 'true',
    slack: process.env.SLACK_WEBHOOK_URL
      ? {
          webhookUrl: process.env.SLACK_WEBHOOK_URL,
          channel: process.env.SLACK_CHANNEL,
          username: process.env.SLACK_USERNAME || 'Pipeline Monitor',
        }
      : undefined,
    datadog: process.env.DATADOG_API_KEY
      ? {
          apiKey: process.env.DATADOG_API_KEY,
          appKey: process.env.DATADOG_APP_KEY,
          site: process.env.DATADOG_SITE || 'datadoghq.com',
        }
      : undefined,
    thresholds: {
      'source:sync': {
        durationMs: 300000, // 5 minutes
        failureCount: 3,
        windowMinutes: 60,
      },
      'source:ci': {
        durationMs: 600000, // 10 minutes
        failureCount: 2,
        windowMinutes: 30,
      },
      'opportunity-mapping': {
        durationMs: 120000, // 2 minutes
        failureCount: 3,
        windowMinutes: 60,
      },
      'consolidation': {
        durationMs: 180000, // 3 minutes
        failureCount: 3,
        windowMinutes: 60,
      },
    },
  };
}

// Singleton instance
let alertManager: AlertManager | null = null;

export function getAlertManager(): AlertManager {
  if (!alertManager) {
    alertManager = new AlertManager(getAlertConfig());
  }
  return alertManager;
}

/**
 * Record metric and check for alerts
 */
export async function recordAndAlert(metric: PipelineMetric): Promise<number> {
  const metricId = getMetricsStore().record(metric);

  // Check thresholds and send alerts if needed
  await getAlertManager().checkAndAlert(metric);

  // Send metric to Datadog if configured
  await getAlertManager().sendMetricToDatadog(metric);

  return metricId;
}
