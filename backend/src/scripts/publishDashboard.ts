import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import { OpportunityMetrics } from './opportunityMetrics';
import { QualitySummary } from './opportunityQuality';
import { CompositeOpportunity } from '../opportunities/types';

interface PublishOptions {
  historyLimit?: number;
  trendLimit?: number;
  publishPath?: string;
  dashboardPath?: string;
}

interface HistorySnapshot {
  id: string;
  date: string;
  metrics: OpportunityMetrics;
  quality?: QualitySummary;
}

interface DashboardData {
  generatedAt: string;
  totals: {
    opportunities: number;
    clusters: number;
    clusteredOpportunities: number;
  };
  stageBreakdown: Record<string, number>;
  priorityBreakdown: Record<string, number>;
  actionItems?: OpportunityMetrics['actionItems'];
  quality?: {
    findings: number;
    averageScore: number;
    high: number;
    medium: number;
    low: number;
    stale: number;
  };
  feedback?: OpportunityMetrics['feedback'];
  history: {
    stageTrend: Array<{ date: string; stages: Record<string, number> }>;
    priorityTrend: Array<{ date: string; priorities: Record<string, number> }>;
    qualityTrend: Array<{
      date: string;
      averageScore?: number;
      findings?: number;
      high?: number;
      medium?: number;
      low?: number;
    }>;
  };
  topConflicts: Array<{
    composite_id: string;
    stage: string;
    priority: string;
    conflictFields: string[];
    score: number;
    vendors: string[];
    customers: string[];
  }>;
}

const DEFAULT_HISTORY_LIMIT = 90;
const DEFAULT_TREND_LIMIT = 30;

function parseArgs(): PublishOptions {
  const args = process.argv.slice(2);
  const options: PublishOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--history-limit' && args[i + 1]) {
      options.historyLimit = Number(args[++i]);
    } else if (args[i] === '--trend-limit' && args[i + 1]) {
      options.trendLimit = Number(args[++i]);
    } else if (args[i] === '--publish' && args[i + 1]) {
      options.publishPath = args[++i];
    } else if (args[i] === '--dashboard' && args[i + 1]) {
      options.dashboardPath = args[++i];
    }
  }
  return options;
}

async function loadJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

async function loadOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return await loadJson<T>(filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace(/[:.]/g, '').replace(/Z$/, '');
  }
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
    date.getUTCHours()
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

