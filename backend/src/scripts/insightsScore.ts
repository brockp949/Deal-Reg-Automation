import path from 'path';
import { promises as fs } from 'fs';
import logger from '../utils/logger';
import { config } from '../config';
import { OpportunityRecord } from '../opportunities/types';
import { OpportunityInsightService } from '../insights/OpportunityInsightService';

async function loadOpportunities(filePath: string): Promise<OpportunityRecord[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as OpportunityRecord[];
}

export async function main() {
  const opportunitiesPath = path.resolve(config.upload.directory, 'opportunities', 'opportunities.json');
  const outputDir = path.resolve(config.upload.directory, 'opportunities');
  const outputPath = path.join(outputDir, 'insights.json');

  const records = await loadOpportunities(opportunitiesPath);
  const service = new OpportunityInsightService();
  const { insights, summary } = service.generate(records);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify({ insights, summary }, null, 2), 'utf-8');

  logger.info('Opportunity insights generated', {
    totalOpportunities: summary.totalOpportunities,
    highWin: summary.highWin,
    mediumWin: summary.mediumWin,
    lowWin: summary.lowWin,
    avgMomentum: summary.avgMomentum,
    outputPath,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to generate opportunity insights', { error: error.message });
    process.exit(1);
  });
}
