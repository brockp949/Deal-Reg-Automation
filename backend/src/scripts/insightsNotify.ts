import path from 'path';
import { promises as fs } from 'fs';
import logger from '../utils/logger';
import { config } from '../config';
import { OpportunityInsightService } from '../insights/OpportunityInsightService';
import { OpportunityNotificationService } from '../insights/OpportunityNotificationService';
import { OpportunityRecord } from '../opportunities/types';

async function loadInsights(opportunitiesPath: string) {
  const raw = await fs.readFile(opportunitiesPath, 'utf-8');
  return JSON.parse(raw);
}

export async function main() {
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const insightsPath = path.join(opportunitiesDir, 'insights.json');
  const notificationsPath = path.join(opportunitiesDir, 'notifications.json');

  let insightsData;
  try {
    insightsData = await loadInsights(insightsPath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const oppsPath = path.join(opportunitiesDir, 'opportunities.json');
      const records = JSON.parse(await fs.readFile(oppsPath, 'utf-8')) as OpportunityRecord[];
      const service = new OpportunityInsightService();
      const generated = service.generate(records);
      insightsData = generated;
      await fs.writeFile(insightsPath, JSON.stringify(generated, null, 2), 'utf-8');
      logger.warn('Insights file missing; generated baseline insights before notification run', { insightsPath });
    } else {
      throw error;
    }
  }

  const notifications = new OpportunityNotificationService().generate(insightsData.insights || []);
  await fs.writeFile(notificationsPath, JSON.stringify({ notifications, generatedAt: new Date().toISOString() }, null, 2));

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
