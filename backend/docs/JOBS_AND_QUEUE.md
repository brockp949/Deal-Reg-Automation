# Jobs & Queue API

Quick reference for async processing visibility.

## Endpoints
- `GET /api/jobs?active=true|false&limit=20` — lists active or recent jobs (in-memory tracker).
- `GET /api/jobs/stats` — returns job stats, cache stats, and Bull queue stats.
- `GET /api/jobs/:id` — returns job details and Bull queue state; when available, also includes parser metadata.
- `DELETE /api/jobs/:id` — cancels a job (if not already completed/failed).
- `GET /api/jobs?active=true|false&limit=20&offset=0` — lists active or recent jobs; limit (<=100) and offset (<=500) supported for pagination; response includes meta (activeOnly, limit, offset) plus stats.
- `GET /api/ops/ingestion?limit=10&offset=0&status=processing,failed&stalledThresholdMinutes=30&trendHours=48&bypassCache=true` — admin-only snapshot: queue/job stats plus recent files with parser warnings/tags, progress, provenance counts, trends (failed/blocked, completed, processing/queued) over a configurable window (1–168 hours), and stalled processing counts (threshold configurable 1–240 minutes). Response is lightly cached (~30s) per-parameter set; set `bypassCache=true` to skip cache.

## Fields (job detail)
- `job` — in-memory tracker entry with `progress`, `status`, `message`, and `metadata.fileId`.
- `queue` — Bull job state (`state`, `progress`, `result`, `failedReason`, `attemptsMade`).
- Parser context (v2 ingestion):
  - `parserWarnings` — array of warnings captured during standardized parsing.
  - `parserSourceTags` — source tags from parser output metadata (`source:csv`, `source:transcript`, `source:email`, plus format/query/connector tags).
  - `processingStatus` — `source_files.processing_status`.
  - `errorMessage` — `source_files.error_message` (if any).
  - `progress` — mirrors `source_files.metadata.progress` when present.
  - `provenanceCount` — number of `field_provenance` records linked to the source file.

## Notes
- File processing uses a feature-flagged v2 path (`USE_FILE_PROCESSOR_V2`) with provenance and parser logging; jobs and queue stats reflect either path.
- Smoke tests for ingestion v2 can be skipped in DB-less environments by setting `SKIP_DB_TESTS=true`.
