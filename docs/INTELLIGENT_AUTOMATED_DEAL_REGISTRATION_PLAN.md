Intelligent Automated Deal Registration Email Processing System – Phased Implementation Plan

**Overview**
- Scope: Gmail MBOX exports → automated deal registration records without manual intervention.
- Drivers: Handle 5–7GB MBOX, accuracy via rules + NLP, idempotent registration, observability.
- Metrics: precision/recall by field, auto-registration rate, review-queue size, throughput, error rates.

**Phase 0: Goals, Scope, Metrics**
- Define scope, stakeholders, glossary, and required fields (deal name, vendor, value, dates, contacts, end-customer).
- Set success metrics and confidence thresholds; document constraints and error-handling principles.

**Phase 1: Ingestion & Large File Handling**

*Objective:* Handle 5–7GB MBOX files with constant memory usage, enable resumable processing, and prioritize high-value emails.

*Implementation Details:*

1. **MBOX Splitter (`mbox_splitter.py`)**
   - Class: `MBOXSplitter`
   - Methods:
     - `split_mbox(file_path, chunk_size_mb=500, output_dir=None)` → returns chunk metadata
     - `validate_split(original_path, chunk_paths)` → ensures byte-perfect reconstruction
   - Algorithm:
     - Read file in streaming mode using `mailbox.mbox()` with lazy loading
     - Track message boundaries via `From ` separator detection
     - Write chunks maintaining message atomicity (never split mid-message)
     - Generate SHA256 hash per chunk for integrity
   - Metadata Schema:
     ```json
     {
       "original_file": "inbox.mbox",
       "original_size_bytes": 7340032000,
       "original_hash": "abc123...",
       "chunks": [
         {
           "chunk_id": "inbox_chunk_001",
           "path": "chunks/inbox_chunk_001.mbox",
           "size_bytes": 524288000,
           "message_count": 5432,
           "date_range": {"start": "2023-01-01T00:00:00Z", "end": "2023-03-15T23:59:59Z"},
           "hash": "def456...",
           "labels": ["INBOX", "SENT", "IMPORTANT"]
         }
       ],
       "split_timestamp": "2025-01-15T10:30:00Z"
     }
     ```
   - Acceptance Criteria:
     - ✓ Splits 7GB MBOX in <10 minutes
     - ✓ Memory usage stays <500MB during split
     - ✓ Concatenating chunks reproduces original file (validated by hash)
     - ✓ No messages truncated or lost (message count verification)

2. **Streaming Message Iterator (`message_iterator.py`)**
   - Class: `MessageStreamIterator`
   - Methods:
     - `__init__(chunk_path, resume_position=0)`
     - `__iter__()` and `__next__()` for iteration
     - `get_position()` → returns current byte offset for resumability
     - `skip_to_position(byte_offset)` → enables resume
   - Features:
     - Yields parsed `email.message.Message` objects one at a time
     - Maintains file pointer position for crash recovery
     - Uses buffer (4KB) for efficient I/O
     - Handles malformed messages gracefully (log and skip)
   - Memory Profile:
     - Maximum memory per iterator: <50MB (buffered I/O + single message)
     - Supports parallel processing via multiple iterator instances
   - Acceptance Criteria:
     - ✓ Processes 500MB chunk with <50MB RAM
     - ✓ Resume from byte offset works across process restarts
     - ✓ Handles corrupted messages without crashing

3. **Gmail Label Prefilter (`label_filter.py`)**
   - Class: `GmailLabelFilter`
   - Methods:
     - `extract_labels(message)` → parses X-Gmail-Labels header
     - `calculate_priority(labels)` → returns priority score (0-100)
     - `should_process(message, min_priority=30)` → boolean decision
   - Priority Scoring:
     ```python
     HIGH_VALUE_LABELS = {
         "SENT": 50,
         "IMPORTANT": 40,
         "INBOX": 30,
         "STARRED": 25
     }
     LOW_VALUE_LABELS = {
         "SPAM": -100,
         "TRASH": -100,
         "PROMOTIONS": -30,
         "FORUMS": -20,
         "SOCIAL": -15
     }
     ```
   - Label Normalization: uppercase, strip spaces, handle multi-labels
   - Acceptance Criteria:
     - ✓ Correctly parses X-Gmail-Labels in 100% of test cases
     - ✓ Filters out >80% of spam/promotional emails
     - ✓ Retains 100% of SENT and IMPORTANT messages

