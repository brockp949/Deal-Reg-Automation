import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { ManifestProcessor } from '../ingestion/ManifestProcessor';
import { SourceManifestEntry } from '../ingestion/SourceSyncService';
import { config } from '../config';
import { OpportunityStore } from '../opportunities/OpportunityStore';
import { OpportunityCorrelator } from '../opportunities/OpportunityCorrelator';
import { OpportunityConsolidator } from '../opportunities/OpportunityConsolidator';
import { main as exportComposite } from './exportCompositeOpportunities';
import { main as opportunityMetrics } from './opportunityMetrics';
import { main as opportunityQuality } from './opportunityQuality';

interface CliOptions {
  manifestPath?: string;
  outputPath?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manifest' && args[i + 1]) {
      options.manifestPath = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      options.outputPath = args[++i];
    }
  }
  return options;
}

async function loadManifest(manifestPath: string): Promise<SourceManifestEntry[]> {
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) {
    throw new Error('Manifest file must contain an array');
  }
  return entries as SourceManifestEntry[];
}

async function main() {
  const args = parseArgs();
  const defaultManifest = path.resolve(
    config.upload.directory,
    'source-sync',
    'source-sync-manifest.json'
  );
  const manifestPath = path.resolve(args.manifestPath ?? defaultManifest);

  const outputPath = path.resolve(
    args.outputPath ?? path.join(path.dirname(manifestPath), 'opportunity-records.json')
  );

  logger.info('Processing source manifest', { manifestPath, outputPath });

  const entries = await loadManifest(manifestPath);
  const processor = new ManifestProcessor();
  const result = await processor.processEntries(entries);

  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');

  const store = new OpportunityStore({ baseDir: config.upload.directory });
  const storeResult = await store.upsert(result.opportunities);

  const correlator = new OpportunityCorrelator();
  const clusters = correlator.correlate(storeResult.storedRecords);
  const clusterOutputPath = path.join(
    path.dirname(storeResult.filePath),
    'opportunity-clusters.json'
  );
  await fs.writeFile(clusterOutputPath, JSON.stringify(clusters, null, 2), 'utf-8');

  const consolidator = new OpportunityConsolidator();
  const consolidated = consolidator.consolidate(storeResult.storedRecords);
  const consolidatedPath = path.join(
    path.dirname(storeResult.filePath),
    'consolidated-opportunities.json'
  );
  await fs.writeFile(consolidatedPath, JSON.stringify(consolidated, null, 2), 'utf-8');
  const compositeJsonPath = path.join(path.dirname(storeResult.filePath), 'composite-opportunities.json');
  const compositeCsvPath = path.join(path.dirname(storeResult.filePath), 'composite-opportunities.csv');
  await exportComposite({
    input: consolidatedPath,
    outputJson: compositeJsonPath,
    outputCsv: compositeCsvPath,
  });
  const compositeData = JSON.parse(await fs.readFile(compositeJsonPath, 'utf-8'));
  const qualityOutputPath = path.join(path.dirname(storeResult.filePath), 'quality-findings.json');
  const qualitySummary = await opportunityQuality({
    recordsFile: storeResult.filePath,
    compositesFile: compositeJsonPath,
    output: qualityOutputPath,
  });

  logger.info('Manifest processing complete', {
    filesProcessed: result.filesProcessed,
    opportunities: result.opportunities.length,
    errors: result.errors.length,
    outputPath,
    persistedPath: storeResult.filePath,
    clusters: clusters.length,
    clusterOutputPath,
    consolidatedPath,
    compositeJsonPath,
    compositeCsvPath,
    qualityOutputPath,
  });

  await opportunityMetrics(
    {
      file: storeResult.filePath,
      clustersFile: clusterOutputPath,
      output: path.join(path.dirname(storeResult.filePath), 'readiness-metrics.json'),
    },
    result.errors,
    compositeData,
    qualitySummary
  );

  if (result.errors.length > 0) {
    logger.warn('Some manifest entries failed', {
      failures: result.errors.slice(0, 5).map(({ entry, error }) => ({
        filePath: entry.filePath,
        error,
      })),
    });
  }
}

main().catch((error) => {
  logger.error('Failed to process source manifest', { error: error.message });
  process.exit(1);
});
