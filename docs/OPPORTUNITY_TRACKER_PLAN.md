# Opportunity Tracker Enhancement Plan

## Phase 1-2 Progress Snapshot (Nov 14, 2025)
- **Phase 1 – Connector-Aligned Ingestion**: ✅ Gmail/Drive connectors stabilized with service-account auth + per-file metadata manifests (sourceSync CLI + tests). Messages now ship .json sidecars carrying thread IDs, history IDs, labels, Drive owners, and timestamps for downstream traceability.
- **Phase 2 – Source-Aware Parsing**: ✅ Standardized MBOX parser injects Gmail metadata, RFQ signal extraction (quantities/pricing/timelines/margins), and source_tags/stage hints for every deal. Transcript parser consumes Drive metadata, emits semantic sections (attendees, pricing, margins, action items), RFQ signals, and tags.
- **Stress Testing**: `npm test -- --runInBand` now covers Phase 1 ingestion (`SourceSyncService.test.ts`), the new opportunity-signal utilities, and Phase 2 transcript parsing to guard regressions while we move into Phase 3.

## Phase 3 Kickoff (Nov 14, 2025)
- Introduced a dedicated `OpportunityRecord` schema plus `OpportunityMapper` to convert parser outputs into tracker-ready records (Stage, priority, unit range, price band, cost upside, actors, next steps, backlinks). Implementation lives in `backend/src/opportunities/*`.
- RFQ signals + transcript semantic sections automatically populate the stage heuristics, unit/price summaries, and action items; metadata sidecars now furnish backlink context (`sourceSummary`) per opportunity.
- Added Jest coverage (`backend/src/__tests__/opportunities/OpportunityMapper.test.ts`) to exercise the new mapper (Gmail + Drive cases), ensuring Phase 3 logic can evolve safely as we layer in correlation + storage next.
- Source sync CLI now emits `source-sync-manifest.json`, listing each Gmail/Drive spool file with its intended parser and metadata; run `npm run source:process -- --manifest <path>` to parse entries and emit aggregated opportunity records automatically.
- Running `npm run source:process` also upserts results into `uploads/opportunities/opportunities.json` via the new OpportunityStore so Phase 3 output is queryable without rerunning parsers.
- The same command now emits `opportunity-clusters.json` using `OpportunityCorrelator`, summarizing merged Gmail/Drive evidence to prep Phase 4 consolidation reviews.
- Introduced `OpportunityCorrelator` to group Gmail/Drive opportunities that share opportunity tags or vendor/customer fingerprints, laying the groundwork for Phase 4 consolidation (tests in `backend/src/__tests__/opportunities/OpportunityCorrelator.test.ts`).

### Readiness Summary
- Status: **Phase 7 complete**. Multi-connector ingestion (Gmail/Drive + CRM CSV + Teams/Zoom), dashboards, feedback loops, and deployment automation are in production.
- Latest metrics/artifacts: `uploads/opportunities/readiness-metrics.json`, `consolidated-opportunities.json`, `composite-opportunities.{json,csv}`, `dashboard.json`, `pipeline-metrics.json`, `quality-findings.json`, `feedback-summary.json`, plus published docs (`docs/OPPORTUNITY_READINESS.md`, `docs/DASHBOARD.md`, `docs/FEEDBACK_SUMMARY.md`).
- Key commands: `npm run source:process`, `source:export`, `source:quality`, `source:publish`, `source:feedback`, `source:history`, `source:report`, `source:sync:<connector>`, `smoke:<connector>`, `load:test`. GitHub Action `opportunity-report` runs sync → CI → publish nightly.
- Phase 4–7 complete; Phase 8 planning outlined below.
## Phase 1 – Connector-Aligned Ingestion
1. Wrap Gmail search/read endpoints with predefined queries (keywords, participants, date ranges) that emit normalized thread objects with metadata (threadId, snippet, labels, timestamps).
2. Build a Drive search/fetch workflow that tags documents/transcripts by meeting name, participants, and date; produce a manifest used by the transcript parser.
3. Integrate these connectors into the ingestion scheduler and persist the raw artifacts plus metadata so downstream stages can reference original sources.

## Phase 2 – Source-Aware Parsing Enhancements
1. Extend `StandardizedMboxParser` to capture Gmail metadata (threadId, historyId, labels) and emit structured RFQ cues (quantities, pricing, requested timelines).
2. Enhance `StandardizedTranscriptParser` to include Drive metadata (docId, meeting timestamp, owner) and semantic sections (attendees, pricing/margins, action items).
3. Add vocabulary-specific detectors for 4IEC opportunities (RFQ phrases, margin/volume statements) across both parsers.