4. **Chunk Index & Metadata Tracker (`chunk_index.py`)**
   - Class: `ChunkIndex`
   - Storage: SQLite database (`chunk_index.db`)
   - Schema:
     ```sql
     CREATE TABLE chunks (
       chunk_id TEXT PRIMARY KEY,
       original_file TEXT NOT NULL,
       path TEXT NOT NULL,
       size_bytes INTEGER,
       message_count INTEGER,
       date_start TEXT,
       date_end TEXT,
       hash TEXT,
       status TEXT DEFAULT 'pending', -- pending|processing|completed|failed
       created_at TEXT,
       processed_at TEXT
     );
     CREATE TABLE processing_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       chunk_id TEXT,
       message_offset INTEGER,
       status TEXT,
       error TEXT,
       timestamp TEXT,
       FOREIGN KEY (chunk_id) REFERENCES chunks(chunk_id)
     );
     ```
   - Methods:
     - `register_chunk(chunk_metadata)` → adds chunk to index
     - `mark_processing(chunk_id, offset)` → updates status
     - `mark_completed(chunk_id)` → finalizes chunk
     - `get_next_chunk(priority='label_score')` → returns next chunk to process
     - `get_resume_point(chunk_id)` → returns last processed offset
   - Acceptance Criteria:
     - ✓ Idempotent chunk registration
     - ✓ Concurrent access safe (file locking)
     - ✓ Resume processing from crash works 100%

5. **File Locking & Concurrency (`file_locks.py`)**
   - Use `fcntl.flock()` (Unix) or `msvcrt.locking()` (Windows)
   - Lock files during read/write to prevent race conditions
   - Timeout mechanism for stale locks (5 minutes)
   - Acceptance Criteria:
     - ✓ Multiple workers can't process same chunk simultaneously
     - ✓ Stale locks auto-released after timeout

*Configuration Example (`config/ingestion.yaml`):*
```yaml
ingestion:
  chunk_size_mb: 500
  chunk_output_dir: "./data/chunks"
  max_parallel_workers: 4
  resume_on_failure: true

gmail_filter:
  min_priority_score: 30
  high_value_labels: ["SENT", "IMPORTANT", "INBOX", "STARRED"]
  low_value_labels: ["SPAM", "TRASH", "PROMOTIONS"]

performance:
  buffer_size_kb: 4
  max_memory_mb: 500
  io_timeout_seconds: 30
```

*Testing Strategy:*
- **Unit Tests:**
  - Test MBOX splitting with 100KB, 10MB, 1GB fixtures
  - Test iterator with various encodings (UTF-8, Latin-1, corrupted)
  - Test label parsing with edge cases (missing headers, malformed labels)
- **Integration Tests:**
  - Split 5GB real MBOX and verify integrity
  - Process chunk in parallel with 4 workers
  - Simulate crash mid-processing and verify resume
- **Performance Tests:**
  - Benchmark split speed (target: >10MB/s)
  - Memory profiling with valgrind/memory_profiler
  - Concurrent access stress test (10 workers)

*File Structure:*
```
src/
  ingestion/
    __init__.py
    mbox_splitter.py
    message_iterator.py
    label_filter.py
    chunk_index.py
    file_locks.py
tests/
  ingestion/
    test_splitter.py
    test_iterator.py
    test_label_filter.py
    fixtures/
      sample_100kb.mbox
      sample_10mb.mbox
      corrupted.mbox
config/
  ingestion.yaml
data/
  chunks/        # Generated chunks
  chunk_index.db # SQLite index
```

- Deliverables: ingest module, chunk index, stream iterator, large-fixture tests.

**Phase 2: Email Parsing & Thread Reconstruction**

*Objective:* Extract structured metadata from emails, handle multipart content, and reconstruct conversation threads for context-aware processing.

*Implementation Details:*

1. **Email Parser (`EmailParser.ts`)**
   - Class: `EmailParser`
   - Methods:
     - `parse(message: ParsedMail)` → returns `ParsedEmailMetadata`
     - `extractHeaders(message: ParsedMail)` → returns header object
     - `extractAddresses(addressObj: AddressObject)` → returns normalized addresses
     - `extractAttachmentMetadata(message: ParsedMail)` → returns attachment info
   - Header Extraction:
     - From, To, Cc, Bcc (normalized email addresses with names)
     - Date (parsed to ISO8601)
     - Subject (decoded, normalized)
     - Message-ID (unique identifier)
     - References (array of parent message IDs)
     - In-Reply-To (immediate parent message ID)
     - X-GM-THRID (Gmail thread ID when available)
   - Metadata Schema:
     ```typescript
     interface ParsedEmailMetadata {
       message_id: string;
       from: EmailAddress;
       to: EmailAddress[];
       cc: EmailAddress[];
       bcc: EmailAddress[];
       subject: string;
       date: Date;
       references: string[];
       in_reply_to: string | null;
       gmail_thread_id: string | null;
       body_text: string | null;
       body_html: string | null;
       attachments: AttachmentMetadata[];
       headers: Record<string, string | string[]>;
     }

     interface EmailAddress {
       email: string;
       name?: string;
     }

     interface AttachmentMetadata {
       filename: string;
       content_type: string;
       size_bytes: number;
       content_id?: string;
       is_inline: boolean;
     }
     ```
   - Acceptance Criteria:
     - ✓ Parses all standard RFC 5322 headers
     - ✓ Handles missing/malformed headers gracefully
     - ✓ Extracts attachments metadata without loading content
     - ✓ Normalizes addresses (lowercase email, preserve name)
     - ✓ Handles encoded subjects (UTF-8, ISO-8859-1, etc.)

