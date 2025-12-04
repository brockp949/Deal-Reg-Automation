# ErrorTrackingService Usage Guide

## Overview
The ErrorTrackingService provides comprehensive error logging, querying, and resolution capabilities for the Deal Registration system. It integrates with the `error_logs` database table created by migration `011_error_tracking.sql`.

## Quick Start

### Logging Errors

#### Basic Error Logging
```typescript
import { logError } from './services/ErrorTrackingService';

const errorId = await logError({
  errorCategory: 'parsing',
  errorType: 'invalid_format',
  errorSeverity: 'error',
  errorMessage: 'Failed to parse MBOX file',
  sourceComponent: 'mbox_parser',
});
```

#### Parsing Error (Convenience Method)
```typescript
import { logParsingError } from './services/ErrorTrackingService';

await logParsingError({
  sourceFileId: fileId,
  fileName: 'deals.mbox',
  fileType: 'mbox',
  errorMessage: 'Invalid email format at line 42',
  errorSeverity: 'warning',
  lineNumber: 42,
  locationContext: 'Email headers section',
});
```

#### Extraction Error (Convenience Method)
```typescript
import { logExtractionError } from './services/ErrorTrackingService';

await logExtractionError({
  sourceFileId: fileId,
  fileName: 'vendors.csv',
  entityType: 'vendor',
  errorMessage: 'Could not extract vendor name',
  inputData: rawCsvLine,
  expectedFormat: 'Name,Email,Phone',
});
```

#### Validation Error (Convenience Method)
```typescript
import { logValidationError } from './services/ErrorTrackingService';

await logValidationError({
  entityType: 'deal',
  entityId: dealId,
  fieldName: 'deal_value',
  fieldValue: '-100',
  validationRule: 'must be positive',
  errorMessage: 'Deal value cannot be negative',
});
```

### Querying Errors

#### Get Error by ID
```typescript
import { getErrorById } from './services/ErrorTrackingService';

const error = await getErrorById(errorId);
console.log(error?.errorMessage);
console.log(error?.isResolved);
```

#### Get All Errors for a File
```typescript
import { getErrorsByFile } from './services/ErrorTrackingService';

const errors = await getErrorsByFile(sourceFileId);
console.log(`Found ${errors.length} errors for this file`);
```

#### Get Errors by Category and Severity
```typescript
import { getErrorsByCategorySeverity } from './services/ErrorTrackingService';

// Get all critical parsing errors
const criticalParsingErrors = await getErrorsByCategorySeverity(
  'parsing',
  'critical',
  50
);
```

#### Get Unresolved Errors
```typescript
import { getUnresolvedErrors } from './services/ErrorTrackingService';

const unresolvedErrors = await getUnresolvedErrors(100);
```

#### Get Error Statistics
```typescript
import { getErrorStatistics } from './services/ErrorTrackingService';

const stats = await getErrorStatistics();
stats.forEach(stat => {
  console.log(`${stat.errorCategory}/${stat.errorType}: ${stat.errorCount} total, ${stat.unresolvedCount} unresolved`);
});
```

### Resolving Errors

#### Mark Single Error as Resolved
```typescript
import { resolveError } from './services/ErrorTrackingService';

await resolveError(
  errorId,
  'user@example.com',
  'Fixed by updating the parser to handle edge case'
);
```

#### Bulk Resolve Errors
```typescript
import { bulkResolveErrors } from './services/ErrorTrackingService';

// Resolve all errors for a specific file
const count = await bulkResolveErrors({
  sourceFileId: fileId,
  resolvedBy: 'admin@example.com',
  resolutionNotes: 'File was reprocessed successfully',
});

console.log(`Resolved ${count} errors`);
```

## Error Categories

- **`parsing`** - File parsing errors (malformed files, encoding issues)
- **`extraction`** - Entity extraction failures (couldn't find/parse entities)
- **`validation`** - Data validation failures (invalid formats, missing required fields)
- **`processing`** - Processing errors (transformation, calculation failures)
- **`integration`** - Integration errors (API failures, database errors)

## Error Severities

- **`critical`** - System cannot continue, requires immediate attention
- **`error`** - Functionality failed, but system can continue
- **`warning`** - Issue detected, but operation completed
- **`info`** - Informational, no action required

## Database Views

The error tracking system provides several useful views:

### `error_statistics`
Aggregated statistics by category, severity, and type

### `recent_errors`
Last 7 days of errors (100 most recent)

### `unresolved_critical_errors`
All unresolved critical/error severity issues

## Integration Example

### In a File Parser
```typescript
import { logParsingError } from './services/ErrorTrackingService';

async function parseFile(file: SourceFile) {
  try {
    // Parse file
    const data = await parser.parse(file.content);
    return data;
  } catch (error) {
    // Log the parsing error
    await logParsingError({
      sourceFileId: file.id,
      fileName: file.filename,
      fileType: file.file_type,
      errorMessage: error.message,
      errorSeverity: 'error',
      errorData: {
        stack: error.stack,
      },
    });
    
    throw error;
  }
}
```

### In an Entity Extractor
```typescript
import { logExtractionError } from './services/ErrorTrackingService';

async function extractVendor(text: string, fileId: string) {
  const vendorMatch = /Vendor:\s*(.+)/i.exec(text);
  
  if (!vendorMatch) {
    await logExtractionError({
      sourceFileId: fileId,
      fileName: 'unknown',
      entityType: 'vendor',
      errorMessage: 'Could not find vendor pattern in text',
      inputData: text.substring(0, 500),
      expectedFormat: 'Vendor: Company Name',
    });
    
    return null;
  }
  
  return vendorMatch[1];
}
```

## Testing

Tests are located in `src/__tests__/ErrorTrackingService.test.ts` and cover:
- Basic error logging
- Full context error logging
- Parsing/extraction/validation convenience methods
- Error retrieval by ID and file
- Error resolution
- Different severity and category handling

Run tests with:
```bash
npm test -- ErrorTrackingService.test.ts
```
