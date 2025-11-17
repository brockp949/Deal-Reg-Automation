import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import logger from '../utils/logger';
import { CompositeOpportunity } from '../opportunities/types';

interface ExportOptions {
  input?: string;
  outputJson?: string;
  outputCsv?: string;
}

function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  const options: ExportOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      options.input = args[++i];
    } else if (args[i] === '--json' && args[i + 1]) {
      options.outputJson = args[++i];
    } else if (args[i] === '--csv' && args[i + 1]) {
      options.outputCsv = args[++i];
    }
  }
  return options;
}

async function loadComposites(filePath: string): Promise<CompositeOpportunity[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as CompositeOpportunity[];
}

function toCsv(records: CompositeOpportunity[]): string {
  const headers = [
    'composite_id',
    'cluster_id',
    'opportunity_ids',
    'stage',
    'stage_confidence',
    'priority',
    'priority_confidence',
    'vendors',
    'customers',
    'score',
    'has_mixed_sources',
  ];
  const rows = records.map((record) => [
    record.composite_id,
    record.cluster_id,
    record.opportunity_ids.join(';'),
    record.stage,
    record.stage_confidence.toString(),
    record.priority,
    record.priority_confidence.toString(),
    record.vendors.join(';'),
    record.customers.join(';'),
    record.score.toString(),
    record.conflicts.has_mixed_sources ? 'true' : 'false',
  ]);
  return [headers.join(','), ...rows.map((row) => row.map((value) => `"${value}"`).join(','))].join(
    '\n'
  );
}

export async function main(options?: ExportOptions) {
  const opts = options ?? parseArgs();
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const inputPath = opts.input ?? path.join(opportunitiesDir, 'consolidated-opportunities.json');
  const outputJsonPath = opts.outputJson ?? path.join(opportunitiesDir, 'composite-opportunities.json');
  const outputCsvPath = opts.outputCsv ?? path.join(opportunitiesDir, 'composite-opportunities.csv');

  const composites = await loadComposites(inputPath);
  await fs.writeFile(outputJsonPath, JSON.stringify(composites, null, 2), 'utf-8');
  await fs.writeFile(outputCsvPath, toCsv(composites), 'utf-8');

  logger.info('Composite opportunities exported', {
    inputPath,
    outputJsonPath,
    outputCsvPath,
    count: composites.length,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to export composite opportunities', { error: error.message });
    process.exit(1);
  });
}
