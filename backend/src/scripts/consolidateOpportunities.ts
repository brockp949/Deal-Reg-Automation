import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import { OpportunityConsolidator } from '../opportunities/OpportunityConsolidator';
import { OpportunityRecord } from '../opportunities/types';

interface CliOptions {
  input?: string;
  output?: string;
  minScore?: number;
  log?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      options.input = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (args[i] === '--min-score' && args[i + 1]) {
      options.minScore = Number(args[++i]);
    } else if (args[i] === '--log') {
      options.log = true;
    }
  }
  return options;
}

async function loadOpportunities(filePath: string): Promise<OpportunityRecord[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as OpportunityRecord[];
}

export async function main(options?: CliOptions) {
  const cliOptions = options ?? parseArgs();
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const inputPath = cliOptions.input ?? path.join(opportunitiesDir, 'opportunities.json');
  const outputPath =
    cliOptions.output ?? path.join(opportunitiesDir, 'consolidated-opportunities.json');

  const records = await loadOpportunities(inputPath);
  const consolidator = new OpportunityConsolidator({
    minScore: cliOptions.minScore ?? 0.5,
  });
  const consolidated = consolidator.consolidate(records);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(consolidated, null, 2), 'utf-8');

  if (cliOptions.log) {
    consolidated.slice(0, 5).forEach((entry) => {
      logger.info('Consolidated opportunity', {
        clusterId: entry.clusterId,
        stage: entry.stage,
        priority: entry.priority,
        score: entry.score,
        opportunityIds: entry.opportunityIds,
      });
    });
  }

  logger.info('Opportunity consolidation complete', {
    inputPath,
    outputPath,
    consolidatedCount: consolidated.length,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to consolidate opportunities', { error: error.message });
    process.exit(1);
  });
}
