import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import { OpportunityRecord, CompositeOpportunity } from '../opportunities/types';
import type { QualitySummary } from './opportunityQuality';
import type { AnnotationStats } from '../feedback/AnnotationService';

interface MetricsOptions {
  file?: string;
  clustersFile?: string;
  output?: string;
}

export interface OpportunityMetrics {
  totalOpportunities: number;
  stageBreakdown: Record<string, number>;
  priorityBreakdown: Record<string, number>;
  clusterCount: number;
  clusteredOpportunityCount: number;
  generatedAt: string;
  processingErrors: number;
  errorDetails: Array<{ filePath: string; error: string }>;
  composites?: {
    total: number;
    withConflicts: number;
    mixedSources: number;
    conflictBreakdown: {
      stages: number;
      priorities: number;
      vendors: number;
      customers: number;
    };
  };
  actionItems?: {
    total: number;
    withOwner: number;
    withDueDate: number;
  };
  quality?: {
    findings: number;
    high: number;
    medium: number;
    low: number;
    stale: number;
    averageScore: number;
  };
  feedback?: {
    total: number;
    stageOverrides: number;
    priorityOverrides: number;
    notes: number;
  };
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

function summarize(
  records: OpportunityRecord[],
  clusters: any[],
  errors: Array<{ entry: { filePath: string }; error: string }>,
  composites?: CompositeOpportunity[],
  quality?: QualitySummary,
  feedback?: AnnotationStats
): OpportunityMetrics {
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

  const actionItems = records.flatMap((record) => record.structuredNextSteps ?? []);

  return {
    totalOpportunities: records.length,
    stageBreakdown,
    priorityBreakdown,
    clusterCount: clusters.length,
    clusteredOpportunityCount: clusteredOpportunityIds.size,
    generatedAt: new Date().toISOString(),
    processingErrors: errors.length,
    errorDetails: errors.slice(0, 10).map(({ entry, error }) => ({
      filePath: entry.filePath,
      error,
    })),
    composites: composites
      ? {
          total: composites.length,
          withConflicts: composites.filter(
            (entry) =>
              entry.conflicts.stages.length ||
              entry.conflicts.priorities.length ||
              entry.conflicts.vendors.length ||
              entry.conflicts.customers.length
          ).length,
          mixedSources: composites.filter((entry) => entry.conflicts.has_mixed_sources).length,
          conflictBreakdown: {
            stages: composites.filter((entry) => entry.conflicts.stages.length > 1).length,
            priorities: composites.filter((entry) => entry.conflicts.priorities.length > 1).length,
            vendors: composites.filter((entry) => entry.conflicts.vendors.length > 1).length,
            customers: composites.filter((entry) => entry.conflicts.customers.length > 1).length,
          },
        }
      : undefined,
    actionItems: actionItems.length
      ? {
          total: actionItems.length,
          withOwner: actionItems.filter((item) => Boolean(item.owner)).length,
          withDueDate: actionItems.filter((item) => Boolean(item.dueDate)).length,
        }
      : undefined,
    quality: quality
      ? {
          findings: quality.totalComposites,
          high: quality.highCount,
          medium: quality.mediumCount,
          low: quality.lowCount,
          stale: quality.staleCount,
          averageScore: Number(quality.averageScore.toFixed(1)),
        }
      : undefined,
    feedback: feedback
      ? {
          total: feedback.totalAnnotations,
          stageOverrides: feedback.stageOverrides,
          priorityOverrides: feedback.priorityOverrides,
          notes: feedback.notesCount,
        }
      : undefined,
  };
}

export async function main(
  optionsOverride?: MetricsOptions,
  errors?: Array<{ entry: { filePath: string }; error: string }>,
  composites?: CompositeOpportunity[],
  quality?: QualitySummary,
  feedback?: AnnotationStats
) {
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
  const metrics = summarize(records, clusters, errors ?? [], composites, quality, feedback);

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