## Phase 3 – Opportunity Entity Construction
1. Define an Opportunity schema (ID, stage, unit ranges, price bands, cost upside, actors, next steps, backlinks).
2. Map parser outputs into the schema using heuristics to derive stages (RFQ, quoting, PO in progress, research concept) based on textual cues and timestamps.
3. Store references to original emails/docs for traceability within the opportunity record.

## Phase 4 – Cross-Source Correlation & Consolidation
1. Use correlation logic to merge Gmail-derived and Drive-derived fragments via shared keywords, participants, or inferred opportunity IDs.
2. Resolve conflicting metrics (e.g., multiple unit counts) using weighting rules (recency, authoritative source type).
3. Populate the consolidated tracker (quantities, pricing, margins, stage, next steps, cost upside) with backlinks to each contributing source.

## Phase 5 - Quality Assurance & Automation (Planned)

### Milestone 5.1 - Data-Quality Metrics & Remediation Signals
- Extend the metrics pipeline with completeness, consistency, and staleness scoring for each consolidated/composite opportunity.
- Emit `quality-findings.json` plus embed remediation summaries into `readiness-metrics.json`/readiness reports, highlighting blockers (missing stage, conflicting pricing, last-touch > SLA).
- CLI: `npm run source:quality` orchestrates recalculation (reads composites, writes findings, optionally patches readiness report).
- Tests: unit tests for scoring helpers + integration coverage for manifest -> quality output.

### Milestone 5.2 - Action Extraction & Owner Automation
- Promote transcript/email action items into structured `next_steps` entries with inferred owners/due dates, filling tracker gaps automatically.
- Backfill opportunities missing owner/due date by mining semantic sections + metadata.
- Surface resulting tasks in readiness report and optional Slack/notification hooks.
- Tests: parser fixtures verifying extraction plus mapper tests ensuring deduplication and owner inference.
- **Status**: Structured next steps now populate `opportunities.json` (`structuredNextSteps`) with owner/due-date inference, and readiness metrics/report show aggregate action counts.

### Milestone 5.3 - QA Automation & Regression Guardrails
- Wire the full ingestion -> consolidation -> quality pipeline into CI so regressions fail fast (`npm run source:sync -- --dry-run`, `source:process`, `source:quality`).
- Add scenario-based integration tests (Gmail-only, Drive-only, mixed) plus lint/type gates for the new automation scripts.
- Produce Phase 5 documentation (summary + operations runbook) and update GitHub workflow to publish quality findings.
- Tests: CI workflow validation + Jest suites covering automation surfaces.
- **Status**: ✅ Added `npm run source:ci` for the full pipeline, wired into the GitHub workflow, and created integration scenarios covering Gmail-only, Drive-only, and mixed composites to guard regressions.

Each milestone bakes in validation: local `npm test -- --runInBand`, targeted script smoke tests, and documentation updates tracking readiness.

## Phase 6 - Reporting & Iteration (Planned)

### Milestone 6.1 - Live Dashboards & Distribution
**Objectives**
- Convert existing artifacts (`readiness-metrics.json`, `quality-findings.json`, `composite-opportunities.{json,csv}`) into dashboard-friendly bundles (web module + export pack).
- Capture trend data by snapshotting each pipeline run into `uploads/opportunities/history/<YYYY-MM-DD>/metrics.json` + `quality.json`.
- Provide governed distribution: publish dashboards to `docs/DASHBOARD.md`, sync CSV/JSON to BI destinations (Sheets/S3) on every run.

**Deliverables**
1. `source:publish` CLI: orchestrates snapshot creation, dashboard serialization, and publishing (docs + remote storage).
2. Dashboard serializer module producing:
   - stage/priority charts (JSON schema for Charts.js/Superset)
   - quality trend line
   - top-conflict tables (opportunities requiring attention)
3. History retention policy (e.g., keep last 90 snapshots) with cleanup logic.
4. Documentation (`docs/PHASE_6_SUMMARY.md`) describing dashboard operation and automation schedule.

**Validation**
- Unit tests for snapshot writer (ensures deterministic file names, retention).
- Serializer tests verifying data bucketization.
- CLI smoke test (`npm run source:publish -- --dry-run`) that asserts artifact paths and GitHub Action integration (extend `.github/workflows/opportunity-report.yml`).
- Manual QA: open dashboard markdown, confirm chart data matches latest run.
- **Status**: ✅ `source:publish` CLI, snapshot history, dashboard JSON, and `docs/DASHBOARD.md` publishing are live with retention + tests.

