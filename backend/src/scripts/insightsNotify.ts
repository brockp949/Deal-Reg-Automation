import path from 'path';
import { promises as fs } from 'fs';
import logger from '../utils/logger';
import { config } from '../config';
import { OpportunityInsightService } from '../insights/OpportunityInsightService';
import { OpportunityNotificationService } from '../insights/OpportunityNotificationService';
import { NotificationDeliveryService } from '../insights/NotificationDeliveryService';
import { OpportunityRecord } from '../opportunities/types';

async function ensureInsights(insightsPath: string, opportunitiesDir: string) {
  try {
    const raw = await fs.readFile(insightsPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    const oppsPath = path.join(opportunitiesDir, 'opportunities.json');
    const records = JSON.parse(await fs.readFile(oppsPath, 'utf-8')) as OpportunityRecord[];
    const generated = new OpportunityInsightService().generate(records);
    await fs.writeFile(insightsPath, JSON.stringify(generated, null, 2), 'utf-8');
    logger.warn('Insights missing; generated baseline insights before notification run', { insightsPath });
    return generated;
  }
}

export async function main() {
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const insightsPath = path.join(opportunitiesDir, 'insights.json');
  const notificationsPath = path.join(opportunitiesDir, 'notifications.json');
  const deliveryLogPath = path.join(opportunitiesDir, 'notification-delivery-log.json');

  const insightsData = await ensureInsights(insightsPath, opportunitiesDir);
  const notificationService = new OpportunityNotificationService();
  const notifications = notificationService.generate(insightsData.insights || []);

  // Save generated notifications
  await fs.writeFile(
    notificationsPath,
    JSON.stringify({ notifications, generatedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );

  logger.info('Opportunity notifications generated', {
    totalNotifications: notifications.length,
    critical: notifications.filter((n) => n.severity === 'critical').length,
    outputPath: notificationsPath,
  });

  // Deliver notifications
  const deliveryService = new NotificationDeliveryService();
  const deliveryResults = [];

  for (const notification of notifications) {
    logger.info('Delivering notification', {
      opportunity_id: notification.opportunity_id,
      severity: notification.severity,
      channels: notification.channels,
    });

    const results = await deliveryService.deliver(notification);
    deliveryResults.push({
      notification: {
        opportunity_id: notification.opportunity_id,
        severity: notification.severity,
        message: notification.message,
      },
      results,
      timestamp: new Date().toISOString(),
    });

    // Log each delivery result
    results.forEach((result) => {
      if (result.success) {
        logger.info('Notification delivered successfully', {
          opportunity_id: notification.opportunity_id,
          channel: result.channel,
          attempts: result.attemptCount,
        });
      } else {
        logger.error('Notification delivery failed', {
          opportunity_id: notification.opportunity_id,
          channel: result.channel,
          error: result.error,
          attempts: result.attemptCount,
        });
      }
    });
  }

  // Save delivery log
  await fs.writeFile(
    deliveryLogPath,
    JSON.stringify({ deliveryResults, generatedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );

  // Summary statistics
  const successCount = deliveryResults.reduce(
    (sum, dr) => sum + dr.results.filter((r) => r.success).length,
    0
  );
  const failureCount = deliveryResults.reduce(
    (sum, dr) => sum + dr.results.filter((r) => !r.success).length,
    0
  );

  logger.info('Notification delivery completed', {
    totalNotifications: notifications.length,
    totalDeliveries: successCount + failureCount,
    successful: successCount,
    failed: failureCount,
    deliveryLogPath,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to generate notifications', { error: error.message });
    process.exit(1);
  });
}
