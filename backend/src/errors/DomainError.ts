/**
 * Domain Error Base Class
 * Provides structured error handling with error codes, HTTP status mapping,
 * and retry capability information.
 */

// ============================================================================
// Error Codes
// ============================================================================

export type ErrorCode =
  // Parsing Errors (1xxx)
  | 'PARSE_001' // Invalid file format
  | 'PARSE_002' // File too large
  | 'PARSE_003' // Encoding error
  | 'PARSE_004' // Missing required field
  | 'PARSE_005' // Malformed content
  | 'PARSE_006' // Unsupported file type
  // Validation Errors (2xxx)
  | 'VALID_001' // Missing required field
  | 'VALID_002' // Invalid field format
  | 'VALID_003' // Constraint violation
  | 'VALID_004' // Business rule violation
  // Vendor Errors (3xxx)
  | 'VENDOR_001' // Vendor not found
  | 'VENDOR_002' // Vendor approval pending
  | 'VENDOR_003' // Vendor approval denied
  | 'VENDOR_004' // Vendor match ambiguous
  | 'VENDOR_005' // Vendor creation failed
  // Persistence Errors (4xxx)
  | 'PERSIST_001' // Database connection error
  | 'PERSIST_002' // Unique constraint violation
  | 'PERSIST_003' // Foreign key violation
  | 'PERSIST_004' // Transaction failed
  | 'PERSIST_005' // Query timeout
  // External Service Errors (5xxx)
  | 'EXT_001' // AI extraction failed
  | 'EXT_002' // External API timeout
  | 'EXT_003' // Rate limited
  | 'EXT_004' // Authentication failed
  // File System Errors (6xxx)
  | 'FILE_001' // File not found
  | 'FILE_002' // Permission denied
  | 'FILE_003' // Disk full
  | 'FILE_004' // Lock acquisition failed
  // Generic Errors
  | 'UNKNOWN';

// ============================================================================
// Base Domain Error
// ============================================================================

export interface DomainErrorContext {
  /** Original error that caused this error */
  cause?: Error;
  /** Entity ID if applicable */
  entityId?: string;
  /** Entity type (vendor, deal, contact, file) */
  entityType?: string;
  /** File path if applicable */
  filePath?: string;
  /** Line number if applicable */
  lineNumber?: number;
  /** Additional context */
  [key: string]: unknown;
}

export abstract class DomainError extends Error {
  /** Unique error code for categorization */
  abstract readonly code: ErrorCode;
  /** HTTP status code to return */
  abstract readonly httpStatus: number;
  /** Whether the operation can be retried */
  readonly isRetryable: boolean;
  /** Additional context about the error */
  readonly context: DomainErrorContext;
  /** Timestamp when error occurred */
  readonly timestamp: Date;

  constructor(
    message: string,
    context: DomainErrorContext = {},
    isRetryable = false
  ) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.isRetryable = isRetryable;
    this.timestamp = new Date();

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to a JSON-serializable object for logging/API responses.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      isRetryable: this.isRetryable,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }

  /**
   * Create a user-friendly error message (without sensitive details).
   */
  toUserMessage(): string {
    return `Error ${this.code}: ${this.message}`;
  }
}

// ============================================================================
// Parsing Errors
// ============================================================================

export class ParsingError extends DomainError {
  readonly code: ErrorCode;
  readonly httpStatus = 422; // Unprocessable Entity

  constructor(
    message: string,
    public readonly fileType: string,
    context: DomainErrorContext = {}
  ) {
    super(message, { ...context, fileType }, true); // Parsing errors are usually retryable
    this.code = this.determineCode(context);
  }

  private determineCode(context: DomainErrorContext): ErrorCode {
    if (context.cause?.message?.includes('encoding')) return 'PARSE_003';
    if (context.cause?.message?.includes('format')) return 'PARSE_001';
    if (context.lineNumber) return 'PARSE_005';
    return 'PARSE_005';
  }

  static invalidFormat(fileType: string, details?: string): ParsingError {
    return new ParsingError(
      `Invalid ${fileType} format${details ? ': ' + details : ''}`,
      fileType,
      {}
    );
  }

