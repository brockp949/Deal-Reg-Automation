/**
 * Error Tracking Service
 *
 * Centralized error logging and tracking for file parsing and processing.
 * Provides functions to log errors, query errors, and manage error resolution.
 */

import { query } from '../db';
import logger from '../utils/logger';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type ErrorCategory = 'parsing' | 'extraction' | 'validation' | 'processing' | 'integration';
export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';
export type EntityType = 'vendor' | 'deal' | 'contact' | 'email' | 'transcript' | 'csv';

export interface ErrorLogEntry {
  id?: string;
  errorCategory: ErrorCategory;
  errorType: string;
  errorSeverity: ErrorSeverity;
  errorMessage: string;
  errorCode?: string;
  errorStack?: string;

  // Context
  sourceComponent?: string;
  sourceFileId?: string;
  entityType?: EntityType;
  entityId?: string;

  // Location
  fileName?: string;
  fileType?: string;
  lineNumber?: number;
  columnNumber?: number;
  locationContext?: string;

  // Data
  errorData?: Record<string, any>;
  inputData?: string;
  expectedFormat?: string;

  // Metadata
  userId?: string;
  sessionId?: string;
}

export interface ErrorLogRecord extends ErrorLogEntry {
  id: string;
  isResolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNotes?: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ErrorStatistics {
  errorCategory: ErrorCategory;
  errorSeverity: ErrorSeverity;
  errorType: string;
  errorCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  lastOccurred: Date;
  firstOccurred: Date;
}

// ============================================================================
// Error Logging Functions
// ============================================================================

/**
 * Log a single error
 */
export async function logError(error: ErrorLogEntry): Promise<string> {
  try {
    const result = await query(
      `INSERT INTO error_logs (
        error_category, error_type, error_severity, error_message,
        error_code, error_stack, source_component, source_file_id,
        entity_type, entity_id, file_name, file_type, line_number,
        column_number, location_context, error_data, input_data,
        expected_format, user_id, session_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id`,
      [
        error.errorCategory,
        error.errorType,
        error.errorSeverity,
        error.errorMessage,
        error.errorCode || null,
        error.errorStack || null,
        error.sourceComponent || null,
        error.sourceFileId || null,
        error.entityType || null,
        error.entityId || null,
        error.fileName || null,
        error.fileType || null,
        error.lineNumber || null,
        error.columnNumber || null,
        error.locationContext || null,
        error.errorData ? JSON.stringify(error.errorData) : null,
        error.inputData || null,
        error.expectedFormat || null,
        error.userId || null,
        error.sessionId || null,
      ]
    );

    const errorId = result.rows[0].id;

    // Log to application logger for immediate visibility
    logger.error('Error tracked', {
      errorId,
      category: error.errorCategory,
      type: error.errorType,
      severity: error.errorSeverity,
      message: error.errorMessage,
      component: error.sourceComponent,
    });

    return errorId;
  } catch (err: any) {
    // Fallback logging if database insertion fails
    logger.error('Failed to log error to database', {
      error: err.message,
      originalError: error,
    });
    throw err;
  }
}

/**
 * Log multiple errors in a batch
 */
export async function logErrors(errors: ErrorLogEntry[]): Promise<string[]> {
  const ids: string[] = [];

  for (const error of errors) {
    try {
      const id = await logError(error);
      ids.push(id);
    } catch (err: any) {
      logger.warn('Failed to log error in batch', {
        error: err.message,
        originalError: error,
      });
    }
  }

  return ids;
}

/**
 * Log a parsing error from StandardizedParserOutput
 */
export async function logParsingError(params: {
  sourceFileId: string;
  fileName: string;
  fileType: string;
  errorMessage: string;
  errorSeverity: ErrorSeverity;
  errorType?: string;
  lineNumber?: number;
  locationContext?: string;
  errorData?: Record<string, any>;
}): Promise<string> {
  return logError({
    errorCategory: 'parsing',
    errorType: params.errorType || 'parsing_error',
    errorSeverity: params.errorSeverity,
    errorMessage: params.errorMessage,
    sourceComponent: 'file_parser',
    sourceFileId: params.sourceFileId,
    fileName: params.fileName,
    fileType: params.fileType,
    lineNumber: params.lineNumber,
    locationContext: params.locationContext,
    errorData: params.errorData,
  });
}

/**
 * Log an extraction error
 */
export async function logExtractionError(params: {
  sourceFileId: string;
  fileName: string;
  entityType: EntityType;
  errorMessage: string;
  errorSeverity?: ErrorSeverity;
  inputData?: string;
  expectedFormat?: string;
}): Promise<string> {
  return logError({
    errorCategory: 'extraction',
    errorType: 'extraction_failed',
    errorSeverity: params.errorSeverity || 'error',
    errorMessage: params.errorMessage,
    sourceComponent: 'entity_extractor',
    sourceFileId: params.sourceFileId,
    fileName: params.fileName,
    entityType: params.entityType,
    inputData: params.inputData,
    expectedFormat: params.expectedFormat,
  });
}

/**
 * Log a validation error
 */
export async function logValidationError(params: {
  entityType: EntityType;
  entityId?: string;
  fieldName: string;
  fieldValue: string;
  validationRule: string;
  errorMessage: string;
  sourceFileId?: string;
}): Promise<string> {
  return logError({
    errorCategory: 'validation',
    errorType: 'validation_failed',
    errorSeverity: 'warning',
    errorMessage: params.errorMessage,
    sourceComponent: 'data_validator',
    sourceFileId: params.sourceFileId,
    entityType: params.entityType,
    entityId: params.entityId,
    errorData: {
      fieldName: params.fieldName,
      fieldValue: params.fieldValue,
      validationRule: params.validationRule,
    },
  });
}

// ============================================================================
// Error Query Functions
// ============================================================================

/**
 * Get error by ID
 */
export async function getErrorById(id: string): Promise<ErrorLogRecord | null> {
  const result = await query('SELECT * FROM error_logs WHERE id = $1', [id]);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToErrorLog(result.rows[0]);
}

/**
 * Get errors for a specific file
 */
export async function getErrorsByFile(sourceFileId: string): Promise<ErrorLogRecord[]> {
  const result = await query(
    'SELECT * FROM error_logs WHERE source_file_id = $1 ORDER BY occurred_at DESC',
    [sourceFileId]
  );

  return result.rows.map(mapRowToErrorLog);
}

/**
 * Get errors by category and severity
 */
export async function getErrorsByCategorySeverity(
  category: ErrorCategory,
  severity?: ErrorSeverity,
  limit = 100
): Promise<ErrorLogRecord[]> {
  const sql = severity
    ? 'SELECT * FROM error_logs WHERE error_category = $1 AND error_severity = $2 ORDER BY occurred_at DESC LIMIT $3'
    : 'SELECT * FROM error_logs WHERE error_category = $1 ORDER BY occurred_at DESC LIMIT $2';

  const params = severity ? [category, severity, limit] : [category, limit];

  const result = await query(sql, params);
  return result.rows.map(mapRowToErrorLog);
}

/**
 * Get unresolved errors
 */
export async function getUnresolvedErrors(limit = 100): Promise<ErrorLogRecord[]> {
  const result = await query(
    'SELECT * FROM error_logs WHERE is_resolved = false ORDER BY error_severity, occurred_at DESC LIMIT $1',
    [limit]
  );

  return result.rows.map(mapRowToErrorLog);
}

/**
 * Get recent errors (last N days)
 */
export async function getRecentErrors(days = 7, limit = 100): Promise<ErrorLogRecord[]> {
  const result = await query(
    'SELECT * FROM error_logs WHERE occurred_at >= NOW() - INTERVAL \'$1 days\' ORDER BY occurred_at DESC LIMIT $2',
    [days, limit]
  );

  return result.rows.map(mapRowToErrorLog);
}

/**
 * Get error statistics
 */
export async function getErrorStatistics(): Promise<ErrorStatistics[]> {
  const result = await query('SELECT * FROM error_statistics ORDER BY error_count DESC');

  return result.rows.map((row) => ({
    errorCategory: row.error_category,
    errorSeverity: row.error_severity,
    errorType: row.error_type,
    errorCount: parseInt(row.error_count, 10),
    resolvedCount: parseInt(row.resolved_count, 10),
    unresolvedCount: parseInt(row.unresolved_count, 10),
    lastOccurred: new Date(row.last_occurred),
    firstOccurred: new Date(row.first_occurred),
  }));
}

/**
 * Get error counts by category
 */
export async function getErrorCountsByCategory(): Promise<Record<ErrorCategory, number>> {
  const result = await query(`
    SELECT error_category, COUNT(*) as count
    FROM error_logs
    WHERE occurred_at >= NOW() - INTERVAL '30 days'
    GROUP BY error_category
  `);

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.error_category] = parseInt(row.count, 10);
  }

  return counts as Record<ErrorCategory, number>;
}

