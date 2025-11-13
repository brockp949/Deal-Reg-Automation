Intelligent Automated Deal Registration Email Processing System – Phased Implementation Plan

**Overview**
- Scope: Gmail MBOX exports → automated deal registration records without manual intervention.
- Drivers: Handle 5–7GB MBOX, accuracy via rules + NLP, idempotent registration, observability.
- Metrics: precision/recall by field, auto-registration rate, review-queue size, throughput, error rates.

**Phase 0: Goals, Scope, Metrics**
- Define scope, stakeholders, glossary, and required fields (deal name, vendor, value, dates, contacts, end-customer).
- Set success metrics and confidence thresholds; document constraints and error-handling principles.

**Phase 1: Ingestion & Large File Handling**
- Segment MBOX by size (~500MB) or time window; split on message boundaries and track chunk metadata.
- Stream messages (iterator-based) to avoid loading entire files; add file locks for safe concurrent access.
- Gmail prefilter: read X-Gmail-Labels to prioritize Inbox/Sent/Important and de-emphasize spam/promotions.
- Deliverables: ingest module, chunk index, stream iterator, large-fixture tests.

**Phase 2: Email Parsing & Thread Reconstruction**
- Parse From/To/Cc, Date, Subject, Message-ID, References, In-Reply-To; capture multipart/attachments metadata.
- Prefer plain text; convert HTML to text when needed.
- Group threads by X-GM-THRID when present; else fallback to In-Reply-To/References/subject matching.
- Deliverables: parser module, thread builder, tests for single/branched/missing-header cases.

**Phase 3: Preprocessing & Content Cleaning**
- Multipart selection and decoding (base64/quoted-printable); HTML→text stripping tags/styles/scripts.
- Remove quoted replies and signatures/disclaimers; preserve signature subset separately for enrichment.
- Normalize casing, Unicode/encodings, whitespace; produce clean text for deterministic matching/NLP.
- Deliverables: clean pipeline, configurable cleaners, noisy-email tests.

**Phase 4: High-Speed Triage (Filter Likely Deal Emails)**
- Domain lexicon: known vendor/partner domains matched against sender/recipients.
- Subject/keyword signals: “deal registration”, “opportunity registration”, “RFP”, “RFQ”, “proposal”, vendor program terms.
- Label signals: prioritize Gmail “Sent” and “Important”; produce triage decision + preliminary score.
- Deliverables: triage module, configurable lexicons, perf tests on large corpora.

**Phase 5: Regex Extraction (Structured Low-Hanging Fruit)**
- Financials: currency patterns (e.g., “USD 100K”, “TCV 200,000”).
- Dates: multiple formats and relative expressions (normalized with a date parser).
- Contacts: emails, phone numbers, simple name patterns (body/signature).
- IDs: vendor registration IDs, RFQ/RFP numbers, form IDs (custom patterns).
- Deliverables: extract_regex module, curated patterns, locale-aware date/number handling.

**Phase 6: NLP & Contextual Extraction**
- NER: detect PERSON, ORG, MONEY, DATE, product names; candidate deal/project titles.
- Role inference: assign entities to roles (vendor, end-customer, partner contacts) via context/dependencies.
- Intent filter (optional): distinguish “registering a deal” vs “asking about registration”.
- Confidence scoring: aggregate signal strengths per field and per thread.
- Deliverables: extract_nlp module; baseline spaCy config; labeled sample set and evaluation harness.

**Phase 7: Vendor, Contact, Organization Association**
- Vendor ID: domain match, vendor/product/program lexicon hits, signature cues.
- Contacts: From/To/Cc + body mentions; titles/phones from signature; link to CRM by email/name.
- Organization: detect end-customer org; link or create account record.
- Deliverables: enrich module; CRM adapter(s); vendor lexicon Tier 1–3; contact/org linking logic.

**Phase 8: Validation & Deduplication**
- Required fields check: deal name/description, vendor, value/estimate; use confidence threshold to route.
- Thread-level dedup: one thread → one deal; consolidate updates; ignore exact duplicates via hash.
- Global dedup: check existing deals by composite keys (vendor, customer, name/id, timeframe).
- Deliverables: validate + dedupe modules; idempotency ledger keyed by Message-ID/thread-id.

**Phase 9: Registration & Persistence**
- Data model: deals, contacts, organizations, vendors, thread link, audit log, extraction scores.
- Persistence: relational DB schema, upserts, idempotent writes.
- Integration: pluggable registrars (DB, vendor API); retries/backoff for transient API failures.
- Deliverables: store module; migrations; registrar adapters; transactional audit logging.

