# Migration Guide: emailCleanerService → CleaningPipeline

## Overview

This guide helps migrate from the old `emailCleanerService.ts` to the new Phase 3 `CleaningPipeline`.

## Why Migrate?

### Old Service (`emailCleanerService.ts`)
- Basic pattern matching
- Limited configuration
- No signature parsing
- No batch processing
- Minimal test coverage

### New Pipeline (`CleaningPipeline`)
- Advanced quote detection
- Structured signature extraction
- Comprehensive normalization
- Batch processing support
- 112 comprehensive tests
- Configurable options
- Better performance

## Migration Steps

### Step 1: Update Imports

**Before**:
```typescript
import { cleanEmail, EmailCleaningOptions } from './services/emailCleanerService';
```

**After**:
```typescript
import { CleaningPipeline, CleaningOptions } from './cleaning';
```

### Step 2: Update Function Calls

**Before**:
```typescript
const result = cleanEmail(emailText, {
  removeSignatures: true,
  removeQuotedText: true,
  removeDisclaimers: true
});

console.log(result.cleanedText);
```

**After**:
```typescript
const pipeline = new CleaningPipeline({
  remove_quoted_replies: true,
  extract_signatures: true,
  normalize_text: true
});

const result = pipeline.clean(emailText);

console.log(result.cleaned_body);
```

### Step 3: Update Result Access

**Before**:
```typescript
interface EmailCleaningResult {
  cleanedText: string;
  originalText: string;
  removedSections: Array<...>;
  linesRemoved: number;
  linesKept: number;
  confidence: number;
}
```

**After**:
```typescript
interface CleanedContent {
  cleaned_body: string;
  original_text: string;
  signature?: SignatureData;
  had_quoted_replies: boolean;
  had_signature: boolean;
  original_length: number;
  cleaned_length: number;
  processing_time_ms: number;
  has_minimum_content: boolean;
}
```

### Step 4: Handle Signature Data

**New Feature** - Structured signature extraction:

```typescript
const result = pipeline.clean(emailText);

if (result.signature) {
  console.log('Name:', result.signature.name);
  console.log('Email:', result.signature.email);
  console.log('Phone:', result.signature.phone);
  console.log('Company:', result.signature.company);
  console.log('Title:', result.signature.title);
  console.log('Disclaimer:', result.signature.disclaimer);
}
```

## Detailed Mapping

### Configuration Options

| Old Option | New Option | Notes |
|-----------|-----------|-------|
| `removeSignatures` | `extract_signatures` | Now extracts instead of just removing |
| `removeQuotedText` | `remove_quoted_replies` | Renamed for clarity |
| `removeDisclaimers` | (part of signature) | Now extracted with signature |
| `removeForwardedHeaders` | (included in quotes) | Handled by quote removal |
| `removeAutoReplyMessages` | N/A | Not yet implemented |
| `preserveMinLines` | `min_content_length` | Changed from lines to characters |

### Result Properties

| Old Property | New Property | Notes |
|-------------|--------------|-------|
| `cleanedText` | `cleaned_body` | Renamed |
| `originalText` | `original_text` | Renamed |
| `removedSections` | N/A | Not directly available |
| `linesRemoved` | Calculate from lengths | Use `original_length - cleaned_length` |
| `linesKept` | N/A | Not directly available |
| `confidence` | N/A | Per-component confidence available |

## Code Examples

### Example 1: Basic Migration

**Before**:
```typescript
import { cleanEmail } from './services/emailCleanerService';

async function processEmail(text: string) {
  const result = cleanEmail(text, {
    removeSignatures: true,
    removeQuotedText: true
  });

  return result.cleanedText;
}
```

**After**:
```typescript
import { CleaningPipeline } from './cleaning';

const pipeline = new CleaningPipeline({
  extract_signatures: true,
  remove_quoted_replies: true
});

async function processEmail(text: string) {
  const result = pipeline.clean(text);
  return result.cleaned_body;
}
```

### Example 2: With Options

**Before**:
```typescript
const options = {
  removeSignatures: true,
  removeQuotedText: true,
  removeDisclaimers: true,
  removeForwardedHeaders: true,
  preserveMinLines: 3
};

const result = cleanEmail(emailText, options);
```

