# Backend Improvement Plan

Phased plan with segments for the three focus areas. Status legend: ☐ not started, ⏳ in progress, ✅ done.

## Phase 0 – Baseline & Alignment
- ☐ 0A: Confirm current state and risks (auth coverage, queue health, parser gaps, infra assumptions)
- ☐ 0B: Approvals/rollout strategy (feature flags, rollback plan, comms cadence)

## Phase 1 – Ingestion & Parsing Resilience (Standardization)
- ✅ 1A Foundation & Guardrails
  - Wire feature flag to opt into FileProcessorV2 for non-prod; keep legacy as fallback
  - Add file existence/metadata validation before parse; hard-stop on failed/blocked scans
  - Ensure provenance + error tracking hooks exist for every phase
  - Add smoke harness and fixtures for CSV/transcript/mbox to validate pipeline quickly
  - Validation: feature flag toggles without regression (legacy still works), parsing fails fast on missing files/blocked scans, smoke harness green
- ✅ 1B Standardized Parsing & Mapping
  - Integrate StandardizedCSV/Transcript/Mbox parsers; normalize to canonical vendor/deal/contact payloads
  - Extract vendor matching + deal assembly helpers reused by legacy/v2
  - Implement transactional writes with retry; map parser errors to error_tracking
  - Validation: parser outputs validate without blocking errors; DB writes atomic; retries kick on transient errors; error logs land in tracking table
- ✅ 1C Rollout & Observability
  - Migrate queues/workers to v2 behind flag; dual-run sample jobs and diff outputs
  - Add metrics for parse time, create time, error rate, and stalled jobs; expose progress API
  - Document migration/rollback steps and update ops runbook
  - Validation: queue stats match expectations, dual-run diffs within tolerance, metrics visible, rollback tested

## Phase 2 – Security & Throttling
- ✅ 2A AuthZ Coverage
  - Enforce apiKeyAuth + requireRole across routes; least-privilege defaults (read/write/admin)
  - Add key usage logging + rotation guidance; tighten CORS/env defaults
  - Validation: unauthenticated/insufficient role requests are denied; happy-path keys work; CORS blocks disallowed origins
- ✅ 2B Rate Limits & File Safety
  - Apply apiLimiter/mutationLimiter/uploadLimiter globally with safe skips (health/docs)
  - Harden risky endpoints (reprocess admin-only; merge admin-only)
  - Validation: rate limits trigger after threshold; regression on allowed endpoints passes
- ✅ 2C Verification
  - Negative tests for missing/invalid keys and rate-limit behavior
  - Update security checklist and .env.example
  - Validation: automated tests green; checklist signed off

## Phase 3 – Observability & Operations
- ✅ 3A API/DB Telemetry
  - Request metrics (latency, throughput, error %), slow-query logging, optional tracing
  - Readiness vs. liveness endpoints with DB/Redis checks
  - Validation: metrics endpoint scrapeable; slow-query logs fire under load; readiness fails when DB/Redis down
- ✅ 3B Queue/Worker Visibility
  - Instrument Bull stats (waiting/active/fail, durations), job-level logs with correlation IDs
  - Alerts for stuck/stalled/failure-rate spikes; retries surfacing to notifications
  - Validation: alert thresholds trigger in canary; correlation IDs present in logs; retries visible
- ✅ 3C Runbooks & Dashboards
  - Minimal dashboards for API, DB, queues; ops runbook for common incidents
  - Capture SLOs and alert thresholds
  - Validation: dashboards wired to live data; runbook covers top incident types; SLOs published