**Phase 10: Human Review Workflow (Low-Confidence)**
- Review queue for low-confidence/incomplete records; show thread context + extracted fields.
- Actions: approve/edit/merge/discard; capture feedback for rules/model improvement.
- Deliverables: minimal console or lightweight web UI; RBAC; change history.

**Phase 11: Observability & Ops**
- Structured logs per email/thread: stage outcomes, drop reasons, extraction details.
- Metrics: processed emails, triage pass rate, extraction success, auto-registration rate, errors, latency.
- Tracing: correlation ID per thread; stage timings; alerts and runbooks for failures/backlogs.
- Deliverables: OpenTelemetry logging/metrics; dashboards; on-call runbook.

**Phase 12: Performance & Scaling**
- Parallelize chunk processing with bounded workers; apply backpressure.
- Tune chunk size/time windows; prioritize high-signal chunks (Sent/Important first).
- Optimize IO and memory; batch DB writes; async registrar.
- Deliverables: load test plan; profiling results; tuned defaults for 5–7GB MBOX.

**Phase 13: Security & Compliance**
- Secrets: vault-managed; no secrets in code/logs.
- Data protection: encrypt in transit/at rest; scrub PII from logs; least-privilege access.
- Retention: define periods for MBOX, extracts, and audit records with automation.
- Deliverables: security checklist; DLP/log scrubbing; retention policies.

**Phase 14: Testing Strategy**
- Unit tests: parsers, cleaners, regex, dedupe, scoring.
- Integration: thread reconstruction; end-to-end extraction on synthetic MBOX.
- Golden datasets: curated, redacted real threads with expected outputs.
- Regression: snapshots for key rules/models; CI with coverage gates.
- Deliverables: fixtures, CI config, evaluation metrics (precision/recall by field).

**Phase 15: Deployment Architecture**
- Packaging: containerized workers; config via env/yaml.
- Scheduling: batch (cron/Task Scheduler) or event-driven (queue on MBOX arrival).
- Environments: dev/stage/prod with isolated resources/configs.
- Deliverables: Dockerfile; deploy manifests; environment bootstrap scripts.

**Phase 16: Rollout & Iteration**
- Pilot on historical MBOX; measure metrics; tune thresholds/lexicons.
- Label sample set from pilot for NER fine-tuning.
- Incremental rollout; weekly iteration on errors and low-confidence cases.
- Deliverables: pilot report; improvement backlog; updated models/lexicons.

**Phase 17: Roadmap Enhancements**
- Attachments OCR for PDFs/images (quotes, SOWs) to extract deal info.
- Vendor-specific portal integrations where APIs exist.
- LLM assists for ambiguous threads with guardrails and human-in-the-loop.
- Real-time ingestion via Gmail API watch/labels instead of batch MBOX.
- Admin UI for richer review/analytics; SLA dashboards; Slack/email notifications.

**Recommended Tech**
- Parsing/Cleaning: Python mailbox/email, beautifulsoup4/html2text, regex, dateparser, phonenumbers.
- NLP: spaCy baseline with fine-tuning; optional transformer; rule-based role inference.
- Persistence/Services: Postgres/MySQL; SQLAlchemy/psycopg; FastAPI for review/registrar API.
- Observability: OpenTelemetry logging/metrics; Prometheus/Grafana (or cloud equivalents).
- Packaging/Deploy: Docker; cron/Task Scheduler; optional cloud queue later.

**Milestones & Acceptance**
- M1: Ingest + threading on a 5GB MBOX with <2GB RAM and no crashes.
- M2: Cleaning + triage achieve >90% reduction of non-deal emails on pilot set.
- M3: Regex + NLP extraction with field precision ≥90% and recall ≥75% on labeled set.
- M4: Dedup/idempotent registration; zero duplicate deals across reruns of same MBOX.
- M5: Observability + review queue live; confidence threshold tuned to hit precision target.

**Notes**
- This plan is derived from the system architecture described in the referenced PDF and tailored to large Gmail MBOX processing with rule-based plus NLP extraction, vendor/contact association, and idempotent deal registration.

**Epics & Stories (with Estimates)**
- Epic: Ingestion & Threading (2–3 weeks)
  - Story: Split large MBOX on boundaries with metadata tracking (3–4 days). Acceptance: deterministic splits; rejoin reproduces original.
  - Story: Streaming iterator over chunks (2 days). Acceptance: constant memory profile on 5GB file.
  - Story: Gmail label prefilter (2 days). Acceptance: label-based prioritization unit-tested.
  - Story: Thread reconstruction with X-GM-THRID and fallbacks (4–5 days). Acceptance: >98% correct grouping on test set.
