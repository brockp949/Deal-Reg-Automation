import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import { CompositeOpportunity, OpportunityRecord } from '../opportunities/types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type QualitySeverity = 'high' | 'medium' | 'low';

export interface QualityIssue {
  category: 'completeness' | 'consistency' | 'staleness';
  field?: string;
  message: string;
  severity: QualitySeverity;
}

export interface QualityFinding {
  composite_id: string;
  cluster_id: string;
  opportunity_ids: string[];
  completenessScore: number;
  consistencyScore: number;
  freshnessScore: number;
  overallScore: number;
  severity: QualitySeverity;
  missingFields: string[];
  conflictFields: string[];
  staleDays?: number;
  lastTouched?: string;
  issues: QualityIssue[];
  recommendedActions: string[];
  actionItems?: {
    total: number;
    withOwner: number;
    withDueDate: number;
  };
}

export interface QualitySummary {
  generatedAt: string;
  totalComposites: number;
  findings: QualityFinding[];
  averageScore: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  staleCount: number;
}

interface QualityOptions {
  recordsFile?: string;
  compositesFile?: string;
  output?: string;
  staleWarningDays?: number;
  staleCriticalDays?: number;
}

function parseArgs(): QualityOptions {
  const args = process.argv.slice(2);
  const options: QualityOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--records' && args[i + 1]) {
      options.recordsFile = args[++i];
    } else if (args[i] === '--composites' && args[i + 1]) {
      options.compositesFile = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (args[i] === '--stale-warning-days' && args[i + 1]) {
      options.staleWarningDays = Number(args[++i]);
    } else if (args[i] === '--stale-critical-days' && args[i + 1]) {
      options.staleCriticalDays = Number(args[++i]);
    }
  }
  return options;
}

async function loadJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function dedupe(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
    )
  );
}

function pickLatestTimestamp(records: OpportunityRecord[]): string | undefined {
  const timestamps = records
    .map((record) => record.metadata?.lastTouched)
    .filter((value): value is string => Boolean(value));
  if (!timestamps.length) return undefined;
  return timestamps.sort().reverse()[0];
}

function daysSince(timestamp: string, now: Date): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
}

function severityFromScore(score: number): QualitySeverity {
  if (score < 60) return 'high';
  if (score < 80) return 'medium';
  return 'low';
}

function evaluateComposite(
  composite: CompositeOpportunity,
  records: OpportunityRecord[],
  now: Date,
  staleWarningDays: number,
  staleCriticalDays: number
): QualityFinding {
  const issues: QualityIssue[] = [];
  const missingFields: string[] = [];
  const conflictFields: string[] = [];
  const structuredNextSteps = records.flatMap((record) => record.structuredNextSteps ?? []);
  const aggregatedNextSteps = dedupe([
    ...records.flatMap((record) => record.nextSteps ?? []),
    ...structuredNextSteps.map((step) => step.description),
  ]);
  const lastTouched = pickLatestTimestamp(records);
  const actionsWithOwner = structuredNextSteps.filter((step) => Boolean(step.owner)).length;
  const actionsWithDueDate = structuredNextSteps.filter((step) => Boolean(step.dueDate)).length;

  const completenessChecks: Array<{ field: string; valid: boolean; message: string }> = [
    { field: 'stage', valid: composite.stage !== 'unknown', message: 'Stage not inferred' },
    { field: 'priority', valid: Boolean(composite.priority), message: 'Priority missing' },
    { field: 'vendors', valid: composite.vendors.length > 0, message: 'Vendor missing' },
    { field: 'customers', valid: composite.customers.length > 0, message: 'Customer missing' },
    { field: 'actors', valid: composite.actors.length > 0, message: 'Actors missing' },
    { field: 'tags', valid: composite.tags.length > 0, message: 'Source tags missing' },
    {
      field: 'next_steps',
      valid: aggregatedNextSteps.length > 0,
      message: 'Next steps missing',
    },
  ];

  for (const check of completenessChecks) {
    if (!check.valid) {
      missingFields.push(check.field);
      issues.push({
        category: 'completeness',
        field: check.field,
        message: check.message,
        severity: check.field === 'stage' || check.field === 'customers' ? 'high' : 'medium',
      });
    }
  }

  const completenessScore = Math.max(0, 100 - missingFields.length * 12.5);

  if (composite.conflicts.stages.length > 1) {
    conflictFields.push('stage');
  }
  if (composite.conflicts.priorities.length > 1) {
    conflictFields.push('priority');
  }
  if (composite.conflicts.vendors.length > 1) {
    conflictFields.push('vendor');
  }
  if (composite.conflicts.customers.length > 1) {
    conflictFields.push('customer');
  }
  if (composite.conflicts.has_mixed_sources) {
    conflictFields.push('source');
  }

  if (conflictFields.length) {
    issues.push({
      category: 'consistency',
      message: `Conflicts detected for ${conflictFields.join(', ')}`,
      severity: conflictFields.length > 2 ? 'high' : 'medium',
    });
  }

  if (structuredNextSteps.length > 0 && actionsWithOwner === 0) {
    issues.push({
      category: 'completeness',
      message: 'Action items missing owners',
      severity: 'medium',
    });
  }

  if (structuredNextSteps.length > 0 && actionsWithDueDate === 0) {
    issues.push({
      category: 'completeness',
      message: 'Action items missing due dates',
      severity: 'low',
    });
  }

  const consistencyPenalty = conflictFields.length * 15;
  const consistencyScore = Math.max(0, 100 - consistencyPenalty);

  let freshnessScore = 100;
  let staleDays: number | undefined;
  if (!lastTouched) {
    freshnessScore = 40;
    issues.push({
      category: 'staleness',
      message: 'No activity timestamp detected from source files',
      severity: 'medium',
    });
  } else {
    staleDays = daysSince(lastTouched, now);
    if (staleDays >= staleCriticalDays) {
      freshnessScore -= 60;
      issues.push({
        category: 'staleness',
        message: `No updates for ${staleDays} days`,
        severity: 'high',
      });
    } else if (staleDays >= staleWarningDays) {
      freshnessScore -= 35;
      issues.push({
        category: 'staleness',
        message: `No updates for ${staleDays} days`,
        severity: 'medium',
      });
    }
  }
  freshnessScore = Math.max(0, freshnessScore);

  const overallScore = Math.round(
    completenessScore * 0.4 + consistencyScore * 0.3 + freshnessScore * 0.3
  );
  const severity = severityFromScore(overallScore);

  const recommendedActions: string[] = [];
  if (missingFields.includes('stage')) {
    recommendedActions.push('Review Gmail/Drive evidence to assign a concrete stage.');
  }
  if (missingFields.includes('next_steps')) {
    recommendedActions.push('Add a follow-up action item or owner in the transcript/email.');
  }
  if (structuredNextSteps.length > 0 && actionsWithOwner === 0) {
    recommendedActions.push('Assign owners to the captured action items for accountability.');
  }
  if (structuredNextSteps.length > 0 && actionsWithDueDate === 0) {
    recommendedActions.push('Add due dates or SLA markers to the captured action items.');
  }
  if (conflictFields.includes('stage') || conflictFields.includes('customer')) {
    recommendedActions.push('Resolve conflicting data by editing the underlying source notes.');
  }
  if (!recommendedActions.length && severity !== 'low') {
    recommendedActions.push('Audit source documents for missing context and rerun parsers.');
  }

  return {
    composite_id: composite.composite_id,
    cluster_id: composite.cluster_id,
    opportunity_ids: composite.opportunity_ids,
    completenessScore,
    consistencyScore,
    freshnessScore,
    overallScore,
    severity,
    missingFields,
    conflictFields,
    staleDays,
    lastTouched,
    issues,
    recommendedActions,
    actionItems:
      structuredNextSteps.length > 0
        ? {
            total: structuredNextSteps.length,
            withOwner: actionsWithOwner,
            withDueDate: actionsWithDueDate,
          }
        : undefined,
  };
}

