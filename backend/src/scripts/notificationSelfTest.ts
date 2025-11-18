import { config } from '../config';
import logger from '../utils/logger';
import { OpportunityInsightService } from '../insights/OpportunityInsightService';
import { OpportunityNotificationService } from '../insights/OpportunityNotificationService';
import { NotificationDeliveryService } from '../insights/NotificationDeliveryService';
import { OpportunityRecord } from '../opportunities/types';

interface TestResult {
  test: string;
  passed: boolean;
  message: string;
  details?: any;
}

class NotificationSelfTest {
  private results: TestResult[] = [];

  async run(): Promise<void> {
    logger.info('Starting notification system self-test...');

    await this.testConfiguration();
    await this.testInsightGeneration();
    await this.testNotificationGeneration();
    await this.testThrottling();
    await this.testDeliveryModes();

    this.printResults();
  }

  private async testConfiguration(): Promise<void> {
    logger.info('[1/5] Testing configuration...');

    // Check notification enabled
    this.results.push({
      test: 'Notification System Enabled',
      passed: true,
      message: config.notifications.enabled
        ? 'Notifications are ENABLED'
        : 'Notifications are DISABLED (set NOTIFICATION_ENABLED=true to enable)',
    });

    // Check Slack webhook
    this.results.push({
      test: 'Slack Webhook URL',
      passed: !!config.notifications.slackWebhookUrl,
      message: config.notifications.slackWebhookUrl
        ? `Configured: ${config.notifications.slackWebhookUrl.substring(0, 30)}...`
        : 'NOT configured (set SLACK_WEBHOOK_URL)',
    });

    // Check email configuration
    const emailConfigured =
      !!config.email.host && !!config.email.user && !!config.email.password;
    this.results.push({
      test: 'Email Configuration',
      passed: emailConfigured,
      message: emailConfigured
        ? `Configured: ${config.email.host} (${config.email.user})`
        : 'NOT configured (set SMTP_HOST, SMTP_USER, SMTP_PASSWORD)',
    });

    // Check email recipients
    this.results.push({
      test: 'Email Recipients',
      passed: config.notifications.emailRecipients.length > 0,
      message:
        config.notifications.emailRecipients.length > 0
          ? `${config.notifications.emailRecipients.length} recipient(s): ${config.notifications.emailRecipients.join(', ')}`
          : 'NO recipients configured (set NOTIFICATION_EMAIL_RECIPIENTS)',
    });

    // Check throttling config
    this.results.push({
      test: 'Throttling Configuration',
      passed: true,
      message: `Window: ${config.notifications.throttleWindowMs}ms, Max: ${config.notifications.maxPerWindow} per window`,
    });

    // Check retry config
    this.results.push({
      test: 'Retry Configuration',
      passed: true,
      message: `Attempts: ${config.notifications.retryAttempts}, Delay: ${config.notifications.retryDelayMs}ms`,
    });

    // Check dry-run mode
    this.results.push({
      test: 'Dry-Run Mode',
      passed: true,
      message: config.notifications.dryRun
        ? 'ENABLED (no actual delivery, set NOTIFICATION_DRY_RUN=false to enable delivery)'
        : 'DISABLED (actual delivery enabled)',
      details: {
        warning: config.notifications.dryRun
          ? null
          : 'Notifications will be delivered to real channels!',
      },
    });
  }