async function enforceHistoryLimit(historyDir: string, limit: number) {
  const entries = await fs.readdir(historyDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  directories.sort();
  const excess = directories.length - limit;
  if (excess <= 0) return;
  for (let i = 0; i < excess; i++) {
    const dir = path.join(historyDir, directories[i]);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function loadHistorySnapshots(
  historyDir: string,
  limit: number
): Promise<HistorySnapshot[]> {
  const entries = await fs.readdir(historyDir, { withFileTypes: true }).catch(() => []);
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const selected = directories.slice(-limit);
  const snapshots: HistorySnapshot[] = [];

  for (const dir of selected) {
    try {
      const snapshotPath = path.join(historyDir, dir);
      const metricsPath = path.join(snapshotPath, 'readiness-metrics.json');
      const qualityPath = path.join(snapshotPath, 'quality-findings.json');
      const metrics = await loadJson<OpportunityMetrics>(metricsPath);
      const quality = await loadOptionalJson<QualitySummary>(qualityPath);
      snapshots.push({
        id: dir,
        date: metrics.generatedAt ?? dir,
        metrics,
        quality,
      });
    } catch (error: any) {
      logger.warn('Failed to load history snapshot', { dir, error: error.message });
    }
  }

  return snapshots;
}

function buildDashboardData(
  metrics: OpportunityMetrics,
  quality: QualitySummary | undefined,
  composites: CompositeOpportunity[],
  history: HistorySnapshot[]
): DashboardData {
  const stageTrend = history.map((snapshot) => ({
    date: snapshot.date,
    stages: snapshot.metrics.stageBreakdown,
  }));

  const priorityTrend = history.map((snapshot) => ({
    date: snapshot.date,
    priorities: snapshot.metrics.priorityBreakdown,
  }));

  const qualityTrend = history.map((snapshot) => ({
    date: snapshot.date,
    averageScore: snapshot.quality?.averageScore,
    findings: snapshot.quality?.totalComposites,
    high: snapshot.quality?.highCount,
    medium: snapshot.quality?.mediumCount,
    low: snapshot.quality?.lowCount,
  }));

  const topConflicts = composites
    .map((entry) => {
      const conflictFields: string[] = [];
      if (entry.conflicts.stages.length > 1) conflictFields.push('stage');
      if (entry.conflicts.priorities.length > 1) conflictFields.push('priority');
      if (entry.conflicts.vendors.length > 1) conflictFields.push('vendor');
      if (entry.conflicts.customers.length > 1) conflictFields.push('customer');
      if (entry.conflicts.has_mixed_sources) conflictFields.push('source');
      const conflictScore =
        conflictFields.length +
        entry.conflicts.stages.length +
        entry.conflicts.priorities.length +
        entry.conflicts.vendors.length +
        entry.conflicts.customers.length;
      return {
        composite_id: entry.composite_id,
        stage: entry.stage,
        priority: entry.priority,
        conflictFields,
        score: conflictScore,
        vendors: entry.vendors,
        customers: entry.customers,
      };
    })
    .filter((entry) => entry.conflictFields.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    generatedAt: metrics.generatedAt ?? new Date().toISOString(),
    totals: {
      opportunities: metrics.totalOpportunities,
      clusters: metrics.clusterCount,
      clusteredOpportunities: metrics.clusteredOpportunityCount,
    },
    stageBreakdown: metrics.stageBreakdown,
    priorityBreakdown: metrics.priorityBreakdown,
    actionItems: metrics.actionItems,
    quality: quality
      ? {
          findings: quality.totalComposites,
          averageScore: Number(quality.averageScore.toFixed(1)),
          high: quality.highCount,
          medium: quality.mediumCount,
          low: quality.lowCount,
          stale: quality.staleCount,
        }
      : undefined,
    feedback: metrics.feedback
      ? {
          total: metrics.feedback.total,
          stageOverrides: metrics.feedback.stageOverrides,
          priorityOverrides: metrics.feedback.priorityOverrides,
          notes: metrics.feedback.notes,
        }
      : undefined,
    history: {
      stageTrend,
      priorityTrend,
      qualityTrend,
    },
    topConflicts,
  };
}

function formatTable(headers: string[], rows: Array<Array<string | number>>): string {
  const headerLine = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [headerLine, separator, body].filter(Boolean).join('\n');
}

function renderDashboardMarkdown(data: DashboardData): string {
  const stageRows = Object.entries(data.stageBreakdown).map(([stage, count]) => [stage, count]);
  const priorityRows = Object.entries(data.priorityBreakdown).map(([priority, count]) => [
    priority,
    count,
  ]);

  const { stageTrend, priorityTrend, qualityTrend } = data.history;
  const stageKeys = Array.from(
    new Set(stageTrend.flatMap((entry) => Object.keys(entry.stages)))
  ).sort();
  const priorityKeys = Array.from(
    new Set(priorityTrend.flatMap((entry) => Object.keys(entry.priorities)))
  ).sort();

  const stageTrendRows = stageTrend.map((entry) => [
    entry.date,
    ...stageKeys.map((key) => entry.stages[key] ?? 0),
  ]);
  const priorityTrendRows = priorityTrend.map((entry) => [
    entry.date,
    ...priorityKeys.map((key) => entry.priorities[key] ?? 0),
  ]);
  const qualityTrendRows = qualityTrend.map((entry) => [
    entry.date,
    entry.averageScore ?? '',
    entry.findings ?? '',
    entry.high ?? '',
    entry.medium ?? '',
    entry.low ?? '',
  ]);

  const conflictRows = data.topConflicts.map((conflict) => [
    conflict.composite_id,
    conflict.stage,
    conflict.priority,
    conflict.conflictFields.join(', '),
    conflict.vendors.join(', '),
    conflict.customers.join(', '),
  ]);

  const lines: string[] = [];
  lines.push('# Opportunity Dashboard');
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push('');
  lines.push('## Key Metrics');
  lines.push(
    `- Total opportunities: **${data.totals.opportunities}** (clustered ${data.totals.clusteredOpportunities} across ${data.totals.clusters} clusters)`
  );
  if (data.actionItems) {
    lines.push(
      `- Action items: **${data.actionItems.total}** (${data.actionItems.withOwner} with owners, ${data.actionItems.withDueDate} with due dates)`
    );
  }
  if (data.quality) {
    lines.push(
      `- Quality findings: **${data.quality.findings}** (avg score ${data.quality.averageScore}, high ${data.quality.high}, medium ${data.quality.medium}, low ${data.quality.low}, stale ${data.quality.stale})`
    );
  }
  if (data.feedback) {
    lines.push(
      `- Feedback overrides: **${data.feedback.total}** (${data.feedback.stageOverrides} stage corrections, ${data.feedback.priorityOverrides} priority, ${data.feedback.notes} with notes)`
    );
  }
  lines.push('');
  lines.push('## Stage Breakdown');
  lines.push(formatTable(['Stage', 'Count'], stageRows));
  lines.push('');
  lines.push('## Priority Breakdown');
  lines.push(formatTable(['Priority', 'Count'], priorityRows));
  lines.push('');
  if (conflictRows.length) {
    lines.push('## Top Conflicts');
    lines.push(
      formatTable(
        ['Composite', 'Stage', 'Priority', 'Conflict Fields', 'Vendors', 'Customers'],
        conflictRows
      )
    );
    lines.push('');
  }
  if (stageTrendRows.length) {
    lines.push('## Stage Trend (recent runs)');
    lines.push(formatTable(['Date', ...stageKeys], stageTrendRows));
    lines.push('');
  }
  if (priorityTrendRows.length) {
    lines.push('## Priority Trend (recent runs)');
    lines.push(formatTable(['Date', ...priorityKeys], priorityTrendRows));
    lines.push('');
  }
  if (qualityTrendRows.length) {
    lines.push('## Quality Trend (recent runs)');
    lines.push(
      formatTable(['Date', 'Avg Score', 'Findings', 'High', 'Medium', 'Low'], qualityTrendRows)
    );
    lines.push('');
  }

  return lines.join('\n');
}

export async function main(optionsOverride?: PublishOptions) {
  const options = optionsOverride ?? parseArgs();
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const historyDir = path.join(opportunitiesDir, 'history');
  await fs.mkdir(opportunitiesDir, { recursive: true });
  await fs.mkdir(historyDir, { recursive: true });

  const metricsPath = path.join(opportunitiesDir, 'readiness-metrics.json');
  const qualityPath = path.join(opportunitiesDir, 'quality-findings.json');
  const compositesPath = path.join(opportunitiesDir, 'composite-opportunities.json');

  const metrics = await loadJson<OpportunityMetrics>(metricsPath);
  const quality = await loadOptionalJson<QualitySummary>(qualityPath);
  const composites = await loadJson<CompositeOpportunity[]>(compositesPath);

  const snapshotId = formatTimestamp(metrics.generatedAt ?? new Date().toISOString());
  const snapshotDir = path.join(historyDir, snapshotId);
  await fs.mkdir(snapshotDir, { recursive: true });

  await fs.writeFile(path.join(snapshotDir, 'readiness-metrics.json'), JSON.stringify(metrics, null, 2));
  if (quality) {
    await fs.writeFile(
      path.join(snapshotDir, 'quality-findings.json'),
      JSON.stringify(quality, null, 2)
    );
  }

  await enforceHistoryLimit(historyDir, options.historyLimit ?? DEFAULT_HISTORY_LIMIT);
  const history = await loadHistorySnapshots(historyDir, options.trendLimit ?? DEFAULT_TREND_LIMIT);
  const dashboard = buildDashboardData(metrics, quality, composites, history);
  const dashboardPath = options.dashboardPath ?? path.join(opportunitiesDir, 'dashboard.json');
  await fs.writeFile(dashboardPath, JSON.stringify(dashboard, null, 2));

  if (options.publishPath) {
    await fs.mkdir(path.dirname(options.publishPath), { recursive: true });
    const markdown = renderDashboardMarkdown(dashboard);
    await fs.writeFile(options.publishPath, markdown, 'utf-8');
  }

  logger.info('Dashboard published', {
    snapshot: snapshotId,
    dashboardPath,
    publishPath: options.publishPath,
    historyCount: history.length,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to publish dashboard', { error: error.message });
    process.exit(1);
  });
}