### Milestone 6.2 - Feedback Loop & Heuristic Refinement
**Objectives**
- Capture user annotations on opportunities (correct stage, missing fields, false conflicts) and feed them back into heuristics.
- Track accuracy metrics (precision/recall per stage, priority, conflict detection) and surface them in dashboards.
- Provide a tight iteration loop to update mapping/correlation logic based on real-world validation.

**Deliverables**
1. Annotation schema + storage (`feedback/annotations.json`, optionally a SQLite table).
2. `source:feedback` CLI with subcommands:
   - `--import <file>`: ingest feedback CSV/JSON.
   - `--apply`: recompute opportunities with overrides (e.g., set stage to `po_in_progress`, mark conflict resolved).
   - `--metrics`: output accuracy stats (per-signal precision/recall, count of addressed issues).
3. Mapper/consolidator updates honoring annotation overrides (with provenance logging).
4. Reports: `feedback-summary.md` appended to readiness report (counts of outstanding vs resolved issues).

**Validation**
- Unit tests for annotation parsing/merging.
- Integration tests verifying `source:feedback` modifies composites + metrics and accuracy counters change accordingly.
- Regression tests ensuring overrides persist across reruns (store applied annotations in metadata).
- Manual sign-off: run CLI with sample feedback, ensure readiness report reflects adjustments.
- **Status**: ✅ Annotation service + `source:feedback` CLI live; overrides update opportunities/metrics and publish `feedback-summary.json` / `docs/FEEDBACK_SUMMARY.md`.

### Milestone 6.3 - Continuous Improvement & Performance
**Objectives**
- Make the pipeline observable (timing, throughput, error rates) and scalable for larger data sets + new connectors.
- Preserve historical quality/action metrics in an analytics-friendly store (SQLite/Parquet/BigQuery) for long-term insights.
- Lay groundwork for Phase 7 connectors by defining onboarding requirements and verifying pipeline extensibility.

**Deliverables**
1. Instrumentation layer capturing:
   - Source sync durations, API quota usage.
   - Processing/consolidation timing + memory footprint.
   - Error rate + retry metrics.
   Output to `uploads/opportunities/pipeline-metrics.json` and optionally push to monitoring (CloudWatch, Datadog).
2. Historical warehouse:
   - `history/quality.parquet` or SQLite DB storing per-run metrics, quality scores, action-item stats.
   - Query script (`npm run source:history -- --query <...>`) to extract trends for data science.
3. Connector readiness checklist + stubs:
   - Config schema for new connectors (CRM CSV, Teams transcripts).
   - Sample ingestion job ensuring connectors can be toggled via config.
4. Documentation on scaling (batch sizes, concurrency) + alerting thresholds.

**Validation**
- Unit tests for instrumentation helpers (ensuring timings recorded even on failure).
- Smoke test verifying history writer appends records and enforces retention.
- Connector stub tests ensuring toggling flags registers manifest entries without impacting current workflow.
- Performance regression test (mock large manifest) to ensure instrumentation overhead is minimal.
- **Status**: ✅ Pipeline metrics recorder, history JSONL, connector registry/stubs, and `source:history` CLI are in place with docs + tests.

### Deployment Rollout Tasks (Phase 7 Ops)
- Execute blue/green deployment per `DEPLOYMENT_CHECKLIST.md` (Sections "Blue/Green Deployment Strategy" / "Canary Deployment Option"), including health checks before traffic switch.
- Configure alerting (`ALERTS_ENABLED`, `SLACK_WEBHOOK_URL`, `DATADOG_API_KEY`) and verify `npm run smoke:<connector>` for Gmail, Drive, CRM CSV, Teams, and Zoom before/after deployment.
- Schedule `npm run load:test` runs (default 1000 sources) to confirm throughput stays near the documented benchmark (~16 sources/sec) and record stats via `pipeline-metrics.json`.
- Keep `docs/CONNECTOR_READINESS.md` updated with connector-specific runbooks, issues, and remediation steps discovered during production rollout.

## Phase 7 - Connector Expansion & Deployment Hardening (Complete)

### Milestone 7.1 - CRM CSV Connector & Parsing
- Objectives: land the first non-Google connector (CRM CSV) end-to-end: ingestion, parsing, validation, and mapping into OpportunityRecords.
- Deliverables: CRM CSV ingestion job (SourceSync extension), StandardizedCSVParser updates, integration tests/fixtures, connector runbook (`docs/CONNECTOR_READINESS.md`).
- Status: ✅ Live (CRM CSV sync + parser + mapper + tests merged on main).