2. **Thread Builder (`ThreadBuilder.ts`)**
   - Class: `ThreadBuilder`
   - Methods:
     - `addMessage(metadata: ParsedEmailMetadata)` → void
     - `buildThreads()` → returns `EmailThread[]`
     - `findThreadForMessage(metadata: ParsedEmailMetadata)` → returns thread ID
   - Threading Algorithm:
     ```
     1. Primary: Use X-GM-THRID if present (Gmail native threading)
     2. Fallback: Use In-Reply-To/References (RFC 5256 standard)
     3. Last resort: Subject normalization + date proximity
        - Normalize: remove Re:/Fwd:/etc, trim whitespace
        - Group messages with same normalized subject within 7 days
     ```
   - Thread Schema:
     ```typescript
     interface EmailThread {
       thread_id: string; // Gmail thread ID or generated UUID
       messages: ParsedEmailMetadata[];
       root_message: ParsedEmailMetadata; // First message in thread
       participants: EmailAddress[]; // Unique participants
       subject: string; // Thread subject (from root)
       date_start: Date;
       date_end: Date;
       message_count: number;
     }
     ```
   - Edge Cases:
     - Missing References header → use In-Reply-To only
     - Missing both → subject matching with date proximity
     - Branched threads → follow In-Reply-To chain
     - Out-of-order messages → sort by date after grouping
   - Acceptance Criteria:
     - ✓ >98% correct threading on test set (using Gmail thread IDs as ground truth)
     - ✓ Handles missing headers (degrades to subject matching)
     - ✓ Resolves branched threads (multiple replies to same message)
     - ✓ Performance: O(n log n) for n messages

3. **Multipart Handler (`MultipartHandler.ts`)**
   - Class: `MultipartHandler`
   - Methods:
     - `extractBestTextContent(message: ParsedMail)` → returns `{ text: string, source: 'plain' | 'html' }`
     - `decodeContent(content: string, encoding: string)` → returns decoded string
     - `extractAllTextParts(message: ParsedMail)` → returns text parts array
   - Content Preference Order:
     1. text/plain (preferred)
     2. text/html → convert to plain text
     3. multipart/alternative → prefer text/plain over text/html
     4. multipart/mixed → extract all text parts
   - Encoding Support:
     - base64, quoted-printable, 7bit, 8bit, binary
     - Character sets: UTF-8, ISO-8859-1, Windows-1252, etc.
   - Acceptance Criteria:
     - ✓ Correctly selects text/plain when available
     - ✓ Falls back to HTML→text conversion
     - ✓ Handles nested multipart structures
     - ✓ Decodes all common encodings

4. **HTML to Text Converter (`HtmlToTextConverter.ts`)**
   - Class: `HtmlToTextConverter`
   - Methods:
     - `convert(html: string)` → returns plain text
     - `stripHtmlTags(html: string)` → returns text without tags
     - `preserveLinks(html: string)` → extracts links inline
   - Conversion Strategy:
     - Remove `<script>`, `<style>`, `<head>` entirely
     - Convert `<br>`, `<p>`, `<div>` to newlines
     - Convert `<a>` to text with URL: `[text](url)`
     - Convert `<ul>/<ol>/<li>` to bullet points
     - Strip all other HTML tags
     - Decode HTML entities (&nbsp;, &amp;, etc.)
     - Normalize whitespace (multiple spaces → single space)
   - Libraries: Use `html2text` or `node-html-to-text`
   - Acceptance Criteria:
     - ✓ Preserves paragraph structure
     - ✓ Converts links to readable format
     - ✓ Removes all script/style content
     - ✓ Handles malformed HTML gracefully