  private async testInsightGeneration(): Promise<void> {
    logger.info('[2/5] Testing insight generation...');

    // Create test opportunities
    const testOpportunities: OpportunityRecord[] = [
      {
        id: 'self-test-high-risk',
        name: 'Test High Risk Deal',
        stage: 'rfq',
        priority: 'low',
        units: { min: 1, max: 5 },
        pricing: { min: 100, max: 500 },
        actors: [],
        nextSteps: [],
        backlinks: [],
        sourceIds: ['test-1'],
        createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(), // Very old
      },
      {
        id: 'self-test-healthy',
        name: 'Test Healthy Deal',
        stage: 'po_in_progress',
        priority: 'high',
        units: { min: 1000, max: 2000 },
        pricing: { min: 100000, max: 200000 },
        actors: [],
        nextSteps: [],
        backlinks: [],
        sourceIds: ['test-2'],
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // Recent
      },
    ];

    try {
      const insightService = new OpportunityInsightService();
      const insights = insightService.generate(testOpportunities);

      this.results.push({
        test: 'Insight Generation',
        passed: insights.insights.length === 2,
        message: `Generated ${insights.insights.length} insights from ${testOpportunities.length} opportunities`,
        details: insights.insights.map((i) => ({
          id: i.opportunity_id,
          winProbability: i.winProbability,
          momentum: i.momentumScore,
          risks: i.riskFlags,
        })),
      });

      // Verify high-risk detection
      const highRiskInsight = insights.insights.find((i) => i.opportunity_id === 'self-test-high-risk');
      this.results.push({
        test: 'High-Risk Detection',
        passed: !!highRiskInsight && highRiskInsight.winProbability <= 0.4,
        message: highRiskInsight
          ? `Detected low win probability: ${highRiskInsight.winProbability}, risks: ${highRiskInsight.riskFlags.join(', ')}`
          : 'Failed to detect high-risk opportunity',
      });
    } catch (error: any) {
      this.results.push({
        test: 'Insight Generation',
        passed: false,
        message: `Error: ${error.message}`,
      });
    }
  }

  private async testNotificationGeneration(): Promise<void> {
    logger.info('[3/5] Testing notification generation...');

    const testInsights = [
      {
        opportunity_id: 'self-test-critical',
        winProbability: 0.15,
        momentumScore: 0.2,
        riskFlags: ['stalled', 'low_engagement'],
        notes: [],
      },
      {
        opportunity_id: 'self-test-warning',
        winProbability: 0.35,
        momentumScore: 0.5,
        riskFlags: ['stalled'],
        notes: [],
      },
      {
        opportunity_id: 'self-test-healthy',
        winProbability: 0.85,
        momentumScore: 0.9,
        riskFlags: [],
        notes: [],
      },
    ];

    try {
      const notificationService = new OpportunityNotificationService({
        highRiskThreshold: 0.4,
        channels: ['slack', 'email'],
      });

      const notifications = notificationService.generate(testInsights);

      this.results.push({
        test: 'Notification Generation',
        passed: notifications.length === 2, // Only high-risk ones
        message: `Generated ${notifications.length} notifications from ${testInsights.length} insights`,
        details: notifications.map((n) => ({
          id: n.opportunity_id,
          severity: n.severity,
          channels: n.channels,
        })),
      });

      // Verify severity levels
      const criticalNotification = notifications.find((n) => n.opportunity_id === 'self-test-critical');
      this.results.push({
        test: 'Severity Classification',
        passed: criticalNotification?.severity === 'critical',
        message: criticalNotification
          ? `Critical notification correctly classified (winProb: 0.15)`
          : 'Failed to classify critical notification',
      });

      // Verify payload structure
      const hasValidPayload = notifications.every(
        (n) => n.payload && n.payload.text && n.payload.attachments
      );
      this.results.push({
        test: 'Notification Payload',
        passed: hasValidPayload,
        message: hasValidPayload
          ? 'All notifications have valid Slack payloads'
          : 'Some notifications missing valid payloads',
      });
    } catch (error: any) {
      this.results.push({
        test: 'Notification Generation',
        passed: false,
        message: `Error: ${error.message}`,
      });
    }
  }

  private async testThrottling(): Promise<void> {
    logger.info('[4/5] Testing throttling...');

    const deliveryService = new NotificationDeliveryService();
    const testNotification = {
      opportunity_id: 'throttle-test',
      severity: 'warning' as const,
      message: 'Throttle test notification',
      channels: ['slack' as const],
      payload: { text: 'Test' },
    };

    try {
      // Deliver multiple times rapidly
      const results = [];
      for (let i = 0; i < config.notifications.maxPerWindow + 2; i++) {
        const result = await deliveryService.deliver(testNotification);
        results.push(result);
      }

      const successCount = results.filter((r) => r[0]?.success).length;
      const throttledCount = results.filter(
        (r) => r[0]?.error?.includes('Throttled')
      ).length;

      this.results.push({
        test: 'Throttling Mechanism',
        passed: throttledCount > 0,
        message: `Delivered ${successCount} notifications, throttled ${throttledCount}`,
        details: {
          maxPerWindow: config.notifications.maxPerWindow,
          windowMs: config.notifications.throttleWindowMs,
          actualDelivered: successCount,
          actualThrottled: throttledCount,
        },
      });

      // Check throttle stats
      const stats = deliveryService.getThrottleStats();
      this.results.push({
        test: 'Throttle Statistics',
        passed: stats.length > 0,
        message: `Tracking ${stats.length} opportunity throttle record(s)`,
        details: stats,
      });
    } catch (error: any) {
      this.results.push({
        test: 'Throttling Mechanism',
        passed: false,
        message: `Error: ${error.message}`,
      });
    }
  }