**After**:
```typescript
const pipeline = new CleaningPipeline({
  extract_signatures: true,
  remove_quoted_replies: true,
  normalize_text: true,
  min_content_length: 50  // Characters instead of lines
});

const result = pipeline.clean(emailText);
```

### Example 3: Processing Multiple Emails

**Before**:
```typescript
const results = emails.map(email => {
  return cleanEmail(email.body, options);
});
```

**After** (now with batch support!):
```typescript
const pipeline = new CleaningPipeline();
const emailBodies = emails.map(e => e.body);

// Batch processing is more efficient
const results = pipeline.cleanBatch(emailBodies);

// Get statistics
const stats = pipeline.getBatchStatistics(results);
console.log('Processed:', stats.total_messages);
console.log('Reduction:', stats.reduction_percent + '%');
```

### Example 4: Accessing Removed Content

**Before**:
```typescript
const result = cleanEmail(text);

// Access what was removed
result.removedSections.forEach(section => {
  console.log(`Removed ${section.type}:`, section.content);
});
```

**After**:
```typescript
const result = pipeline.clean(text);

// Signature is now structured
if (result.signature) {
  console.log('Extracted signature:', result.signature);
}

// Check what was found
console.log('Had quotes:', result.had_quoted_replies);
console.log('Had signature:', result.had_signature);

// Original text is still available
console.log('Original:', result.original_text);
```

## File Processor Integration

Update the file processor to use the new pipeline:

**Before** (in `fileProcessor.ts`):
```typescript
// May not have been using email cleaning at all
const extractedEntities = await aiExtraction.extract(emailText);
```

**After**:
```typescript
import { CleaningPipeline } from './cleaning';

// Initialize once
const cleaningPipeline = new CleaningPipeline();

// In processing function
const cleaned = cleaningPipeline.clean(emailText);

// Use cleaned text for extraction
const extractedEntities = await aiExtraction.extract(cleaned.cleaned_body);

// Save signature data if needed
if (cleaned.signature) {
  await saveSignatureData(cleaned.signature);
}
```

## Testing Your Migration

### Unit Tests

Update your tests to use the new API:

**Before**:
```typescript
describe('email cleaning', () => {
  it('should remove quotes', () => {
    const result = cleanEmail('Text\n> Quote');
    expect(result.cleanedText).not.toContain('>');
  });
});
```

**After**:
```typescript
describe('email cleaning', () => {
  it('should remove quotes', () => {
    const pipeline = new CleaningPipeline();
    const result = pipeline.clean('Text\n> Quote');
    expect(result.cleaned_body).not.toContain('>');
    expect(result.had_quoted_replies).toBe(true);
  });
});
```

### Integration Tests

See `src/__tests__/integration/phases-1-2-3.test.ts` for examples of full pipeline integration testing.

## Performance Considerations

### Memory Usage
- **Old**: Processed entire email in memory
- **New**: Also in memory, but more efficient
- **Future**: Streaming support planned for very large emails

### Speed
- **Old**: Variable performance
- **New**: < 2ms for average email, < 100ms for large emails
- **Batch**: Efficient statistics tracking

### Benchmarking

```typescript
const pipeline = new CleaningPipeline();
const startTime = Date.now();

const result = pipeline.clean(largeEmailText);

console.log('Processing time:', result.processing_time_ms, 'ms');
```

## Rollout Strategy

### Phase 1: Parallel Running (Recommended)
Run both old and new services side-by-side:

```typescript
import { cleanEmail } from './services/emailCleanerService';
import { CleaningPipeline } from './cleaning';

const pipeline = new CleaningPipeline();

// Compare results
const oldResult = cleanEmail(text);
const newResult = pipeline.clean(text);

// Use new result but log differences
logger.info('Cleaning comparison', {
  old_length: oldResult.cleanedText.length,
  new_length: newResult.cleaned_body.length,
  difference: Math.abs(oldResult.cleanedText.length - newResult.cleaned_body.length)
});

// Use new result
return newResult.cleaned_body;
```

### Phase 2: Switch Over
Once validated, fully switch to new pipeline:

