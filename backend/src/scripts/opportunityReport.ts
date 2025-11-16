import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import { main as metricsMain } from './opportunityMetrics';

interface ReportOptions {
  metricsFile?: string;
  output?: string;
  refresh?: boolean;
}

interface OpportunityMetrics {
  totalOpportunities: number;
  stageBreakdown: Record<string, number>;
  priorityBreakdown: Record<string, number>;
  clusterCount: number;
  clusteredOpportunityCount: number;
  generatedAt: string;
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
  lines.push(`- Total opportunities: **${metrics.totalOpportunities}**`);
  lines.push(
    `- Clustered opportunities: **${metrics.clusteredOpportunityCount}** (across ${metrics.clusterCount} clusters)`
  );
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

export async function main(optionsOverride?: ReportOptions) {
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

  const metrics = await loadMetrics(metricsPath);
  const report = renderReport(metrics);
  await fs.writeFile(outputPath, report, 'utf-8');

  logger.info('Opportunity readiness report generated', {
    outputPath,
    generatedAt: metrics.generatedAt,
    totalOpportunities: metrics.totalOpportunities,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to generate opportunity readiness report', { error: error.message });
    process.exit(1);
  });
}