  private async testDeliveryModes(): Promise<void> {
    logger.info('[5/5] Testing delivery modes...');

    const testNotification = {
      opportunity_id: 'delivery-test',
      severity: 'info' as const,
      message: 'Delivery mode test',
      channels: ['slack' as const, 'email' as const, 'tasks' as const],
      payload: { text: 'Test', attachments: [] },
    };

    try {
      const deliveryService = new NotificationDeliveryService();
      const results = await deliveryService.deliver(testNotification);

      if (config.notifications.dryRun) {
        this.results.push({
          test: 'Dry-Run Delivery',
          passed: results.length > 0 && results.every((r) => r.success),
          message: `Dry-run succeeded for ${results.length} channel(s)`,
          details: results,
        });
      } else {
        // Real delivery
        const slackResult = results.find((r) => r.channel === 'slack');
        const emailResult = results.find((r) => r.channel === 'email');
        const tasksResult = results.find((r) => r.channel === 'tasks');

        this.results.push({
          test: 'Live Slack Delivery',
          passed: slackResult?.success === true,
          message: slackResult?.success
            ? `Delivered successfully (${slackResult.attemptCount} attempt(s))`
            : `Failed: ${slackResult?.error || 'Not configured'}`,
        });

        this.results.push({
          test: 'Live Email Delivery',
          passed: emailResult?.success === true,
          message: emailResult?.success
            ? `Delivered successfully (${emailResult.attemptCount} attempt(s))`
            : `Failed: ${emailResult?.error || 'Not configured'}`,
        });

        this.results.push({
          test: 'Task System Integration',
          passed: tasksResult?.success === true,
          message: tasksResult?.success
            ? 'Task logging successful (placeholder)'
            : `Failed: ${tasksResult?.error || 'Unknown'}`,
        });
      }
    } catch (error: any) {
      this.results.push({
        test: 'Delivery Modes',
        passed: false,
        message: `Error: ${error.message}`,
      });
    }
  }

  private printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('NOTIFICATION SYSTEM SELF-TEST RESULTS');
    console.log('='.repeat(80) + '\n');

    const passed = this.results.filter((r) => r.passed).length;
    const total = this.results.length;

    this.results.forEach((result) => {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      const color = result.passed ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';

      console.log(`${color}${status}${reset} ${result.test}`);
      console.log(`      ${result.message}`);

      if (result.details) {
        console.log('      Details:', JSON.stringify(result.details, null, 2));
      }
      console.log('');
    });

    console.log('='.repeat(80));
    console.log(`SUMMARY: ${passed}/${total} tests passed`);

    if (config.notifications.dryRun) {
      console.log('\n⚠️  DRY-RUN MODE: No actual notifications were sent.');
      console.log('   Set NOTIFICATION_DRY_RUN=false to test live delivery.\n');
    }

    if (!config.notifications.enabled) {
      console.log('\n⚠️  NOTIFICATIONS DISABLED: Set NOTIFICATION_ENABLED=true to enable.\n');
    }

    console.log('='.repeat(80) + '\n');

    if (passed < total) {
      logger.error('Self-test completed with failures', { passed, total });
      process.exit(1);
    } else {
      logger.info('Self-test completed successfully', { passed, total });
      process.exit(0);
    }
  }
}

// Run self-test
if (require.main === module) {
  const selfTest = new NotificationSelfTest();
  selfTest.run().catch((error) => {
    logger.error('Self-test failed with error', { error: error.message });
    process.exit(1);
  });
}

export { NotificationSelfTest };