  static fileTooLarge(fileType: string, maxSize: number, actualSize: number): ParsingError {
    const error = new ParsingError(
      `File exceeds maximum size of ${maxSize} bytes (actual: ${actualSize})`,
      fileType,
      { maxSize, actualSize }
    );
    (error as { code: ErrorCode }).code = 'PARSE_002';
    return error;
  }

  static unsupportedType(fileType: string): ParsingError {
    const error = new ParsingError(
      `Unsupported file type: ${fileType}`,
      fileType,
      {}
    );
    (error as { code: ErrorCode }).code = 'PARSE_006';
    return error;
  }
}

// ============================================================================
// Validation Errors
// ============================================================================

export interface ValidationIssue {
  field: string;
  message: string;
  value?: unknown;
}

export class ValidationError extends DomainError {
  readonly code: ErrorCode = 'VALID_001';
  readonly httpStatus = 400; // Bad Request

  constructor(
    message: string,
    public readonly issues: ValidationIssue[],
    context: DomainErrorContext = {}
  ) {
    super(message, { ...context, issues }, false);
  }

  static missingField(field: string, entityType?: string): ValidationError {
    return new ValidationError(
      `Missing required field: ${field}`,
      [{ field, message: 'Field is required' }],
      { entityType }
    );
  }

  static invalidFormat(field: string, expectedFormat: string, value?: unknown): ValidationError {
    const error = new ValidationError(
      `Invalid format for field: ${field}`,
      [{ field, message: `Expected ${expectedFormat}`, value }],
      {}
    );
    (error as { code: ErrorCode }).code = 'VALID_002';
    return error;
  }

  static multipleIssues(issues: ValidationIssue[]): ValidationError {
    return new ValidationError(
      `Validation failed: ${issues.length} issue(s)`,
      issues,
      {}
    );
  }
}

// ============================================================================
// Vendor Errors
// ============================================================================

export class VendorError extends DomainError {
  readonly code: ErrorCode;
  readonly httpStatus: number;

  constructor(
    message: string,
    code: ErrorCode,
    httpStatus: number,
    context: DomainErrorContext = {},
    isRetryable = false
  ) {
    super(message, context, isRetryable);
    this.code = code;
    this.httpStatus = httpStatus;
  }

  static notFound(vendorId: string): VendorError {
    return new VendorError(
      `Vendor not found: ${vendorId}`,
      'VENDOR_001',
      404,
      { entityId: vendorId, entityType: 'vendor' }
    );
  }

  static approvalPending(vendorName: string, aliasId: string): VendorError {
    return new VendorError(
      `Vendor "${vendorName}" requires approval`,
      'VENDOR_002',
      409, // Conflict
      { entityType: 'vendor', vendorName, aliasId },
      true // Can retry after approval
    );
  }

  static approvalDenied(vendorName: string): VendorError {
    return new VendorError(
      `Vendor "${vendorName}" has been denied`,
      'VENDOR_003',
      403, // Forbidden
      { entityType: 'vendor', vendorName }
    );
  }

  static matchAmbiguous(vendorName: string, candidates: string[]): VendorError {
    return new VendorError(
      `Ambiguous vendor match for "${vendorName}"`,
      'VENDOR_004',
      409,
      { entityType: 'vendor', vendorName, candidates }
    );
  }
}

// ============================================================================
// Persistence Errors
// ============================================================================

export class PersistenceError extends DomainError {
  readonly code: ErrorCode;
  readonly httpStatus = 500;

  constructor(
    message: string,
    code: ErrorCode,
    public readonly operation: 'insert' | 'update' | 'delete' | 'query',
    context: DomainErrorContext = {},
    isRetryable = false
  ) {
    super(message, { ...context, operation }, isRetryable);
    this.code = code;
  }

  static connectionError(details?: string): PersistenceError {
    return new PersistenceError(
      `Database connection error${details ? ': ' + details : ''}`,
      'PERSIST_001',
      'query',
      {},
      true // Connection errors are retryable
    );
  }

  static uniqueViolation(entityType: string, field: string, value?: string): PersistenceError {
    return new PersistenceError(
      `Duplicate ${entityType}: ${field} already exists`,
      'PERSIST_002',
      'insert',
      { entityType, field, value }
    );
  }

