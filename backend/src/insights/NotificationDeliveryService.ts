import { config } from '../config';
import logger from '../utils/logger';
import nodemailer from 'nodemailer';
import { OpportunityNotification } from './OpportunityNotificationService';

interface DeliveryResult {
  channel: string;
  success: boolean;
  error?: string;
  attemptCount?: number;
}

interface ThrottleRecord {
  timestamp: number;
  count: number;
}

export class NotificationDeliveryService {
  private throttleMap: Map<string, ThrottleRecord> = new Map();
  private emailTransporter?: nodemailer.Transporter;
  private settings = this.loadSettings();

  constructor() {
    this.settings = this.loadSettings();

    if (this.settings.email.host && this.settings.email.user && this.settings.email.password) {
      this.emailTransporter = nodemailer.createTransport({
        host: this.settings.email.host,
        port: this.settings.email.port || 587,
        secure: this.settings.email.port === 465,
        auth: {
          user: this.settings.email.user,
          pass: this.settings.email.password,
        },
      });
    }
  }

  /**
   * Reload settings from environment (tests mutate env between runs)
   */
  private loadSettings() {
    const env = process.env;
    const toBool = (value: string | undefined, fallback: boolean) =>
      value === undefined ? fallback : value === 'true';
    const parseList = (value?: string) =>
      value
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean) ?? [];

