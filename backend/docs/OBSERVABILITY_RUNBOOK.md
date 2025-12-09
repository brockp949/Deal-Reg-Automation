# Observability & Ops Runbook

## Endpoints
- Liveness: `/healthz`
- Readiness: `/readyz` (DB + Redis)
- Metrics (JSON): `/api/metrics`
- Metrics (Prometheus text): `/api/metrics?format=prometheus`
- Dashboard snapshot: `/api/dashboard/ingestion` (queue/job/db/custom gauges)
- Ops ingestion snapshot: `/api/ops/ingestion` (filters, trends, stalled counts; admin-only)

## Metrics/Gauges
- `http_requests_total`, `http_requests_errors`, `http_requests_avg_latency_ms`
- `http_requests_by_route` (per-route count/errors/avg latency)
- DB pool: `totalConnections`, `idleConnections`, `waitingClients` (`/api/metrics`)
- Queue stats: waiting/active/completed/failed/delayed
- Job stats: totals per status (in-memory tracker)

## Logs & Correlation
- `requestId` attached to every request (`x-request-id` header or generated); emitted in logs via async-local context.
- Slow queries (>200ms) logged at warn with duration and row count.

## Alerts (suggested thresholds)
- Readiness fails (HTTP 503) → alert immediately.
- Slow queries: >200ms warn; consider alert if >5% of queries exceed 500ms over 5m.
- Queue: stalled/failed trending upward (`/api/ops/ingestion` failureTrends), or stalled count >0 for 15m.
- HTTP error rate: >2% over 5m; tail latency spikes visible via `http_requests_by_route` avgLatencyMs.

## SLOs (suggested)
- API availability: 99.9% (liveness + readiness).
- API latency: p95 < 500ms for GET routes; p95 < 1s for POST/PUT.
- Ingestion queue: 95% jobs complete < 5m; backlog < 100 jobs.

## Dashboards (minimal)
- Uptime, memory, CPU, DB pool (connections, waiting).
- HTTP requests total/error and avg latency; per-route stats.
- Queue/job stats (waiting/active/failed/completed).
- Failure/processing/completion trends from `/api/ops/ingestion`.
- Stalled processing count (configurable threshold).

## Operational Playbook
- **DB/Redis down**: readiness returns 503; pause traffic until green.
- **Queue backlog**: check `/api/ops/ingestion` trends; scale workers or drain stalled jobs.
- **High error rate**: inspect per-route metrics, correlate requestId in logs; check slow-query warnings.
- **Stalled processing**: use stalled count/trends; consider requeue/reprocess via admin routes.

## Configurable Parameters
- `USE_FILE_PROCESSOR_V2` (ingestion path)
- Rate limits: API/mutations/uploads (code-based)
- CORS origins: `CORS_ORIGIN` (comma-delimited)
- Ops snapshot filters: `limit`, `offset`, `status`, `stalledThresholdMinutes`, `trendHours`, `bypassCache`
