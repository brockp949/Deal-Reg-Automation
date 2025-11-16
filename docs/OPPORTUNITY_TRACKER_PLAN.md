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
- Status: **In-flight** (Phase 3). Phases 1-2 are complete; Phase 3 CLI pipeline operational.
- Latest metrics: see `uploads/opportunities/readiness-metrics.json`, `consolidated-opportunities.json`, and `opportunity-readiness-report.md` (also published under `docs/OPPORTUNITY_READINESS.md`).
- Commands: `npm run source:process` (refresh data + metrics + report), `npm run source:show -- --clusters` (inspect), `npm run source:consolidate` (produce merged view), `npm run source:report` (regenerate/publish report). The GitHub workflow `opportunity-report` runs these on a schedule to keep reports current.
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

## Phase 5 – Quality Assurance & Automation
1. Run the data-quality metrics pipeline on opportunity records to flag missing fields, inconsistent pricing, or stale data; surface remediation recommendations in the tracker.
2. Auto-generate “next steps” from meeting action items and email follow-ups, capturing owners and due dates when available.
3. Add CI coverage (unit + integration tests) spanning connector ingestion through opportunity consolidation to guard against regressions.

## Phase 6 – Reporting & Iteration
1. Produce dashboards/exports showing pipeline status, stages, volumes, and cost upside.
2. Collect stakeholder feedback on tracker accuracy; refine heuristics and detection models accordingly.
3. Plan follow-on work (performance tuning, additional connectors, historical quality trend storage) based on usage patterns and gaps uncovered during rollout.

### CLI Reference
- `npm run source:show -- --filter clearled --clusters` shows stored opportunities (`uploads/opportunities/opportunities.json`) and correlated clusters (`opportunity-clusters.json`). Adjust `--limit` or `--file/--clusters-file` to point at custom locations.
- `npm run source:metrics` builds `readiness-metrics.json`, summarizing total opportunities, per-stage counts, priorities, and cluster coverage for dashboards.
- `npm run source:consolidate` generates `consolidated-opportunities.json`, merging Gmail + Drive fragments into unified records using the latest correlation heuristics.
- `npm run source:report` produces `uploads/opportunities/opportunity-readiness-report.md` and copies it to `docs/OPPORTUNITY_READINESS.md`. A scheduled GitHub Action (`.github/workflows/opportunity-report.yml`) runs `source:process`, `source:consolidate`, and `source:report` daily to keep the published report current.
