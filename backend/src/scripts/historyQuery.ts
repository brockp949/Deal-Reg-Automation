import path from 'path';
import { promises as fs } from 'fs';
import logger from '../utils/logger';
import { config } from '../config';

interface HistoryOptions {
  limit?: number;
  json?: boolean;
}

function parseArgs(): HistoryOptions {
  const args = process.argv.slice(2);
  const options: HistoryOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      options.limit = Number(args[++i]);
    } else if (args[i] === '--json') {
      options.json = true;
    }
  }
  return options;
}

export async function main(optionsOverride?: HistoryOptions) {
  const options = optionsOverride ?? parseArgs();
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const historyFile = path.join(opportunitiesDir, 'history', 'metrics-history.jsonl');
  const raw = await fs.readFile(historyFile, 'utf-8');
  const lines = raw
    .trim()
    .split('\n')
    .filter((line) => line.length > 0);
  const subset = options.limit ? lines.slice(-options.limit) : lines;
  const records = subset.map((line) => JSON.parse(line));
  if (options.json) {
    logger.info('History records', records);
  } else {
    records.forEach((record: any) => {
      logger.info('History snapshot', {
        generatedAt: record.generatedAt,
        opportunities: record.totals?.opportunities,
        avgQuality: record.quality?.averageScore,
        feedback: record.feedback?.total,
      });
    });
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to query history', { error: error.message });
    process.exit(1);
  });
}