5. **Integration Module (`index.ts`)**
   - Combines all Phase 2 components
   - Exports:
     ```typescript
     export { EmailParser, ParsedEmailMetadata, EmailAddress }
     export { ThreadBuilder, EmailThread }
     export { MultipartHandler }
     export { HtmlToTextConverter }
     ```

*Configuration Example:*
```typescript
// config/parsing.ts
export interface ParsingConfig {
  parsing: {
    prefer_plain_text: boolean;
    preserve_html: boolean;
    max_attachment_size_mb: number;
  };
  threading: {
    use_gmail_thread_id: boolean;
    subject_match_window_days: number;
    normalize_subject: boolean;
  };
  html_conversion: {
    preserve_links: boolean;
    convert_lists: boolean;
    max_line_length: number;
  };
}
```

*Testing Strategy:*
- **Unit Tests:**
  - EmailParser: all header types, missing headers, encoded subjects
  - ThreadBuilder: single thread, branched thread, subject-only matching
  - MultipartHandler: text/plain, text/html, multipart/alternative, nested
  - HtmlToTextConverter: various HTML structures, malformed HTML
- **Integration Tests:**
  - Parse→Thread workflow on 100-message fixture
  - Gmail thread ID accuracy vs fallback threading
  - Performance test: 1000 messages in <5 seconds
- **Edge Case Tests:**
  - Missing Message-ID (generate synthetic ID)
  - Duplicate Message-IDs (append counter)
  - Circular References (detect and break loop)
  - Date parsing errors (use current date as fallback)

*File Structure:*
```
src/
  parsing/
    __init__.ts
    EmailParser.ts
    ThreadBuilder.ts
    MultipartHandler.ts
    HtmlToTextConverter.ts
    index.ts
tests/
  parsing/
    test_email_parser.ts
    test_thread_builder.ts
    test_multipart_handler.ts
    test_html_converter.ts
    fixtures/
      single_thread.json
      branched_thread.json
      multipart_email.eml
      html_email.eml
config/
  parsing.ts
```

- Deliverables: parser module, thread builder, tests for single/branched/missing-header cases.

**Phase 3: Preprocessing & Content Cleaning**

*Objective:* Clean and normalize email content by removing quoted replies, extracting signatures, and normalizing text for downstream NLP/extraction.

*Implementation Details:*

1. **Quoted Reply Remover (`QuotedReplyRemover.ts`)**
   - Class: `QuotedReplyRemover`
   - Methods:
     - `removeQuotedReplies(text: string)` → returns cleaned text
     - `detectQuoteMarkers(text: string)` → returns quote boundaries
     - `extractOriginalContent(text: string)` → returns only new content
   - Detection Patterns:
     ```
     - Lines starting with ">" or ">>"
     - "On DATE, PERSON wrote:" patterns
     - "From: ... Sent: ... To: ... Subject: ..." headers
     - Indented blocks (common in replies)
     - "--- Original Message ---" markers
     - Gmail-style quoted text (hidden in HTML)
     ```
   - Algorithm:
     1. Split text into lines
     2. Detect quote markers (>, "On...wrote:", forwarded headers)
     3. Remove quoted blocks while preserving original content
     4. Clean up excessive newlines
   - Acceptance Criteria:
     - ✓ Removes >90% of quoted content on test set
     - ✓ Preserves all original (non-quoted) content
     - ✓ Handles nested quoting (multiple reply levels)
     - ✓ Detects Gmail, Outlook, and RFC-style quoting

2. **Signature Extractor (`SignatureExtractor.ts`)**
   - Class: `SignatureExtractor`
   - Methods:
     - `extractSignature(text: string)` → returns `{ body: string, signature: SignatureData | null }`
     - `parseSignature(sigText: string)` → returns structured data
     - `detectSignatureBoundary(text: string)` → returns line number
   - Signature Patterns:
     ```
     - "-- " (RFC 3676 sig delimiter)
     - "Sent from my iPhone/Android"
     - "Best regards," "Sincerely," "Thanks," patterns
     - Contact info blocks (name, title, phone, email)
     - Disclaimer text ("This email is confidential...")
     ```
   - Signature Schema:
     ```typescript
     interface SignatureData {
       raw_text: string;
       name?: string;
       title?: string;
       company?: string;
       phone?: string;
       email?: string;
       disclaimer?: string;
     }
     ```
   - Extraction Strategy:
     - Look for signature delimiter ("-- ")
     - If not found, scan last 5-10 lines for contact patterns
     - Parse extracted signature for structured fields
     - Separate disclaimer text from contact info
   - Acceptance Criteria:
     - ✓ Detects 85%+ of signatures on test set
     - ✓ Extracts contact info (name, phone, email)
     - ✓ Separates signature from body content
     - ✓ Handles multi-line signatures