// ============================================================================
// Error Resolution Functions
// ============================================================================

/**
 * Mark error as resolved
 */
export async function resolveError(
  errorId: string,
  resolvedBy: string,
  resolutionNotes?: string
): Promise<void> {
  await query(
    'UPDATE error_logs SET is_resolved = true, resolved_at = NOW(), resolved_by = $2, resolution_notes = $3 WHERE id = $1',
    [errorId, resolvedBy, resolutionNotes || null]
  );

  logger.info('Error resolved', { errorId, resolvedBy });
}

/**
 * Bulk resolve errors by criteria
 */
export async function bulkResolveErrors(params: {
  errorType?: string;
  sourceFileId?: string;
  resolvedBy: string;
  resolutionNotes?: string;
}): Promise<number> {
  let sql = 'UPDATE error_logs SET is_resolved = true, resolved_at = NOW(), resolved_by = $1, resolution_notes = $2 WHERE is_resolved = false';
  const queryParams: any[] = [params.resolvedBy, params.resolutionNotes || null];
  let paramIndex = 3;

  if (params.errorType) {
    sql += ` AND error_type = $${paramIndex}`;
    queryParams.push(params.errorType);
    paramIndex++;
  }

  if (params.sourceFileId) {
    sql += ` AND source_file_id = $${paramIndex}`;
    queryParams.push(params.sourceFileId);
    paramIndex++;
  }

  const result = await query(sql, queryParams);

  logger.info('Bulk resolved errors', {
    count: result.rowCount,
    criteria: params,
  });

  return result.rowCount || 0;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map database row to ErrorLogRecord
 */
function mapRowToErrorLog(row: any): ErrorLogRecord {
  return {
    id: row.id,
    errorCategory: row.error_category,
    errorType: row.error_type,
    errorSeverity: row.error_severity,
    errorMessage: row.error_message,
    errorCode: row.error_code,
    errorStack: row.error_stack,
    sourceComponent: row.source_component,
    sourceFileId: row.source_file_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fileName: row.file_name,
    fileType: row.file_type,
    lineNumber: row.line_number,
    columnNumber: row.column_number,
    locationContext: row.location_context,
    errorData: row.error_data,
    inputData: row.input_data,
    expectedFormat: row.expected_format,
    isResolved: row.is_resolved,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    resolvedBy: row.resolved_by,
    resolutionNotes: row.resolution_notes,
    occurredAt: new Date(row.occurred_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    userId: row.user_id,
    sessionId: row.session_id,
  };
}

export default {
  logError,
  logErrors,
  logParsingError,
  logExtractionError,
  logValidationError,
  getErrorById,
  getErrorsByFile,
  getErrorsByCategorySeverity,
  getUnresolvedErrors,
  getRecentErrors,
  getErrorStatistics,
  getErrorCountsByCategory,
  resolveError,
  bulkResolveErrors,
};
