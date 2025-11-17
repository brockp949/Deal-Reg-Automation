import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import { main as metricsMain } from './opportunityMetrics';
import { OpportunityMetrics } from './opportunityMetrics';

interface ReportOptions {
  metricsFile?: string;
  output?: string;
  refresh?: boolean;
  publishPath?: string;
}

function parseArgs(): ReportOptions {
  const args = process.argv.slice(2);
  const options: ReportOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--metrics' && args[i + 1]) {
      options.metricsFile = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (args[i] === '--refresh') {
      options.refresh = true;
    } else if (args[i] === '--publish' && args[i + 1]) {
      options.publishPath = args[++i];
    }
  }
  return options;
}

async function loadMetrics(filePath: string): Promise<OpportunityMetrics> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as OpportunityMetrics;
}

function renderReport(metrics: OpportunityMetrics): string {
  const lines: string[] = [];
  lines.push('# Opportunity Readiness Report');
  lines.push(`Generated: ${metrics.generatedAt}`);
  lines.push('');
  if (metrics.processingErrors > 0) {
    lines.push(`⚠️ Processing errors: ${metrics.processingErrors}`);
    metrics.errorDetails.forEach((detail) => {
      lines.push(`- ${detail.filePath}: ${detail.error}`);
    });
    lines.push('');
  }
  lines.push(`- Total opportunities: **${metrics.totalOpportunities}**`);
  lines.push(
    `- Clustered opportunities: **${metrics.clusteredOpportunityCount}** (across ${metrics.clusterCount} clusters)`
  );
  if (metrics.composites) {
    lines.push(
      `- Composite opportunities: **${metrics.composites.total}** (${metrics.composites.withConflicts} with conflicts, ${metrics.composites.mixedSources} mixed-source)`
    );
    if (metrics.composites.conflictBreakdown) {
      const breakdown = metrics.composites.conflictBreakdown;
      lines.push(
        `  - Conflict breakdown: stages ${breakdown.stages}, priorities ${breakdown.priorities}, vendors ${breakdown.vendors}, customers ${breakdown.customers}`
      );
    }
  }
  lines.push('');
  lines.push('## Stage Breakdown');
  Object.entries(metrics.stageBreakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([stage, count]) => {
      lines.push(`- ${stage}: ${count}`);
    });
  lines.push('');
  lines.push('## Priority Breakdown');
  Object.entries(metrics.priorityBreakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([priority, count]) => {
      lines.push(`- ${priority}: ${count}`);
    });
  lines.push('');
  lines.push('---');
  lines.push('Generated via `npm run source:report`. Ensure `source:process` has been run to refresh opportunities.');
  return lines.join('\n');
}

export async function main(optionsOverride?: ReportOptions, metrics?: OpportunityMetrics) {
  const options = optionsOverride ?? parseArgs();
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const metricsPath = options.metricsFile ?? path.join(opportunitiesDir, 'readiness-metrics.json');
  const outputPath =
    options.output ?? path.join(opportunitiesDir, 'opportunity-readiness-report.md');

  if (options.refresh) {
    await metricsMain({
      file: path.join(opportunitiesDir, 'opportunities.json'),
      clustersFile: path.join(opportunitiesDir, 'opportunity-clusters.json'),
      output: metricsPath,
    });
  }

  const finalMetrics = metrics ?? (await loadMetrics(metricsPath));
  const report = renderReport(finalMetrics);
  await fs.writeFile(outputPath, report, 'utf-8');

  if (options.publishPath) {
    await fs.mkdir(path.dirname(options.publishPath), { recursive: true });
    await fs.writeFile(options.publishPath, report, 'utf-8');
  }

  logger.info('Opportunity readiness report generated', {
    outputPath,
    publishPath: options.publishPath,
    generatedAt: finalMetrics.generatedAt,
    totalOpportunities: finalMetrics.totalOpportunities,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to generate opportunity readiness report', { error: error.message });
    process.exit(1);
  });
}
