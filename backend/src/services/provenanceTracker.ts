/**
 * Provenance Tracker Service
 *
 * Tracks the source and extraction method for every field value in the system.
 * Enables full transparency by allowing users to see exactly where each piece
 * of data came from and how it was extracted.
 *
 * Key Features:
 * - Track source file, location, and extraction method for every field
 * - Automatic versioning when fields are updated
 * - Confidence scoring for each extraction
 * - Support for multiple extraction methods (AI, regex, manual, etc.)
 */

import { query } from '../db';
import logger from '../utils/logger';

export type EntityType = 'deal' | 'vendor' | 'contact';

export type SourceType = 'email' | 'transcript' | 'csv' | 'manual' | 'ai' | 'inference' | 'normalization';

export type ExtractionMethod = 'regex' | 'keyword' | 'ai' | 'manual' | 'inference' | 'normalization' | 'fuzzy_match' | 'domain_match';

export type ValidationStatus = 'validated' | 'unvalidated' | 'rejected' | 'corrected';

export interface ProvenanceRecord {
  entityType: EntityType;
  entityId: string;
  fieldName: string;
  fieldValue: any;
  sourceFileId?: string;
  sourceType: SourceType;
  sourceLocation?: string;
  extractionMethod: ExtractionMethod;
  confidence?: number;
  extractionContext?: Record<string, any>;
  validationStatus?: ValidationStatus;
  extractedBy?: string;
}

export interface FieldProvenance {
  id: string;
  entityType: EntityType;
  entityId: string;
  fieldName: string;
  fieldValue: string;
  sourceFileId?: string;
  sourceType: SourceType;
  sourceLocation?: string;
  extractionMethod: ExtractionMethod;
  confidence?: number;
  extractionContext?: Record<string, any>;
  validationStatus?: ValidationStatus;
  extractedAt: Date;
  extractedBy?: string;
  isCurrent: boolean;
  supersededBy?: string;
  supersededAt?: Date;
  sourceFilename?: string;
  sourceFileType?: string;
}

/**
 * Track the provenance of a field value
 */