### Milestone 7.2 - Teams/Zoom Transcript Connector & NLP Enhancements
- Objectives: add real-time meeting transcript ingestion from Teams/Zoom; enhance speaker/timestamp/action extraction.
- Deliverables: Teams/Zoom connectors with token management + rate limiting, transcript normalizer, NLP improvements, fixtures, documentation.
- Status: ✅ Live (connectors, fixtures, parser updates merged).

### Milestone 7.3 - Deployment Hardening & Observability
- Objectives: productionize multi-connector pipeline with smoke/load tests, blue/green deployment tooling, and alerting.
- Deliverables: per-connector sync/smoke scripts, load test harness, pipeline metrics DB + alerting, blue/green/canary runbooks in `DEPLOYMENT_CHECKLIST.md`.
- Status: ✅ Live (scripts + docs merged; ops tasks tracked above).

## Phase 8 - Intelligent Insights & Automation (Planned)

### Milestone 8.1 - Opportunity Insights & Scoring
- Objectives: introduce AI-driven scoring (win probability, momentum, churn risk) using historical CRM + transcript signals.
- Deliverables: feature store, scoring job (`npm run insights:score`), metrics/report updates showing insight badges, documentation of algorithm/thresholds.
- Validation: backtests vs. closed deals, accuracy dashboards, unit tests for scoring helpers.
- Status: 🔄 In progress — baseline heuristic scoring service + CLI emitting `uploads/opportunities/insights.json` is live.

### Milestone 8.2 - Workflow Automations & Notifications
- Objectives: convert `structuredNextSteps` into automated tasks/alerts (Slack/Teams) and escalate high-risk conflicts automatically.
- Deliverables: automation service listening to latest composites, Slack/Teams notification hooks, CLI `npm run insights:notify`, task export (CSV/API).
- Validation: integration tests for notification delivery, throttling tests, manual QA of message formatting.
- Status: 🔄 In progress — notification service produces Slack-style payloads + CLI logs delivery-ready messages.

### Milestone 8.3 - Self-Service Analytics & API
- Objectives: expose a secure API + BI schema so GTM teams can query opportunities directly.
- Deliverables: `/api/opportunities` endpoints with filtering, API keys/roles, warehouse/dbt models, `docs/PHASE_8_SUMMARY.md`.
- Validation: API contract tests, load tests (≥10 qps sustained), BI workbook smoke tests, security review sign-off.
- Status: 🔄 In progress — baseline `/api/opportunities` route with stage/priority filters + tests landed.

### CLI Reference
- `npm run source:show -- --filter clearled --clusters` shows stored opportunities (`uploads/opportunities/opportunities.json`) and correlated clusters (`opportunity-clusters.json`). Adjust `--limit` or `--file/--clusters-file` to point at custom locations.
- `npm run source:metrics` builds `readiness-metrics.json`, summarizing total opportunities, per-stage counts, priorities, and cluster coverage for dashboards.
- `npm run source:consolidate` generates `consolidated-opportunities.json`, merging Gmail + Drive fragments into unified records using the latest correlation heuristics.
- `npm run source:quality` evaluates composites for completeness/conflicts/staleness and writes `quality-findings.json` for the readiness dashboard + report.
- `npm run source:ci` runs process → export → quality → report → publish sequentially; ideal for CI or scheduled automation after `source:sync`.
- `npm run source:publish` snapshots metrics/quality history, generates `dashboard.json`, and publishes `docs/DASHBOARD.md` for stakeholders.
- `npm run source:feedback` imports reviewer annotations (`uploads/opportunities/feedback/annotations.json`) and prints summaries so overrides feed the next pipeline run.
- `npm run source:history` queries `uploads/opportunities/history/metrics-history.jsonl` for trend snapshots (pass `--limit` / `--json`).
- `npm run source:report` produces `uploads/opportunities/opportunity-readiness-report.md` and copies it to `docs/OPPORTUNITY_READINESS.md`. A scheduled GitHub Action (`.github/workflows/opportunity-report.yml`) runs `source:sync` plus `source:ci` daily to keep the published report current.
- `npm run insights:score` generates opportunity insights (win probability/momentum) into `uploads/opportunities/insights.json`.
- `npm run insights:notify` converts insights into `notifications.json` payloads for Slack/task automation.

See `docs/PHASE_3_SUMMARY.md` for detailed milestone results.
