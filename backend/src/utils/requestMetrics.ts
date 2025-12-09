import { Request, Response, NextFunction } from 'express';
import { metricsRegistry } from './metricsRegistry';

let totalRequests = 0;
let errorRequests = 0;
let totalLatencyMs = 0;
const routeCounters: Record<string, { count: number; error: number; totalLatency: number }> = {};

metricsRegistry.registerGauge('http_requests_total', () => totalRequests);
metricsRegistry.registerGauge('http_requests_errors', () => errorRequests);
metricsRegistry.registerGauge('http_requests_avg_latency_ms', () =>
  totalRequests === 0 ? 0 : Number((totalLatencyMs / totalRequests).toFixed(2))
);
metricsRegistry.registerGauge('http_requests_by_route', () => {
  const snapshot: Record<string, { count: number; errors: number; avgLatencyMs: number }> = {};
  Object.entries(routeCounters).forEach(([route, stats]) => {
    snapshot[route] = {
      count: stats.count,
      errors: stats.error,
      avgLatencyMs: stats.count === 0 ? 0 : Number((stats.totalLatency / stats.count).toFixed(2)),
    };
  });
  return snapshot;
});

export function requestMetrics(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  totalRequests += 1;
  const key = `${req.method}:${req.route ? req.route.path : req.path}`;
  routeCounters[key] = routeCounters[key] || { count: 0, error: 0, totalLatency: 0 };
  routeCounters[key].count += 1;

  res.on('finish', () => {
    const duration = Date.now() - start;
    totalLatencyMs += duration;
    if (res.statusCode >= 400) {
      errorRequests += 1;
      routeCounters[key].error += 1;
    }
    routeCounters[key].totalLatency += duration;
  });

  next();
}