  static foreignKeyViolation(entityType: string, reference: string): PersistenceError {
    return new PersistenceError(
      `Referenced ${reference} does not exist`,
      'PERSIST_003',
      'insert',
      { entityType, reference }
    );
  }

  static transactionFailed(operation: string, cause?: Error): PersistenceError {
    return new PersistenceError(
      `Transaction failed during ${operation}`,
      'PERSIST_004',
      'query',
      { cause },
      true
    );
  }

  static queryTimeout(query: string): PersistenceError {
    return new PersistenceError(
      'Query timed out',
      'PERSIST_005',
      'query',
      { query: query.substring(0, 100) },
      true
    );
  }
}

// ============================================================================
// External Service Errors
// ============================================================================

export class ExternalServiceError extends DomainError {
  readonly code: ErrorCode;
  readonly httpStatus = 502; // Bad Gateway

  constructor(
    message: string,
    code: ErrorCode,
    public readonly service: string,
    context: DomainErrorContext = {},
    isRetryable = true
  ) {
    super(message, { ...context, service }, isRetryable);
    this.code = code;
  }

  static aiExtractionFailed(details?: string, cause?: Error): ExternalServiceError {
    return new ExternalServiceError(
      `AI extraction failed${details ? ': ' + details : ''}`,
      'EXT_001',
      'anthropic',
      { cause }
    );
  }

  static timeout(service: string, timeoutMs: number): ExternalServiceError {
    return new ExternalServiceError(
      `${service} request timed out after ${timeoutMs}ms`,
      'EXT_002',
      service,
      { timeoutMs }
    );
  }

  static rateLimited(service: string, retryAfter?: number): ExternalServiceError {
    return new ExternalServiceError(
      `Rate limited by ${service}`,
      'EXT_003',
      service,
      { retryAfter }
    );
  }
}

// ============================================================================
// File System Errors
// ============================================================================

export class FileSystemError extends DomainError {
  readonly code: ErrorCode;
  readonly httpStatus = 500;

  constructor(
    message: string,
    code: ErrorCode,
    filePath: string,
    context: DomainErrorContext = {},
    isRetryable = false
  ) {
    super(message, { ...context, filePath }, isRetryable);
    this.code = code;
  }

  static notFound(filePath: string): FileSystemError {
    return new FileSystemError(
      `File not found: ${filePath}`,
      'FILE_001',
      filePath
    );
  }

  static permissionDenied(filePath: string): FileSystemError {
    return new FileSystemError(
      `Permission denied: ${filePath}`,
      'FILE_002',
      filePath
    );
  }

  static lockFailed(filePath: string, timeout: number): FileSystemError {
    return new FileSystemError(
      `Failed to acquire lock on ${filePath} after ${timeout}ms`,
      'FILE_004',
      filePath,
      { timeout },
      true // Lock failures are retryable
    );
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Check if an error is a DomainError.
 */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/**
 * Wrap an unknown error in a DomainError if it isn't one already.
 */
export function wrapError(error: unknown, defaultMessage = 'An unexpected error occurred'): DomainError {
  if (isDomainError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : defaultMessage;
  const cause = error instanceof Error ? error : undefined;

  return new (class UnknownError extends DomainError {
    readonly code: ErrorCode = 'UNKNOWN';
    readonly httpStatus = 500;
  })(message, { cause });
}

/**
 * Extract error code from a PostgreSQL error.
 */
export function parsePgError(error: Error & { code?: string }): PersistenceError {
  const pgCode = error.code;

  if (pgCode === '23505') {
    return PersistenceError.uniqueViolation('entity', 'unknown');
  }
  if (pgCode === '23503') {
    return PersistenceError.foreignKeyViolation('entity', 'unknown');
  }
  if (pgCode?.startsWith('08')) {
    return PersistenceError.connectionError(error.message);
  }

  return new PersistenceError(
    error.message,
    'PERSIST_001',
    'query',
    { cause: error, pgCode },
    pgCode?.startsWith('08') || pgCode?.startsWith('57') // Connection or operator intervention
  );
}
