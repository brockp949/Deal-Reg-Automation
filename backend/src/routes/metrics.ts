import { Router, Request, Response } from 'express';
import { poolMetrics } from '../utils/poolMetrics';
import { getQueueStats } from '../queues/fileProcessingQueue';
import { getJobStats } from '../services/jobTracker';
import { metricsRegistry } from '../utils/metricsRegistry';

const router = Router();

/**
 * GET /api/metrics
 * Basic JSON metrics (no Prometheus formatting to avoid extra deps).
 */
router.get('/', async (_req: Request, res: Response) => {
  const [queue, jobs] = await Promise.all([getQueueStats(), getJobStats()]);
  const db = poolMetrics();
  const custom = metricsRegistry.snapshot();

  if (_req.query.format === 'prometheus') {
    const prom = toPrometheus({ queue, jobs, db, custom });
    res.type('text/plain').send(prom);
    return;
  }

  res.json({
    success: true,
    data: {
      uptimeSeconds: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      db,
      queue,
      jobs,
      custom,
    },
  });
});

function toPrometheus(data: any): string {
  const lines: string[] = [];
  const uptime = Math.round(process.uptime());
  lines.push(`# HELP process_uptime_seconds Process uptime in seconds`);
  lines.push(`# TYPE process_uptime_seconds gauge`);
  lines.push(`process_uptime_seconds ${uptime}`);

  const mem = process.memoryUsage();
  lines.push(`# TYPE process_memory_rss_bytes gauge`);
  lines.push(`process_memory_rss_bytes ${mem.rss}`);
  lines.push(`# TYPE process_memory_heap_used_bytes gauge`);
  lines.push(`process_memory_heap_used_bytes ${mem.heapUsed}`);

  if (data.db) {
    lines.push(`# TYPE db_pool_connections gauge`);
    lines.push(`db_pool_connections{state="total"} ${data.db.totalConnections}`);
    lines.push(`db_pool_connections{state="idle"} ${data.db.idleConnections}`);
    lines.push(`db_pool_connections{state="waiting"} ${data.db.waitingClients}`);
  }

  if (data.queue) {
    lines.push(`# TYPE queue_jobs gauge`);
    for (const key of ['waiting', 'active', 'completed', 'failed', 'delayed', 'total']) {
      if (data.queue[key] !== undefined) {
        lines.push(`queue_jobs{state="${key}"} ${data.queue[key]}`);
      }
    }
  }

  if (data.jobs) {
    lines.push(`# TYPE tracker_jobs_total gauge`);
    for (const key of Object.keys(data.jobs)) {
      lines.push(`tracker_jobs_total{status="${key}"} ${data.jobs[key]}`);
    }
  }

  if (data.custom) {
    if (typeof data.custom.http_requests_total === 'number') {
      lines.push(`# TYPE http_requests_total counter`);
      lines.push(`http_requests_total ${data.custom.http_requests_total}`);
    }
    if (typeof data.custom.http_requests_errors === 'number') {
      lines.push(`# TYPE http_requests_errors counter`);
      lines.push(`http_requests_errors ${data.custom.http_requests_errors}`);
    }
    if (typeof data.custom.http_requests_avg_latency_ms === 'number') {
      lines.push(`# TYPE http_requests_avg_latency_ms gauge`);
      lines.push(`http_requests_avg_latency_ms ${data.custom.http_requests_avg_latency_ms}`);
    }
    if (data.custom.http_requests_by_route && typeof data.custom.http_requests_by_route === 'object') {
      lines.push(`# TYPE http_requests_route_total counter`);
      lines.push(`# TYPE http_requests_route_errors counter`);
      lines.push(`# TYPE http_requests_route_avg_latency_ms gauge`);
      Object.entries<any>(data.custom.http_requests_by_route).forEach(([route, stats]) => {
        const labelRoute = route.replace(/"/g, '\\"');
        if (typeof stats.count === 'number') {
          lines.push(`http_requests_route_total{route="${labelRoute}"} ${stats.count}`);
        }
        if (typeof stats.errors === 'number') {
          lines.push(`http_requests_route_errors{route="${labelRoute}"} ${stats.errors}`);
        }
        if (typeof stats.avgLatencyMs === 'number') {
          lines.push(`http_requests_route_avg_latency_ms{route="${labelRoute}"} ${stats.avgLatencyMs}`);
        }
      });
    }
  }

  return lines.join('\n') + '\n';
}

export default router;