```typescript
import { CleaningPipeline } from './cleaning';

const pipeline = new CleaningPipeline();
const result = pipeline.clean(text);
return result.cleaned_body;
```

### Phase 3: Remove Old Service
After successful migration:
1. Remove `emailCleanerService.ts`
2. Update all references
3. Remove old tests

## Troubleshooting

### Issue: Results are different

**Cause**: New pipeline has more sophisticated detection.

**Solution**:
- Check `result.had_quoted_replies` and `result.had_signature`
- Compare `original_text` with `cleaned_body`
- Review what was detected as quotes/signatures

### Issue: Missing minimum content

**Cause**: Email was mostly quotes/signatures.

**Solution**:
- Check `result.has_minimum_content`
- Adjust `min_content_length` option if needed
- Review if email truly has valuable content

### Issue: Signature not extracted

**Cause**: Non-standard signature format.

**Solution**:
- Check `extractor.getSignatureConfidence(text)`
- Signature may still be in `cleaned_body` if confidence is low
- Consider adding custom signature patterns

### Issue: Performance regression

**Cause**: Processing many small emails individually.

**Solution**:
- Use `cleanBatch()` for batch processing
- Profile with `result.processing_time_ms`
- Check configuration options (disable unneeded features)

## Configuration Guide

### Environment Variables

Create `.env` file with:

```bash
# Basic options
CLEANING_REMOVE_QUOTES=true
CLEANING_EXTRACT_SIGNATURES=true
CLEANING_NORMALIZE_TEXT=true
CLEANING_MIN_CONTENT_LENGTH=10

# Advanced normalization
NORM_UNICODE=NFC
NORM_REMOVE_CONTROL_CHARS=true
NORM_WHITESPACE=true
NORM_MAX_NEWLINES=2
NORM_TRIM_LINES=true
```

### Runtime Configuration

```typescript
const pipeline = new CleaningPipeline();

// Update for specific use case
pipeline.updateOptions({
  min_content_length: 100,  // Longer emails only
  remove_quoted_replies: false  // Keep quotes for this batch
});

// Process
const result = pipeline.clean(text);

// Reset to defaults
pipeline.updateOptions({
  remove_quoted_replies: true
});
```

## FAQ

### Q: Can I use only some features?

**A**: Yes! Use individual components:

```typescript
import { QuotedReplyRemover } from './cleaning';

const remover = new QuotedReplyRemover();
const cleaned = remover.removeQuotedReplies(text);
```

### Q: How do I handle errors?

**A**: The pipeline handles errors gracefully:

```typescript
try {
  const result = pipeline.clean(text);
  if (!result.has_minimum_content) {
    logger.warn('Email has minimal content after cleaning');
  }
} catch (error) {
  logger.error('Cleaning failed', { error });
  // Fallback to original text
  return { cleaned_body: text };
}
```

### Q: Can I customize cleaning rules?

**A**: Yes, extend the components:

```typescript
import { QuotedReplyRemover } from './cleaning';

class CustomQuoteRemover extends QuotedReplyRemover {
  // Add custom patterns
  constructor() {
    super();
    this.customPatterns = [...];
  }
}
```

### Q: What about performance at scale?

**A**: Use batch processing:

```typescript
// Process 1000 emails efficiently
const results = pipeline.cleanBatch(emails);

// Get aggregate statistics
const stats = pipeline.getBatchStatistics(results);
```

## Support

If you encounter issues during migration:
1. Check the test suite: `npm test -- --testPathPatterns=cleaning`
2. Review integration tests: `src/__tests__/integration/phases-1-2-3.test.ts`
3. Check configuration: `src/config/cleaning.ts`
4. Review types: `src/cleaning/types.ts`

## Rollback Plan

If you need to rollback:
1. Keep `emailCleanerService.ts` until migration is validated
2. Use feature flags to toggle between implementations
3. Monitor metrics to ensure quality
4. Rollback is simple: revert imports and function calls

---

**Migration Complete?** ✅

Update this checklist:
- [ ] Imports updated
- [ ] Function calls migrated
- [ ] Tests updated
- [ ] Performance validated
- [ ] Monitoring in place
- [ ] Old service removed