- Epic: Cleaning & Triage (1.5–2 weeks)
  - Story: Multipart handling + HTML→text + decoding (2–3 days). Acceptance: stable outputs across sample formats.
  - Story: Quoted reply and signature removal (3–4 days). Acceptance: removes prior messages, retains latest content; signatures preserved separately.
  - Story: Normalization utilities (1 day). Acceptance: idempotent normalization.
  - Story: High-speed triage with domain/keyword signals (2–3 days). Acceptance: >90% non-deal reduction on pilot.
- Epic: Extraction Engine (Regex + NLP) (2–3 weeks)
  - Story: Financial/date/contact regex with locale support (3–4 days). Acceptance: ≥95% precision on regex fixtures.
  - Story: Vendor/ID pattern library (2 days). Acceptance: detects known vendor IDs and program terms.
  - Story: NER baseline integration (spaCy) (3–4 days). Acceptance: field tagging pipeline runs on threads.
  - Story: Role/intent inference rules (2–3 days). Acceptance: >80% correct role assignment on labeled set.
  - Story: Confidence scoring (1–2 days). Acceptance: stable, monotonic with signal strength.
- Epic: Association, Validation & Dedup (1.5–2 weeks)
  - Story: Vendor association via domain/lexicon/signature (2–3 days). Acceptance: ≥95% precision on vendor mapping.
  - Story: Contact/org linking to CRM (3–4 days). Acceptance: upserts without duplicates.
  - Story: Required fields validation + routing (1–2 days). Acceptance: threshold-controlled auto vs review.
  - Story: Thread/global dedup + idempotency ledger (3 days). Acceptance: zero duplicates across reruns.
- Epic: Registration & Persistence (1.5–2 weeks)
  - Story: Relational schema + migrations (2 days). Acceptance: normalized schema with constraints.
  - Story: Registrar adapters (DB/API) with retry/backoff (3–4 days). Acceptance: resilient writes, audit logs.
  - Story: Transactional audit logging (1 day). Acceptance: end-to-end traceability per thread.
- Epic: Review UI & Observability (1.5–2 weeks)
  - Story: Minimal review UI (approve/edit/merge/discard) (4–5 days). Acceptance: RBAC, change history.
  - Story: Structured logging/metrics/tracing (2–3 days). Acceptance: dashboards with SLOs.
  - Story: Alerts/runbooks (1 day). Acceptance: documented playbooks and alert thresholds.
- Epic: Security & Compliance (1 week, parallelizable)
  - Story: Secrets management & config hardening (2 days). Acceptance: no plaintext secrets, least-privilege.
  - Story: PII scrubbing & retention policy (2 days). Acceptance: logs scrubbed, auto-retention tasks.
- Epic: Testing & Release (ongoing)
  - Story: Golden datasets + evaluation harness (3 days). Acceptance: report precision/recall by field.
  - Story: CI setup with coverage gates (1 day). Acceptance: green builds required for merge.

**Week-by-Week Rollout (Indicative 8–10 Weeks)**
- Week 1: Phase 0 finalize; implement MBOX splitter, streaming iterator; basic label prefilter.
- Week 2: Parser + thread reconstruction; chunk metadata; large-fixture tests. Milestone: M1.
- Week 3: Cleaning pipeline (HTML→text, decode, quoted/signature removal); normalization. Triage signals v1.
- Week 4: Regex extraction (financial/date/contact/IDs); vendor lexicon Tier 1–2; evaluation fixtures. Milestone: M2.
- Week 5: NER baseline + role/intent inference; confidence scoring; labeled set creation and first eval.
- Week 6: Vendor/contact/org association; validation rules; thread/global dedup; idempotency ledger. Milestone: M3 (field metrics).
- Week 7: Schema + migrations; registrar adapters (DB/API); transactional audit logging; end-to-end write path. Milestone: M4.
- Week 8: Review UI; observability (logs/metrics/tracing); alerts/runbooks; perf tuning and parallelization. Milestone: M5.
- Weeks 9–10 (pilot/rollout): Run on historical MBOX, tune thresholds/lexicons, security hardening, and incremental production rollout.

**Risks & Mitigations**
- Risk: Over-aggressive triage drops true positives. Mitigation: conservative thresholds + weekly review of drops.
- Risk: NLP generalization gaps. Mitigation: labeled dataset expansion and periodic fine-tuning.
- Risk: Vendor lexicon drift. Mitigation: editable lexicon with change audit and monitoring.
- Risk: Duplicate registrations via external APIs. Mitigation: composite keys + idempotency keys and API-side checks.