export async function trackFieldProvenance(record: ProvenanceRecord): Promise<void> {
  try {
    await query(
      `INSERT INTO field_provenance (
        entity_type,
        entity_id,
        field_name,
        field_value,
        source_file_id,
        source_type,
        source_location,
        extraction_method,
        confidence,
        extraction_context,
        validation_status,
        extracted_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.entityType,
        record.entityId,
        record.fieldName,
        String(record.fieldValue),
        record.sourceFileId || null,
        record.sourceType,
        record.sourceLocation || null,
        record.extractionMethod,
        record.confidence || null,
        record.extractionContext ? JSON.stringify(record.extractionContext) : null,
        record.validationStatus || 'unvalidated',
        record.extractedBy || 'system',
      ]
    );

    logger.debug('Field provenance tracked', {
      entityType: record.entityType,
      entityId: record.entityId,
      fieldName: record.fieldName,
      extractionMethod: record.extractionMethod,
    });
  } catch (error: any) {
    logger.error('Failed to track field provenance', {
      error: error.message,
      record,
    });
    // Don't throw - provenance tracking should not break the main flow
  }
}

/**
 * Track provenance for multiple fields at once
 */
export async function trackMultipleFields(
  entityType: EntityType,
  entityId: string,
  fields: Record<string, any>,
  metadata: {
    sourceFileId?: string;
    sourceType: SourceType;
    sourceLocation?: string;
    extractionMethod: ExtractionMethod;
    confidence?: number;
    extractedBy?: string;
    extractionContext?: Record<string, any>;
  }
): Promise<void> {
  const promises = Object.entries(fields).map(([fieldName, fieldValue]) => {
    if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
      return Promise.resolve(); // Skip empty values
    }

    return trackFieldProvenance({
      entityType,
      entityId,
      fieldName,
      fieldValue,
      ...metadata,
    });
  });

  await Promise.all(promises);
}

/**
 * Get provenance for a specific field
 */
export async function getFieldProvenance(
  entityType: EntityType,
  entityId: string,
  fieldName: string
): Promise<FieldProvenance[]> {
  const result = await query(
    `SELECT
      fp.*,
      sf.filename as source_filename,
      sf.file_type as source_file_type
    FROM field_provenance fp
    LEFT JOIN source_files sf ON fp.source_file_id = sf.id
    WHERE
      fp.entity_type = $1
      AND fp.entity_id = $2
      AND fp.field_name = $3
    ORDER BY fp.extracted_at DESC`,
    [entityType, entityId, fieldName]
  );

  return result.rows.map(mapProvenanceRow);
}

/**
 * Get current (non-superseded) provenance for all fields of an entity
 */
export async function getCurrentProvenance(
  entityType: EntityType,
  entityId: string
): Promise<Map<string, FieldProvenance>> {
  const result = await query(
    `SELECT *
    FROM current_field_provenance
    WHERE
      entity_type = $1
      AND entity_id = $2
    ORDER BY field_name`,
    [entityType, entityId]
  );

  const provenanceMap = new Map<string, FieldProvenance>();
  result.rows.forEach((row) => {
    const provenance = mapProvenanceRow(row);
    provenanceMap.set(provenance.fieldName, provenance);
  });

  return provenanceMap;
}

/**
 * Get provenance history for an entity (all fields, all versions)
 */
export async function getProvenanceHistory(
  entityType: EntityType,
  entityId: string
): Promise<FieldProvenance[]> {
  const result = await query(
    `SELECT
      fp.*,
      sf.filename as source_filename,
      sf.file_type as source_file_type
    FROM field_provenance fp
    LEFT JOIN source_files sf ON fp.source_file_id = sf.id
    WHERE
      fp.entity_type = $1
      AND fp.entity_id = $2
    ORDER BY fp.field_name, fp.extracted_at DESC`,
    [entityType, entityId]
  );

  return result.rows.map(mapProvenanceRow);
}

/**
 * Get provenance statistics for a source file
 */
export async function getSourceFileProvenanceStats(sourceFileId: string): Promise<{
  totalFields: number;
  byEntityType: Record<string, number>;
  byExtractionMethod: Record<string, number>;
  avgConfidence: number;
}> {
  const result = await query(
    `SELECT
      entity_type,
      extraction_method,
      COUNT(*) as count,
      AVG(confidence) as avg_confidence
    FROM field_provenance
    WHERE source_file_id = $1 AND is_current = true
    GROUP BY entity_type, extraction_method`,
    [sourceFileId]
  );

  const byEntityType: Record<string, number> = {};
  const byExtractionMethod: Record<string, number> = {};
  let totalFields = 0;
  let totalConfidence = 0;
  let confidenceCount = 0;

  result.rows.forEach((row) => {
    const count = parseInt(row.count);
    totalFields += count;

    byEntityType[row.entity_type] = (byEntityType[row.entity_type] || 0) + count;
    byExtractionMethod[row.extraction_method] = (byExtractionMethod[row.extraction_method] || 0) + count;

    if (row.avg_confidence) {
      totalConfidence += parseFloat(row.avg_confidence) * count;
      confidenceCount += count;
    }
  });

  return {
    totalFields,
    byEntityType,
    byExtractionMethod,
    avgConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
  };
}

/**
 * Update validation status for a field's provenance
 */
export async function updateValidationStatus(
  entityType: EntityType,
  entityId: string,
  fieldName: string,
  validationStatus: ValidationStatus
): Promise<void> {
  await query(
    `UPDATE field_provenance
    SET validation_status = $1
    WHERE
      entity_type = $2
      AND entity_id = $3
      AND field_name = $4
      AND is_current = true`,
    [validationStatus, entityType, entityId, fieldName]
  );
}

/**
 * Helper to map database row to FieldProvenance object
 */
function mapProvenanceRow(row: any): FieldProvenance {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fieldName: row.field_name,
    fieldValue: row.field_value,
    sourceFileId: row.source_file_id,
    sourceType: row.source_type,
    sourceLocation: row.source_location,
    extractionMethod: row.extraction_method,
    confidence: row.confidence ? parseFloat(row.confidence) : undefined,
    extractionContext: row.extraction_context,
    validationStatus: row.validation_status,
    extractedAt: row.extracted_at,
    extractedBy: row.extracted_by,
    isCurrent: row.is_current,
    supersededBy: row.superseded_by,
    supersededAt: row.superseded_at,
    sourceFilename: row.source_filename,
    sourceFileType: row.source_file_type,
  };
}

/**
 * Helper function to track provenance for a deal
 */
export async function trackDealProvenance(
  dealId: string,
  dealData: Record<string, any>,
  metadata: {
    sourceFileId?: string;
    sourceType: SourceType;
    sourceLocation?: string;
    extractionMethod: ExtractionMethod;
    confidence?: number;
    extractionContext?: Record<string, any>;
  }
): Promise<void> {
  await trackMultipleFields('deal', dealId, dealData, metadata);
}

/**
 * Helper function to track provenance for a vendor
 */
export async function trackVendorProvenance(
  vendorId: string,
  vendorData: Record<string, any>,
  metadata: {
    sourceFileId?: string;
    sourceType: SourceType;
    sourceLocation?: string;
    extractionMethod: ExtractionMethod;
    confidence?: number;
    extractionContext?: Record<string, any>;
  }
): Promise<void> {
  await trackMultipleFields('vendor', vendorId, vendorData, metadata);
}

/**
 * Helper function to track provenance for a contact
 */
export async function trackContactProvenance(
  contactId: string,
  contactData: Record<string, any>,
  metadata: {
    sourceFileId?: string;
    sourceType: SourceType;
    sourceLocation?: string;
    extractionMethod: ExtractionMethod;
    confidence?: number;
    extractionContext?: Record<string, any>;
  }
): Promise<void> {
  await trackMultipleFields('contact', contactId, contactData, metadata);
}
