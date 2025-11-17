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
- Status: **Phase 5 in progress**. Milestone 5.1 (quality scoring) is live; Milestone 5.2 (action automation) now adds structured owners/dates to next steps.
- Latest metrics: see `uploads/opportunities/readiness-metrics.json`, `consolidated-opportunities.json`, `composite-opportunities.{json,csv}`, and `opportunity-readiness-report.md` (also published under `docs/OPPORTUNITY_READINESS.md`).
- Commands: `npm run source:process` (refresh data + metrics + report), `npm run source:show -- --clusters` (inspect), `npm run source:consolidate` (produce merged view), `npm run source:export` (composite exports), `npm run source:report` (regenerate/publish report). The GitHub workflow `opportunity-report` runs these nightly to keep docs current.
- Phase 4 complete: consolidated composites, conflict detection, and automated reporting are live (see Phase 4 summary).
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

## Phase 6 – Reporting & Iteration
1. Produce dashboards/exports showing pipeline status, stages, volumes, and cost upside.
2. Collect stakeholder feedback on tracker accuracy; refine heuristics and detection models accordingly.
3. Plan follow-on work (performance tuning, additional connectors, historical quality trend storage) based on usage patterns and gaps uncovered during rollout.

### CLI Reference
- `npm run source:show -- --filter clearled --clusters` shows stored opportunities (`uploads/opportunities/opportunities.json`) and correlated clusters (`opportunity-clusters.json`). Adjust `--limit` or `--file/--clusters-file` to point at custom locations.
- `npm run source:metrics` builds `readiness-metrics.json`, summarizing total opportunities, per-stage counts, priorities, and cluster coverage for dashboards.
- `npm run source:consolidate` generates `consolidated-opportunities.json`, merging Gmail + Drive fragments into unified records using the latest correlation heuristics.
- `npm run source:quality` evaluates composites for completeness/conflicts/staleness and writes `quality-findings.json` for the readiness dashboard + report.
- `npm run source:ci` runs process → export → quality → report sequentially; ideal for CI or scheduled automation after `source:sync`.
- `npm run source:report` produces `uploads/opportunities/opportunity-readiness-report.md` and copies it to `docs/OPPORTUNITY_READINESS.md`. A scheduled GitHub Action (`.github/workflows/opportunity-report.yml`) runs `source:sync` plus `source:ci` daily to keep the published report current.

See `docs/PHASE_3_SUMMARY.md` for detailed milestone results.
