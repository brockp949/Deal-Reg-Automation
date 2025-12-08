/**
 * Error Module
 * Exports all domain error types and utilities.
 */

// Domain Error types
export {
  DomainError,
  DomainErrorContext,
  ErrorCode,
  ParsingError,
  ValidationError,
  ValidationIssue,
  VendorError,
  PersistenceError,
  ExternalServiceError,
  FileSystemError,
  isDomainError,
  wrapError,
  parsePgError,
} from './DomainError';

// Legacy error types (for backward compatibility)
export { VendorApprovalPendingError, VendorApprovalDeniedError } from './vendorApprovalErrors';
