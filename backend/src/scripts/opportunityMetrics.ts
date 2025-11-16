import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import { OpportunityRecord } from '../opportunities/types';

interface MetricsOptions {
  file?: string;
  clustersFile?: string;
  output?: string;
}

interface OpportunityMetrics {
  totalOpportunities: number;
  stageBreakdown: Record<string, number>;
  priorityBreakdown: Record<string, number>;
  clusterCount: number;
  clusteredOpportunityCount: number;
  generatedAt: string;
}

function parseArgs(): MetricsOptions {
  const args = process.argv.slice(2);
  const options: MetricsOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      options.file = args[++i];
    } else if (args[i] === '--clusters-file' && args[i + 1]) {
      options.clustersFile = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      options.output = args[++i];
    }
  }
  return options;
}

async function loadJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function summarize(records: OpportunityRecord[], clusters: any[]): OpportunityMetrics {
  const stageBreakdown: Record<string, number> = {};
  const priorityBreakdown: Record<string, number> = {};

  for (const record of records) {
    stageBreakdown[record.stage] = (stageBreakdown[record.stage] ?? 0) + 1;
    priorityBreakdown[record.priority] = (priorityBreakdown[record.priority] ?? 0) + 1;
  }

  const clusteredOpportunityIds = new Set<string>();
  for (const cluster of clusters) {
    for (const record of cluster.records ?? []) {
      if (record.id) {
        clusteredOpportunityIds.add(record.id);
      }
    }
  }

  return {
    totalOpportunities: records.length,
    stageBreakdown,
    priorityBreakdown,
    clusterCount: clusters.length,
    clusteredOpportunityCount: clusteredOpportunityIds.size,
    generatedAt: new Date().toISOString(),
  };
}

export async function main(optionsOverride?: MetricsOptions) {
  const options = optionsOverride ?? parseArgs();
  const opportunitiesPath =
    options.file ??
    path.resolve(config.upload.directory, 'opportunities', 'opportunities.json');
  const clustersPath =
    options.clustersFile ??
    path.resolve(config.upload.directory, 'opportunities', 'opportunity-clusters.json');
  const outputPath =
    options.output ??
    path.resolve(config.upload.directory, 'opportunities', 'readiness-metrics.json');

  const records = await loadJson<OpportunityRecord[]>(opportunitiesPath);
  const clusters = await loadJson<any[]>(clustersPath);
  const metrics = summarize(records, clusters);

  await fs.writeFile(outputPath, JSON.stringify(metrics, null, 2), 'utf-8');

  logger.info('Opportunity readiness metrics', {
    ...metrics,
    outputPath,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to compute opportunity metrics', { error: error.message });
    process.exit(1);
  });
}
