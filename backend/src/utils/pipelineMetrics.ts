import { promises as fs } from 'fs';
import path from 'path';
import logger from './logger';
import { config } from '../config';

interface PipelineMetricsRecorderOptions {
  baseDir?: string;
  thresholdsMs?: Record<string, number>;
}

interface PipelineStepMetric {
  name: string;
  durationMs: number;
  memoryDiffMb: number;
}

export interface PipelineMetricsSummary {
  generatedAt: string;
  steps: PipelineStepMetric[];
  alerts: string[];
  extras?: Record<string, unknown>;
}

export class PipelineMetricsRecorder {
  private readonly baseDir: string;
  private readonly thresholds: Record<string, number>;
  private readonly steps = new Map<
    string,
    { start: bigint; memoryStart: number; durationMs?: number; memoryDiffMb?: number }
  >();

  constructor(options: PipelineMetricsRecorderOptions = {}) {
    this.baseDir = options.baseDir ?? config.upload.directory;
    this.thresholds = options.thresholdsMs ?? {
      process_source_manifest: 5 * 60 * 1000,
      publish_dashboard: 60 * 1000,
    };
  }

  startStep(name: string) {
    this.steps.set(name, {
      start: process.hrtime.bigint(),
      memoryStart: process.memoryUsage().rss,
    });
  }

  endStep(name: string) {
    const step = this.steps.get(name);
    if (!step || step.durationMs !== undefined) return;
    const end = process.hrtime.bigint();
    const durationMs = Number(end - step.start) / 1_000_000;
    const memoryDiffMb = (process.memoryUsage().rss - step.memoryStart) / (1024 * 1024);
    step.durationMs = Math.round(durationMs);
    step.memoryDiffMb = Number(memoryDiffMb.toFixed(2));
  }

  async persist(extras?: Record<string, unknown>) {
    const steps: PipelineStepMetric[] = [];
    const alerts: string[] = [];

    for (const [name, data] of this.steps.entries()) {
      if (data.durationMs === undefined || data.memoryDiffMb === undefined) continue;
      steps.push({ name, durationMs: data.durationMs, memoryDiffMb: data.memoryDiffMb });
      const threshold = this.thresholds[name];
      if (threshold && data.durationMs > threshold) {
        alerts.push(`${name} exceeded threshold (${data.durationMs}ms > ${threshold}ms)`);
      }
    }

    const summary: PipelineMetricsSummary = {
      generatedAt: new Date().toISOString(),
      steps,
      alerts,
      extras,
    };

    const opportunitiesDir = path.resolve(this.baseDir, 'opportunities');
    await fs.mkdir(opportunitiesDir, { recursive: true });
    const metricsPath = path.join(opportunitiesDir, 'pipeline-metrics.json');
    await fs.writeFile(metricsPath, JSON.stringify(summary, null, 2), 'utf-8');

    const historyDir = path.join(opportunitiesDir, 'history');
    await fs.mkdir(historyDir, { recursive: true });
    const historyPath = path.join(historyDir, 'pipeline-metrics.jsonl');
    await fs.appendFile(historyPath, JSON.stringify(summary) + '\n', 'utf-8');

    if (alerts.length) {
      logger.warn('Pipeline metrics alerts generated', { alerts });
    }
  }
}

export default PipelineMetricsRecorder;