3. **Text Normalizer (`TextNormalizer.ts`)**
   - Class: `TextNormalizer`
   - Methods:
     - `normalize(text: string)` → returns normalized text
     - `normalizeWhitespace(text: string)` → cleans whitespace
     - `normalizeUnicode(text: string)` → handles encodings
     - `normalizeCase(text: string, mode: 'lower' | 'title')` → case normalization
   - Normalization Steps:
     ```
     1. Unicode normalization (NFC form)
     2. Remove control characters
     3. Collapse multiple spaces/tabs → single space
     4. Collapse multiple newlines → max 2
     5. Trim lines
     6. Remove zero-width characters
     7. Normalize quotes (" " → " ")
     8. Normalize dashes (– — → -)
     ```
   - Special Handling:
     - Preserve structure (don't collapse all newlines)
     - Keep important punctuation
     - Handle common UTF-8 mojibake
     - Normalize smart quotes to ASCII
   - Acceptance Criteria:
     - ✓ Produces deterministic output
     - ✓ Handles all common Unicode normalization cases
     - ✓ Preserves paragraph structure
     - ✓ Removes invisible characters

4. **Content Cleaning Pipeline (`CleaningPipeline.ts`)**
   - Class: `CleaningPipeline`
   - Methods:
     - `clean(text: string, options?: CleaningOptions)` → returns `CleanedContent`
     - `addCleaner(cleaner: ContentCleaner)` → adds custom cleaner
     - `removeCleaner(name: string)` → removes cleaner
   - Pipeline Stages:
     ```
     1. Remove quoted replies → original content only
     2. Extract signature → body + signature data
     3. Normalize text → clean, consistent format
     4. (Optional) Remove disclaimers
     5. (Optional) Remove URLs/emails for privacy
     ```
   - Output Schema:
     ```typescript
     interface CleanedContent {
       original_text: string;
       cleaned_text: string;
       signature?: SignatureData;
       removed_quotes: string[];
       normalization_applied: string[];
       char_count_before: number;
       char_count_after: number;
     }
     ```
   - Configurable Options:
     ```typescript
     interface CleaningOptions {
       remove_quotes: boolean;
       extract_signature: boolean;
       normalize_text: boolean;
       remove_disclaimers: boolean;
       preserve_urls: boolean;
       preserve_emails: boolean;
     }
     ```
   - Acceptance Criteria:
     - ✓ Modular pipeline (add/remove cleaners)
     - ✓ Configurable cleaning stages
     - ✓ Tracks what was removed/changed
     - ✓ Preserves original for comparison

*Configuration Example (`config/cleaning.ts`):*
```typescript
export interface CleaningConfig {
  quotes: {
    remove_quoted_replies: boolean;
    quote_markers: string[]; // ['>', 'On...wrote:', etc.]
    max_quote_depth: number;
  };
  signatures: {
    extract_signatures: boolean;
    parse_contact_info: boolean;
    signature_markers: string[]; // ['--', 'Sent from', etc.]
    max_signature_lines: number;
  };
  normalization: {
    normalize_unicode: boolean;
    normalize_whitespace: boolean;
    collapse_newlines: boolean;
    max_consecutive_newlines: number;
  };
}
```

*Testing Strategy:*
- **Unit Tests:**
  - QuotedReplyRemover: various quote styles, nested quotes, no quotes
  - SignatureExtractor: RFC delimiter, contact blocks, disclaimers
  - TextNormalizer: Unicode, whitespace, special chars
  - CleaningPipeline: full pipeline, selective stages, custom cleaners
- **Integration Tests:**
  - Real email samples with quotes/signatures
  - Edge cases: signature-only emails, no signature, multiple sigs
  - Performance: 1000 emails in <5 seconds
- **Comparison Tests:**
  - Before/after cleaning comparison
  - Verify no content loss (only remove quotes/sigs)

*File Structure:*
```
src/
  cleaning/
    __init__.ts
    QuotedReplyRemover.ts
    SignatureExtractor.ts
    TextNormalizer.ts
    CleaningPipeline.ts
    types.ts
    index.ts
tests/
  cleaning/
    test_quoted_reply_remover.ts
    test_signature_extractor.ts
    test_text_normalizer.ts
    test_cleaning_pipeline.ts
    fixtures/
      email_with_quotes.txt
      email_with_signature.txt
      email_with_unicode.txt
config/
  cleaning.ts
```

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