function summarizeQuality(findings: QualityFinding[]): QualitySummary {
  const totalComposites = findings.length;
  const highCount = findings.filter((finding) => finding.severity === 'high').length;
  const mediumCount = findings.filter((finding) => finding.severity === 'medium').length;
  const lowCount = findings.filter((finding) => finding.severity === 'low').length;
  const staleCount = findings.filter(
    (finding) => typeof finding.staleDays === 'number' && finding.staleDays >= 30
  ).length;
  const averageScore =
    findings.reduce((sum, finding) => sum + finding.overallScore, 0) / (findings.length || 1);

  return {
    generatedAt: new Date().toISOString(),
    totalComposites,
    findings,
    averageScore,
    highCount,
    mediumCount,
    lowCount,
    staleCount,
  };
}

export async function main(optionsOverride?: QualityOptions): Promise<QualitySummary> {
  const options = optionsOverride ?? parseArgs();
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const recordsPath = options.recordsFile ?? path.join(opportunitiesDir, 'opportunities.json');
  const compositesPath =
    options.compositesFile ?? path.join(opportunitiesDir, 'composite-opportunities.json');
  const outputPath = options.output ?? path.join(opportunitiesDir, 'quality-findings.json');
  const staleWarningDays = options.staleWarningDays ?? 30;
  const staleCriticalDays = options.staleCriticalDays ?? 45;

  const [records, composites] = await Promise.all([
    loadJson<OpportunityRecord[]>(recordsPath),
    loadJson<CompositeOpportunity[]>(compositesPath),
  ]);

  const recordMap = new Map(records.map((record) => [record.id, record]));
  const now = new Date();
  const findings = composites.map((composite) => {
    const linkedRecords = composite.opportunity_ids
      .map((id) => recordMap.get(id))
      .filter((record): record is OpportunityRecord => Boolean(record));
    return evaluateComposite(composite, linkedRecords, now, staleWarningDays, staleCriticalDays);
  });

  const summary = summarizeQuality(findings);
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2), 'utf-8');

  logger.info('Opportunity quality findings generated', {
    outputPath,
    total: summary.totalComposites,
    high: summary.highCount,
    medium: summary.mediumCount,
    low: summary.lowCount,
  });

  return summary;
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to compute opportunity quality findings', { error: error.message });
    process.exit(1);
  });
}
