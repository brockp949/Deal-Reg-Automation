/**
 * Pipeline Metrics Tracking and Recording
 *
 * Records pipeline execution metrics to database for historical analysis
 * and monitoring.
 *
 * Phase 7.3 - Deployment Hardening & Observability
 */

import Database from 'better-sqlite3';
import path from 'path';
import { config } from '../config';
import logger from '../utils/logger';

export interface PipelineMetric {
  id?: number;
  phase: string;
  startTime: Date;
  endTime: Date;
  duration: number; // milliseconds
  status: 'success' | 'failure' | 'timeout';
  metadata?: Record<string, any>;
  errorMessage?: string;
  createdAt?: Date;
}

export interface MetricsQuery {
  phase?: string;
  startDate?: Date;
  endDate?: Date;
  status?: 'success' | 'failure' | 'timeout';
  limit?: number;
}

class PipelineMetricsStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultPath = path.resolve(config.upload.directory, 'pipeline-metrics.db');
    this.db = new Database(dbPath || defaultPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phase TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        duration INTEGER NOT NULL,
        status TEXT NOT NULL,
        metadata TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_phase ON pipeline_metrics(phase);
      CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_status ON pipeline_metrics(status);
      CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_created_at ON pipeline_metrics(created_at);
    `);
  }

  record(metric: PipelineMetric): number {
    const stmt = this.db.prepare(`
      INSERT INTO pipeline_metrics (phase, start_time, end_time, duration, status, metadata, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      metric.phase,
      metric.startTime.toISOString(),
      metric.endTime.toISOString(),
      metric.duration,
      metric.status,
      metric.metadata ? JSON.stringify(metric.metadata) : null,
      metric.errorMessage || null
    );

    logger.info('Pipeline metric recorded', {
      id: result.lastInsertRowid,
      phase: metric.phase,
      duration: metric.duration,
      status: metric.status,
    });

    return result.lastInsertRowid as number;
  }

  query(query: MetricsQuery = {}): PipelineMetric[] {
    let sql = 'SELECT * FROM pipeline_metrics WHERE 1=1';
    const params: any[] = [];

    if (query.phase) {
      sql += ' AND phase = ?';
      params.push(query.phase);
    }

    if (query.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    if (query.startDate) {
      sql += ' AND start_time >= ?';
      params.push(query.startDate.toISOString());
    }

    if (query.endDate) {
      sql += ' AND end_time <= ?';
      params.push(query.endDate.toISOString());
    }

    sql += ' ORDER BY created_at DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => ({
      id: row.id,
      phase: row.phase,
      startTime: new Date(row.start_time),
      endTime: new Date(row.end_time),
      duration: row.duration,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
    }));
  }

  getLatestByPhase(phase: string): PipelineMetric | null {
    const results = this.query({ phase, limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  getAverageDuration(phase: string, days: number = 7): number | null {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stmt = this.db.prepare(`
      SELECT AVG(duration) as avg_duration
      FROM pipeline_metrics
      WHERE phase = ? AND start_time >= ? AND status = 'success'
    `);

    const result = stmt.get(phase, startDate.toISOString()) as any;
    return result?.avg_duration || null;
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let metricsStore: PipelineMetricsStore | null = null;

export function getMetricsStore(): PipelineMetricsStore {
  if (!metricsStore) {
    metricsStore = new PipelineMetricsStore();
  }
  return metricsStore;
}

export function recordPipelineMetrics(metric: PipelineMetric): number {
  return getMetricsStore().record(metric);
}

export function queryPipelineMetrics(query: MetricsQuery = {}): PipelineMetric[] {
  return getMetricsStore().query(query);
}