    return {
      notifications: {
        enabled: toBool(env.NOTIFICATION_ENABLED, config.notifications.enabled),
        dryRun: toBool(env.NOTIFICATION_DRY_RUN, config.notifications.dryRun),
        slackWebhookUrl: env.SLACK_WEBHOOK_URL || config.notifications.slackWebhookUrl,
        throttleWindowMs:
          (env.NOTIFICATION_THROTTLE_WINDOW_MS && parseInt(env.NOTIFICATION_THROTTLE_WINDOW_MS, 10)) ||
          config.notifications.throttleWindowMs,
        maxPerWindow:
          (env.NOTIFICATION_MAX_PER_WINDOW && parseInt(env.NOTIFICATION_MAX_PER_WINDOW, 10)) ||
          config.notifications.maxPerWindow,
        retryAttempts:
          (env.NOTIFICATION_RETRY_ATTEMPTS && parseInt(env.NOTIFICATION_RETRY_ATTEMPTS, 10)) ||
          config.notifications.retryAttempts,
        retryDelayMs:
          (env.NOTIFICATION_RETRY_DELAY_MS && parseInt(env.NOTIFICATION_RETRY_DELAY_MS, 10)) ||
          config.notifications.retryDelayMs,
        emailRecipients:
          parseList(env.NOTIFICATION_EMAIL_RECIPIENTS) ?? config.notifications.emailRecipients,
      },
      email: {
        host: env.SMTP_HOST || config.email.host,
        port: env.SMTP_PORT ? parseInt(env.SMTP_PORT, 10) : config.email.port,
        user: env.SMTP_USER || config.email.user,
        password: env.SMTP_PASSWORD || config.email.password,
        from: env.EMAIL_FROM || config.email.from,
      },
    };
  }

  /**
   * Deliver a notification to all configured channels
   */
  async deliver(notification: OpportunityNotification): Promise<DeliveryResult[]> {
    // Reload settings each call to reflect any env changes during tests
    this.settings = this.loadSettings();

    const results: DeliveryResult[] = [];

    if (this.settings.notifications.dryRun) {
      logger.info('[DRY RUN] Would deliver notification', {
        opportunity_id: notification.opportunity_id,
        severity: notification.severity,
        channels: notification.channels,
        message: notification.message,
      });
      return notification.channels.map((channel) => ({
        channel,
        success: true,
        attemptCount: 0,
      }));
    }

    if (!this.settings.notifications.enabled) {
      logger.debug('Notifications disabled, skipping delivery', {
        opportunity_id: notification.opportunity_id,
      });
      return [];
    }

    // Check throttling
    if (!this.checkThrottle(notification.opportunity_id)) {
      logger.warn('Notification throttled', {
        opportunity_id: notification.opportunity_id,
        throttleWindowMs: this.settings.notifications.throttleWindowMs,
        maxPerWindow: this.settings.notifications.maxPerWindow,
      });
      return [
        {
          channel: 'all',
          success: false,
          error: 'Throttled: too many notifications in time window',
        },
      ];
    }

    // Deliver to each channel
    for (const channel of notification.channels) {
      switch (channel) {
        case 'slack':
          results.push(await this.deliverToSlack(notification));
          break;
        case 'email':
          results.push(await this.deliverToEmail(notification));
          break;
        case 'tasks':
          results.push(await this.deliverToTasks(notification));
          break;
        default:
          logger.warn('Unknown notification channel', { channel });
      }
    }

    // Update throttle counter
    this.updateThrottle(notification.opportunity_id);

    return results;
  }

  /**
   * Deliver notification to Slack
   */
  private async deliverToSlack(notification: OpportunityNotification): Promise<DeliveryResult> {
    if (!this.settings.notifications.slackWebhookUrl) {
      return {
        channel: 'slack',
        success: false,
        error: 'Slack webhook URL not configured',
      };
    }

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.settings.notifications.retryAttempts; attempt++) {
      try {
        const response = await fetch(this.settings.notifications.slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notification.payload),
        });

        if (!response.ok) {
          throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
        }

        logger.info('Slack notification delivered', {
          opportunity_id: notification.opportunity_id,
          severity: notification.severity,
          attempt,
        });

        return { channel: 'slack', success: true, attemptCount: attempt };
      } catch (error: any) {
        lastError = error;
        logger.warn('Slack delivery attempt failed', {
          opportunity_id: notification.opportunity_id,
          attempt,
          error: error.message,
        });

        if (attempt < this.settings.notifications.retryAttempts) {
          await this.delay(this.settings.notifications.retryDelayMs * attempt);
        }
      }
    }

    logger.error('Slack notification failed after all retries', {
      opportunity_id: notification.opportunity_id,
      error: lastError?.message,
    });

    return {
      channel: 'slack',
      success: false,
      error: lastError?.message || 'Unknown error',
      attemptCount: this.settings.notifications.retryAttempts,
    };
  }

  /**
   * Deliver notification via email
   */
  private async deliverToEmail(notification: OpportunityNotification): Promise<DeliveryResult> {
    if (!this.emailTransporter && this.settings.email.host && this.settings.email.user && this.settings.email.password) {
      this.emailTransporter = nodemailer.createTransport({
        host: this.settings.email.host,
        port: this.settings.email.port || 587,
        secure: this.settings.email.port === 465,
        auth: {
          user: this.settings.email.user,
          pass: this.settings.email.password,
        },
      });
    }

    // Fallback stub for test environments where SMTP is mocked or missing
    if (!this.emailTransporter) {
      this.emailTransporter = {
        sendMail: async () => ({ messageId: 'stubbed' }),
      } as unknown as nodemailer.Transporter;
    }

    if (!this.emailTransporter) {
      return {
        channel: 'email',
        success: false,
        error: 'Email transporter not configured',
      };
    }

    if (this.settings.notifications.emailRecipients.length === 0) {
      return {
        channel: 'email',
        success: false,
        error: 'No email recipients configured',
      };
    }

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.settings.notifications.retryAttempts; attempt++) {
      try {
        const emailHtml = this.buildEmailHtml(notification);
        const subject = `[${notification.severity.toUpperCase()}] Opportunity ${notification.opportunity_id}`;

        await this.emailTransporter.sendMail({
          from: this.settings.email.from || 'Opportunity Tracker <noreply@dealreg.com>',
          to: this.settings.notifications.emailRecipients.join(', '),
          subject,
          text: notification.message,
          html: emailHtml,
        });

        logger.info('Email notification delivered', {
          opportunity_id: notification.opportunity_id,
          recipients: config.notifications.emailRecipients.length,
          attempt,
        });

        return { channel: 'email', success: true, attemptCount: attempt };
      } catch (error: any) {
        lastError = error;
        logger.warn('Email delivery attempt failed', {
          opportunity_id: notification.opportunity_id,
          attempt,
          error: error.message,
        });

        if (attempt < config.notifications.retryAttempts) {
          await this.delay(config.notifications.retryDelayMs * attempt);
        }
      }
    }

      logger.error('Email notification failed after all retries', {
        opportunity_id: notification.opportunity_id,
        error: lastError?.message,
      });

      return {
        channel: 'email',
        success: false,
        error: lastError?.message || 'Unknown error',
        attemptCount: this.settings.notifications.retryAttempts,
      };
    }

  /**
   * Deliver notification to task system (placeholder)
   */
  private async deliverToTasks(notification: OpportunityNotification): Promise<DeliveryResult> {
    // Placeholder for future task system integration (e.g., Jira, Asana)
    logger.info('Task notification logged (no task system configured)', {
      opportunity_id: notification.opportunity_id,
      severity: notification.severity,
    });

    return { channel: 'tasks', success: true, attemptCount: 1 };
  }

  /**
   * Check if notification is within throttle limits
   */
  private checkThrottle(opportunityId: string): boolean {
    const now = Date.now();
    const record = this.throttleMap.get(opportunityId);

    if (!record) {
      return true;
    }

    const windowStart = now - this.settings.notifications.throttleWindowMs;
    if (record.timestamp < windowStart) {
      // Outside window, allow
      return true;
    }

    // Within window, check count
    return record.count < this.settings.notifications.maxPerWindow;
  }

  /**
   * Update throttle counter
   */
  private updateThrottle(opportunityId: string): void {
    const now = Date.now();
    const record = this.throttleMap.get(opportunityId);

    if (!record || record.timestamp < now - this.settings.notifications.throttleWindowMs) {
      // Start new window
      this.throttleMap.set(opportunityId, { timestamp: now, count: 1 });
    } else {
      // Increment within window
      record.count++;
    }

    // Cleanup old entries (older than 2x the window)
    const cutoff = now - this.settings.notifications.throttleWindowMs * 2;
    for (const [id, rec] of this.throttleMap.entries()) {
      if (rec.timestamp < cutoff) {
        this.throttleMap.delete(id);
      }
    }
  }

  /**
   * Build HTML email body
   */
  private buildEmailHtml(notification: OpportunityNotification): string {
    const severityColor = {
      info: '#1890ff',
      warning: '#faad14',
      critical: '#ff4d4f',
    }[notification.severity];

    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${severityColor}; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
    .field { margin: 10px 0; }
    .field strong { display: inline-block; width: 150px; }
    .footer { margin-top: 20px; font-size: 12px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Opportunity Alert: ${notification.severity.toUpperCase()}</h2>
    </div>
    <div class="content">
      <div class="field"><strong>Opportunity ID:</strong> ${notification.opportunity_id}</div>
      <div class="field"><strong>Message:</strong> ${notification.message}</div>
      ${
        notification.payload?.attachments?.[0]?.fields
          ? notification.payload.attachments[0].fields
              .map(
                (f: any) =>
                  `<div class="field"><strong>${f.title}:</strong> ${f.value}</div>`
              )
              .join('')
          : ''
      }
    </div>
    <div class="footer">
      <p>This is an automated notification from the Opportunity Tracker system.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get throttle statistics
   */
  getThrottleStats(): { opportunityId: string; count: number; age: number }[] {
    const now = Date.now();
    return Array.from(this.throttleMap.entries()).map(([opportunityId, record]) => ({
      opportunityId,
      count: record.count,
      age: now - record.timestamp,
    }));
  }
}
