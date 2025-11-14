# Phase 3 Content Cleaning Pipeline - Usage Examples

This guide provides practical examples for using the Phase 3 Content Cleaning Pipeline in various scenarios.

---

## Table of Contents
1. [Basic Usage](#basic-usage)
2. [Configuration Options](#configuration-options)
3. [Batch Processing](#batch-processing)
4. [Integration with MBOX Parser](#integration-with-mbox-parser)
5. [Advanced Use Cases](#advanced-use-cases)
6. [Performance Optimization](#performance-optimization)

---

## Basic Usage

### Simple Email Cleaning

```typescript
import { CleaningPipeline } from './cleaning/CleaningPipeline';

// Initialize pipeline with default options
const pipeline = new CleaningPipeline();

// Clean an email
const rawEmail = `
Hi there,

Thanks for your interest in our product!

> On Jan 15, 2024, John Doe wrote:
> Can you send me pricing information?

Best regards,
--
Jane Smith
Sales Manager
jane@example.com
(555) 123-4567
`;

const result = pipeline.clean(rawEmail);

console.log('Cleaned body:', result.cleaned_body);
// Output: "Hi there,\n\nThanks for your interest in our product!"

console.log('Signature:', result.signature);
// Output: { name: "Jane Smith", email: "jane@example.com", phone: "(555) 123-4567", ... }

console.log('Had quoted replies?', result.had_quoted_replies);
// Output: true

console.log('Processing time:', result.processing_time_ms, 'ms');
// Output: ~1-2ms
```

---

## Configuration Options

### Custom Cleaning Options

```typescript
// Conservative cleaning - preserve more content
const conservativePipeline = new CleaningPipeline({
  remove_quoted_replies: false,  // Keep quoted content
  extract_signatures: true,      // Still extract signatures
  normalize_text: false,          // Don't normalize
  preserve_structure: true,       // Keep formatting
  min_content_length: 50,         // Require 50+ characters
});

// Aggressive cleaning - maximum noise removal
const aggressivePipeline = new CleaningPipeline({
  remove_quoted_replies: true,
  extract_signatures: true,
  normalize_text: true,
  preserve_structure: false,
  min_content_length: 10,
});

// Runtime option updates
pipeline.updateOptions({
  normalize_text: false,
  min_content_length: 20,
});
```

### Specialized Pipelines

```typescript
// Body-only extraction (keep signature in place)
const bodyResult = pipeline.cleanBodyOnly(rawEmail);
// Signature remains in the text, but quoted replies are removed

// Signature-only extraction
const signature = pipeline.extractSignatureOnly(rawEmail);
// Returns SignatureData or null

// Quote removal only
const unquotedText = pipeline.removeQuotesOnly(rawEmail);
// Removes quoted replies but keeps everything else

// Normalization only
const normalizedText = pipeline.normalizeOnly(rawEmail);
// Just normalizes whitespace, Unicode, etc.
```

---

## Batch Processing

### Process Multiple Emails Efficiently

```typescript
const emails = [
  'Email 1 content...',
  'Email 2 content...',
  'Email 3 content...',
  // ... thousands more
];

// Process entire batch
const results = pipeline.cleanBatch(emails);

// Get batch statistics
const stats = pipeline.getBatchStatistics(results);

console.log('Batch statistics:');
console.log('- Total processed:', stats.total_processed);
console.log('- Avg processing time:', stats.average_processing_time_ms, 'ms');
console.log('- Emails with signatures:', stats.emails_with_signatures);
console.log('- Emails with quoted replies:', stats.emails_with_quoted_replies);
console.log('- Avg reduction %:', stats.average_reduction_percent);
console.log('- Total time:', stats.total_processing_time_ms, 'ms');
```

**Example Output:**
```
Batch statistics:
- Total processed: 1000
- Avg processing time: 1.8 ms
- Emails with signatures: 750
- Emails with quoted replies: 820
- Avg reduction %: 32.5
- Total time: 1850 ms
```

---

## Integration with MBOX Parser

### How Phase 3 is Used in Production

The Phase 3 CleaningPipeline is automatically integrated into the MBOX processing workflow:

```typescript
// In enhancedMboxParser.ts

import { CleaningPipeline } from '../cleaning/CleaningPipeline';

// Initialize once at module level
const cleaningPipeline = new CleaningPipeline({
  remove_quoted_replies: true,
  extract_signatures: true,
  normalize_text: true,
  preserve_structure: true,
  min_content_length: 10,
});

export function preprocessEmail(text: string, isHtml: boolean = false): string {
  let cleaned = text;

  if (isHtml) {
    cleaned = stripHtml(cleaned);
  }

  // Use Phase 3 CleaningPipeline
  const cleaningResult = cleaningPipeline.clean(cleaned);

  logger.debug('Email cleaning complete', {
    originalLength: cleaningResult.original_length,
    cleanedLength: cleaningResult.cleaned_length,
    reductionPercent: Math.round(
      (1 - cleaningResult.cleaned_length / cleaningResult.original_length) * 100
    ),
    hadQuotedReplies: cleaningResult.had_quoted_replies,
    hadSignature: cleaningResult.had_signature,
    processingTimeMs: cleaningResult.processing_time_ms,
  });

  return cleaningResult.cleaned_body;
}
```

### Complete Pipeline Flow

```
User uploads MBOX file
       ↓
fileProcessor.ts → processMboxFile()
       ↓
streamingMboxParser.ts → parseStreamingMboxFile()
       ↓
For each email message:
       ↓
enhancedMboxParser.ts → preprocessEmail()
       ↓
Phase 3 CleaningPipeline → clean()
  ├─ QuotedReplyRemover → remove quotes
  ├─ SignatureExtractor → extract signature
  └─ TextNormalizer → normalize text
       ↓
Return cleaned body for AI extraction
       ↓
Phase 4 AI processes clean text
       ↓
Structured data saved to database
```

---

## Advanced Use Cases

### 1. Signature-Based Contact Enrichment

```typescript
const result = pipeline.clean(emailBody);

if (result.signature) {
  const contact = {
    name: result.signature.name,
    email: result.signature.email,
    phone: result.signature.phone,
    title: result.signature.title,
    company: result.signature.company,
    // Store raw signature for reference
    signature_text: result.signature.raw_text,
  };

  // Save to database or enrich existing contact
  await enrichContact(contact);
}
```

### 2. Quality Validation

```typescript
const result = pipeline.clean(emailBody);

// Check if cleaned content meets quality threshold
if (!result.has_minimum_content) {
  logger.warn('Email has insufficient content after cleaning', {
    original_length: result.original_length,
    cleaned_length: result.cleaned_length,
  });
  // Skip AI processing or flag for review
}

// Validate result integrity
const isValid = pipeline.validateResult(result);
if (!isValid) {
  logger.error('Invalid cleaning result', result);
  // Use original text as fallback
}
```

### 3. Performance Monitoring

```typescript
const results = pipeline.cleanBatch(emails);

// Monitor performance metrics
results.forEach(result => {
  // Alert if processing is slow
  if (result.processing_time_ms > 10) {
    logger.warn('Slow email processing detected', {
      processing_time: result.processing_time_ms,
      email_length: result.original_length,
    });
  }

  // Track cleaning effectiveness
  const reductionPercent =
    (1 - result.cleaned_length / result.original_length) * 100;

  if (reductionPercent > 50) {
    logger.info('High noise reduction', {
      reduction_percent: reductionPercent,
      had_quotes: result.had_quoted_replies,
      had_signature: result.had_signature,
    });
  }
});
```

### 4. A/B Testing Old vs New Pipeline

```typescript
import { cleanEmailText } from './services/emailCleanerService';  // Old
import { CleaningPipeline } from './cleaning/CleaningPipeline';  // New

const newPipeline = new CleaningPipeline();

function compareCleaningMethods(emailText: string) {
  // Old method
  const oldStart = Date.now();
  const oldResult = cleanEmailText(emailText, {
    removeSignatures: true,
    removeQuotedText: true,
  });
  const oldTime = Date.now() - oldStart;

  // New method
  const newStart = Date.now();
  const newResult = newPipeline.clean(emailText);
  const newTime = Date.now() - newStart;

  return {
    old: {
      text: oldResult.cleanedText,
      time: oldTime,
      linesRemoved: oldResult.linesRemoved,
    },
    new: {
      text: newResult.cleaned_body,
      time: newTime,
      signature: newResult.signature,
      hadQuotes: newResult.had_quoted_replies,
      reductionPercent:
        (1 - newResult.cleaned_length / newResult.original_length) * 100,
    },
  };
}
```

---

## Performance Optimization

### 1. Reuse Pipeline Instances

**❌ Don't create new instances for each email:**
```typescript
// BAD - creates new instance every time
emails.forEach(email => {
  const pipeline = new CleaningPipeline();  // Wasteful!
  const result = pipeline.clean(email);
});
```

**✅ Create once, reuse many times:**
```typescript
// GOOD - reuse single instance
const pipeline = new CleaningPipeline();
const results = emails.map(email => pipeline.clean(email));

// BEST - use built-in batch method
const results = pipeline.cleanBatch(emails);
```

### 2. Optimize for Your Use Case

```typescript
// For high-volume processing with known clean data
const fastPipeline = new CleaningPipeline({
  normalize_text: false,      // Skip normalization if not needed
  preserve_structure: false,  // Allow more aggressive cleaning
  min_content_length: 5,      // Lower threshold
});

// For high-quality extraction (slower but more thorough)
const thoroughPipeline = new CleaningPipeline({
  normalize_text: true,
  preserve_structure: true,
  extract_signatures: true,
  remove_quoted_replies: true,
});
```

### 3. Benchmark Your Usage

```typescript
import { performance } from 'perf_hooks';

const pipeline = new CleaningPipeline();
const iterations = 1000;

const start = performance.now();
for (let i = 0; i < iterations; i++) {
  pipeline.clean(sampleEmail);
}
const end = performance.now();

const avgTime = (end - start) / iterations;
console.log(`Average processing time: ${avgTime.toFixed(2)}ms per email`);
console.log(`Throughput: ${(1000 / avgTime).toFixed(0)} emails/second`);
```

**Expected Performance:**
- Average processing time: 1-3ms per email
- Throughput: 300-1000 emails/second (single-threaded)
- Memory: Constant (no accumulation)

---

## Real-World Examples

### Example 1: Deal Registration Email

**Input:**
```
Subject: Deal Registration Request - Acme Corp

Hi Sales Team,

I'd like to register a deal opportunity with Acme Corporation.

Deal Details:
- Customer: Acme Corporation
- Value: $250,000
- Close Date: Q2 2024
- Products: Enterprise License (100 users)

Please confirm registration.

> On Jan 10, 2024, Partner Portal wrote:
> Thank you for your submission. We'll review and respond within 24 hours.

Thanks,
--
John Doe
Partner Sales Manager
john.doe@techpartner.com
Mobile: (555) 123-4567
TechPartner Solutions, Inc.
```

**Output:**
```typescript
{
  cleaned_body: "Hi Sales Team,\n\nI'd like to register a deal opportunity with Acme Corporation.\n\nDeal Details:\n- Customer: Acme Corporation\n- Value: $250,000\n- Close Date: Q2 2024\n- Products: Enterprise License (100 users)\n\nPlease confirm registration.",

  signature: {
    raw_text: "John Doe\nPartner Sales Manager\njohn.doe@techpartner.com\nMobile: (555) 123-4567\nTechPartner Solutions, Inc.",
    name: "John Doe",
    email: "john.doe@techpartner.com",
    phone: "(555) 123-4567",
    title: "Partner Sales Manager",
    company: "TechPartner Solutions, Inc.",
    confidence: 0.95
  },

  had_quoted_replies: true,
  had_signature: true,
  original_length: 523,
  cleaned_length: 278,
  processing_time_ms: 1.8,
  has_minimum_content: true
}
```

### Example 2: Email Thread with Multiple Replies

**Input:** Long email thread with 5+ replies

**Cleaning Process:**
1. QuotedReplyRemover detects:
   - 5 ">" prefixed sections
   - 3 "On [date], [person] wrote:" headers
   - 2 "Forwarded message" blocks
2. SignatureExtractor finds signature at bottom
3. TextNormalizer cleans up formatting

**Result:** Only the latest message content extracted, signature preserved separately

**Performance:** 2.3ms (longer due to complex quoted structure)

---

## Troubleshooting

### Issue: Signature not detected

**Problem:** `result.signature` is `null` but email has signature

**Solution:** Check signature format. The extractor looks for:
- RFC 3676 delimiter (`-- `)
- Common closings (Best regards, Thanks, etc.)
- Contact information (email, phone)

**Debug:**
```typescript
import { SignatureExtractor } from './cleaning/SignatureExtractor';

const extractor = new SignatureExtractor();
const boundary = extractor.detectSignatureBoundary(emailText);
console.log('Signature boundary:', boundary);
// Returns: { startLine: number, confidence: number } or null
```

### Issue: Too much content removed

**Problem:** `cleaned_body` is much shorter than expected

**Solution:** Adjust options or check quote detection

**Debug:**
```typescript
import { QuotedReplyRemover } from './cleaning/QuotedReplyRemover';

const remover = new QuotedReplyRemover();
const stats = remover.getQuoteStats(emailText);
console.log('Quote statistics:', stats);
// Shows: { total_lines, quoted_lines, quote_percentage }
```

### Issue: Performance slower than expected

**Problem:** Processing time > 5ms per email

**Solutions:**
1. Disable normalization if not needed: `normalize_text: false`
2. Use batch processing: `cleanBatch()` instead of individual `clean()`
3. Check email length (very long emails take longer)

---

## Migration Checklist

When migrating from old `emailCleanerService` to Phase 3:

- [ ] Update import statements
- [ ] Initialize CleaningPipeline once (module level)
- [ ] Update function calls to use `clean()` method
- [ ] Update result property access (`cleaned_text` → `cleaned_body`)
- [ ] Utilize signature extraction data if available
- [ ] Update logging to use new metrics
- [ ] Run tests to verify behavior
- [ ] Monitor performance in production

See `MIGRATION_GUIDE.md` for detailed migration instructions.

---

## Summary

Phase 3 Content Cleaning Pipeline provides:

✅ **Comprehensive Cleaning**: Removes quotes, signatures, and noise
✅ **Structured Output**: Extracted signatures with parsed fields
✅ **High Performance**: 1-3ms per email average
✅ **Configurable**: Flexible options for different use cases
✅ **Production-Ready**: Integrated into MBOX processing pipeline
✅ **Well-Tested**: 112 unit tests + 9 integration tests

For more information, see:
- `backend/src/cleaning/` - Source code
- `backend/src/__tests__/cleaning/` - Test examples
- `MIGRATION_GUIDE.md` - Migration from old service
- `PULL_REQUEST_PHASE_3.md` - Feature overview
