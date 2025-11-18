import path from 'path';
import { promises as fs } from 'fs';
import logger from '../utils/logger';
import { config } from '../config';
import { OpportunityInsightService } from '../insights/OpportunityInsightService';
import { OpportunityNotificationService } from '../insights/OpportunityNotificationService';
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

  const insightsData = await ensureInsights(insightsPath, opportunitiesDir);
  const notificationService = new OpportunityNotificationService();
  const notifications = notificationService.generate(insightsData.insights || []);

  await fs.writeFile(
    notificationsPath,
    JSON.stringify({ notifications, generatedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );

  notifications.forEach((notification) => {
    logger.info('Notification ready', {
      opportunity: notification.opportunity_id,
      severity: notification.severity,
      channels: notification.channels,
      message: notification.message,
    });
  });

  logger.info('Opportunity notifications generated', {
    totalNotifications: notifications.length,
    critical: notifications.filter((n) => n.severity === 'critical').length,
    outputPath: notificationsPath,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to generate notifications', { error: error.message });
    process.exit(1);
  });
}
