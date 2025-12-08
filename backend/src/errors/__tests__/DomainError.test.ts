/**
 * Domain Error Tests
 */

import {
  DomainError,
  ParsingError,
  ValidationError,
  VendorError,
  PersistenceError,
  ExternalServiceError,
  FileSystemError,
  isDomainError,
  wrapError,
  parsePgError,
} from '../DomainError';

describe('DomainError', () => {
  describe('ParsingError', () => {
    it('should create parsing error with file type', () => {
      const error = new ParsingError('Invalid format', 'mbox');

      expect(error.message).toBe('Invalid format');
      expect(error.fileType).toBe('mbox');
      expect(error.httpStatus).toBe(422);
      expect(error.isRetryable).toBe(true);
    });

    it('should create invalid format error', () => {
      const error = ParsingError.invalidFormat('csv', 'missing header');

      expect(error.message).toContain('Invalid csv format');
      expect(error.message).toContain('missing header');
    });

    it('should create file too large error', () => {
      const error = ParsingError.fileTooLarge('mbox', 1000000, 2000000);

      expect(error.message).toContain('exceeds maximum size');
      expect(error.code).toBe('PARSE_002');
    });

    it('should create unsupported type error', () => {
      const error = ParsingError.unsupportedType('xyz');

      expect(error.message).toContain('Unsupported file type');
      expect(error.code).toBe('PARSE_006');
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with issues', () => {
      const error = new ValidationError('Validation failed', [
        { field: 'name', message: 'Required' },
      ]);

      expect(error.issues).toHaveLength(1);
      expect(error.httpStatus).toBe(400);
      expect(error.isRetryable).toBe(false);
    });

    it('should create missing field error', () => {
      const error = ValidationError.missingField('vendor_name', 'deal');

      expect(error.message).toContain('Missing required field');
      expect(error.issues[0].field).toBe('vendor_name');
    });

    it('should create multiple issues error', () => {
      const error = ValidationError.multipleIssues([
        { field: 'name', message: 'Required' },
        { field: 'email', message: 'Invalid format' },
      ]);

      expect(error.issues).toHaveLength(2);
      expect(error.message).toContain('2 issue(s)');
    });
  });

  describe('VendorError', () => {
    it('should create vendor not found error', () => {
      const error = VendorError.notFound('vendor-123');

      expect(error.code).toBe('VENDOR_001');
      expect(error.httpStatus).toBe(404);
      expect(error.context.entityId).toBe('vendor-123');
    });

    it('should create approval pending error', () => {
      const error = VendorError.approvalPending('Microsoft', 'alias-456');

      expect(error.code).toBe('VENDOR_002');
      expect(error.httpStatus).toBe(409);
      expect(error.isRetryable).toBe(true);
      expect(error.context.vendorName).toBe('Microsoft');
    });

    it('should create approval denied error', () => {
      const error = VendorError.approvalDenied('Unknown Vendor');

      expect(error.code).toBe('VENDOR_003');
      expect(error.httpStatus).toBe(403);
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('PersistenceError', () => {
    it('should create connection error', () => {
      const error = PersistenceError.connectionError('timeout');

      expect(error.code).toBe('PERSIST_001');
      expect(error.isRetryable).toBe(true);
    });

    it('should create unique violation error', () => {
      const error = PersistenceError.uniqueViolation('vendor', 'email');

      expect(error.code).toBe('PERSIST_002');
      expect(error.operation).toBe('insert');
    });

    it('should create transaction failed error', () => {
      const error = PersistenceError.transactionFailed('bulk insert');

      expect(error.code).toBe('PERSIST_004');
      expect(error.isRetryable).toBe(true);
    });
  });

  describe('ExternalServiceError', () => {
    it('should create AI extraction failed error', () => {
      const error = ExternalServiceError.aiExtractionFailed('model unavailable');

      expect(error.code).toBe('EXT_001');
      expect(error.service).toBe('anthropic');
      expect(error.isRetryable).toBe(true);
    });

    it('should create rate limited error', () => {
      const error = ExternalServiceError.rateLimited('anthropic', 60);

      expect(error.code).toBe('EXT_003');
      expect(error.context.retryAfter).toBe(60);
    });
  });

  describe('FileSystemError', () => {
    it('should create file not found error', () => {
      const error = FileSystemError.notFound('/path/to/file.txt');

      expect(error.code).toBe('FILE_001');
      expect(error.context.filePath).toBe('/path/to/file.txt');
    });

    it('should create lock failed error', () => {
      const error = FileSystemError.lockFailed('/path/to/file.txt', 5000);

      expect(error.code).toBe('FILE_004');
      expect(error.isRetryable).toBe(true);
    });
  });

  describe('Utilities', () => {
    it('isDomainError should identify domain errors', () => {
      const domainError = new ParsingError('test', 'mbox');
      const regularError = new Error('test');

      expect(isDomainError(domainError)).toBe(true);
      expect(isDomainError(regularError)).toBe(false);
      expect(isDomainError(null)).toBe(false);
      expect(isDomainError('string')).toBe(false);
    });

    it('wrapError should pass through domain errors', () => {
      const original = new ParsingError('test', 'mbox');
      const wrapped = wrapError(original);

      expect(wrapped).toBe(original);
    });

    it('wrapError should wrap regular errors', () => {
      const original = new Error('test error');
      const wrapped = wrapError(original);

      expect(isDomainError(wrapped)).toBe(true);
      expect(wrapped.message).toBe('test error');
      expect(wrapped.code).toBe('UNKNOWN');
    });

    it('wrapError should handle non-error values', () => {
      const wrapped = wrapError('string error', 'Default message');

      expect(isDomainError(wrapped)).toBe(true);
      expect(wrapped.message).toBe('Default message');
    });

    it('parsePgError should handle unique constraint violation', () => {
      const pgError = Object.assign(new Error('duplicate key'), { code: '23505' });
      const wrapped = parsePgError(pgError);

      expect(wrapped.code).toBe('PERSIST_002');
    });

    it('parsePgError should handle foreign key violation', () => {
      const pgError = Object.assign(new Error('foreign key'), { code: '23503' });
      const wrapped = parsePgError(pgError);

      expect(wrapped.code).toBe('PERSIST_003');
    });

    it('parsePgError should handle connection errors', () => {
      const pgError = Object.assign(new Error('connection'), { code: '08001' });
      const wrapped = parsePgError(pgError);

      expect(wrapped.code).toBe('PERSIST_001');
      expect(wrapped.isRetryable).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('should serialize error to JSON', () => {
      const error = ParsingError.invalidFormat('mbox', 'bad header');
      const json = error.toJSON();

      expect(json.name).toBe('ParsingError');
      expect(json.code).toBeDefined();
      expect(json.message).toBeDefined();
      expect(json.httpStatus).toBe(422);
      expect(json.isRetryable).toBe(true);
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('toUserMessage', () => {
    it('should create user-friendly message', () => {
      const error = ValidationError.missingField('name');
      const message = error.toUserMessage();

      expect(message).toContain('VALID_001');
      expect(message).toContain('Missing required field');
    });
  });
});
