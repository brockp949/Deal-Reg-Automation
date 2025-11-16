import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import { OpportunityRecord } from '../opportunities';

interface CliOptions {
  filter?: string;
  clusters?: boolean;
  limit?: number;
  file?: string;
  clustersFile?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--filter' && args[i + 1]) {
      options.filter = args[++i].toLowerCase();
    } else if (args[i] === '--clusters') {
      options.clusters = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      options.limit = Number(args[++i]);
    } else if (args[i] === '--file' && args[i + 1]) {
      options.file = args[++i];
    } else if (args[i] === '--clusters-file' && args[i + 1]) {
      options.clustersFile = args[++i];
    }
  }
  return options;
}

async function loadJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function filterRecords(records: OpportunityRecord[], filter?: string): OpportunityRecord[] {
  if (!filter) return records;
  return records.filter((record) => {
    return (
      record.name.toLowerCase().includes(filter) ||
      (record.metadata.vendor ?? '').toLowerCase().includes(filter) ||
      (record.metadata.customer ?? '').toLowerCase().includes(filter) ||
      (record.sourceTags ?? []).some((tag) => tag.toLowerCase().includes(filter))
    );
  });
}

async function showOpportunities(options: CliOptions): Promise<void> {
  const opportunitiesPath =
    options.file ??
    path.resolve(config.upload.directory, 'opportunities', 'opportunities.json');
  const clustersPath =
    options.clustersFile ??
    path.resolve(config.upload.directory, 'opportunities', 'opportunity-clusters.json');

  const records = await loadJson<OpportunityRecord[]>(opportunitiesPath);
  const filtered = filterRecords(records, options.filter);
  const limited = typeof options.limit === 'number' ? filtered.slice(0, options.limit) : filtered;

  logger.info('Opportunities overview', {
    stored: records.length,
    shown: limited.length,
    filter: options.filter,
    source: opportunitiesPath,
  });

  limited.forEach((record) => {
    logger.info('Opportunity', {
      id: record.id,
      name: record.name,
      stage: record.stage,
      priority: record.priority,
      vendor: record.metadata.vendor,
      customer: record.metadata.customer,
      sourceTags: record.sourceTags?.slice(0, 5),
    });
  });

  if (options.clusters) {
    const clusters = await loadJson<
      Array<{
        clusterId: string;
        score: number;
        records: OpportunityRecord[];
        signals: { sharedOpportunityTags: string[]; sharedActors: string[] };
      }>
    >(clustersPath);

    logger.info('Opportunity clusters overview', {
      clusterCount: clusters.length,
      source: clustersPath,
    });
    clusters.slice(0, options.limit ?? 5).forEach((cluster) => {
      logger.info('Cluster', {
        clusterId: cluster.clusterId,
        score: cluster.score,
        opportunities: cluster.records.map((record) => record.id),
        sharedTags: cluster.signals.sharedOpportunityTags,
      });
    });
  }
}

export async function main(optionsOverride?: CliOptions) {
  const options = optionsOverride ?? parseArgs();
  await showOpportunities(options);
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to show opportunities', { error: error.message });
    process.exit(1);
  });
}
