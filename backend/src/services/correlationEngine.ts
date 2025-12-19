import { query } from '../db';
import logger from '../utils/logger';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface EntityRelationshipGraph {
  primaryEntity: any;
  relatedVendors: any[];
  relatedContacts: any[];
  relatedDeals: any[];
  sourceFiles: SourceFile[];
  relationshipStrength: Map<string, number>;
}

export interface SourceFile {
  id: string;
  fileName: string;
  fileType: string;
  uploadedAt: Date;
  processedAt?: Date;
}

export interface CorrelationMap {
  dealId: string;
  dealName: string;
  sources: Array<{
    fileId: string;
    fileName: string;
    extractedAt: Date;
    confidence: number;
  }>;
  vendorCorrelations: VendorCorrelation[];
  contactCorrelations: ContactCorrelation[];
  fieldProvenance: Map<string, FieldProvenance[]>;
}

export interface VendorCorrelation {
  vendorId: string;
  vendorName: string;
  sourceFiles: string[];
  confidence: number;
  matchStrategy: string;
}

export interface ContactCorrelation {
  contactId: string;
  contactName: string;
  email?: string;
  sourceFiles: string[];
  confidence: number;
}

export interface FieldProvenance {
  fieldName: string;
  value: any;
  sourceFileId: string;
  extractionMethod: string;
  confidence: number;
  extractedAt: Date;
}

export interface DataLineage {
  entityId: string;
  entityType: 'deal' | 'vendor' | 'contact';
  fieldName?: string;
  history: LineageEntry[];
  currentValue: any;
  sourceCount: number;
}

export interface LineageEntry {
  value: any;
  sourceFileId: string;
  sourceFileName: string;
  extractionMethod: string;
  extractedAt: Date;
  confidence: number;
  wasModified: boolean;
  modifiedBy?: string;
  modifiedAt?: Date;
}

export interface ReconciledEntity {
  entityId: string;
  entityType: 'deal' | 'vendor' | 'contact';
  isPrimary: boolean;
  correlationKey: string;
  correlatedEntities: string[];
  sourceFiles: string[];
  mergedData: any;
  confidence: number;
  reconciliationDate: Date;
}

export interface EntityKey {
  type: 'deal' | 'vendor' | 'contact';
  key: string; // Unique identifier (e.g., "customer:vendor:value")
}

// ============================================================================
// Correlation Key Generation
// ============================================================================

/**
 * Generate correlation key for a deal
 */
function generateDealCorrelationKey(deal: any): string {
  const normalizeString = (str: string) =>
    str.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');

  const parts = [
    normalizeString(deal.customer_name || deal.customerName || ''),
    normalizeString(deal.vendor_name || deal.vendorName || ''),
    Math.round((deal.deal_value || deal.dealValue || 0) / 1000) // Round to nearest $1000
  ];

  return parts.filter(Boolean).join(':');
}

/**
 * Generate correlation key for a vendor
 */
function generateVendorCorrelationKey(vendor: any): string {
  const normalizeString = (str: string) =>
    str.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');

  return normalizeString(vendor.vendor_name || vendor.vendorName || vendor.normalized_name || '');
}

/**
 * Generate correlation key for a contact
 */
function generateContactCorrelationKey(contact: any): string {
  const email = contact.email?.toLowerCase().trim() || '';
  if (email) return `email:${email}`;

  const normalizeString = (str: string) =>
    str.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');

  return `name:${normalizeString(contact.name || contact.contact_name || '')}`;
}

// ============================================================================
// Entity Relationship Functions
// ============================================================================

/**
 * Find related entities across sources for a given entity
 */
export async function findRelatedEntities(
  entityId: string,
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<EntityRelationshipGraph> {
  try {
    // Get primary entity
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;
    const primaryResult = await query(
      `SELECT * FROM ${tableName} WHERE id = $1`,
      [entityId]
    );

    if (primaryResult.rows.length === 0) {
      throw new Error(`Entity ${entityId} not found`);
    }

    const primaryEntity = primaryResult.rows[0];

    // Get source files
    const sourceFileIds = primaryEntity.source_file_ids || [];
    const sourceFiles: SourceFile[] = [];

    if (sourceFileIds.length > 0) {
      const filesResult = await query(
        `SELECT id, filename as "fileName", file_type as "fileType",
                upload_date as "uploadedAt", processing_completed_at as "processedAt"
         FROM source_files
         WHERE id::text = ANY($1::text[])`,
        [sourceFileIds]
      );
      sourceFiles.push(...filesResult.rows);
    }

    // For deals, find related vendors and contacts
    let relatedVendors: any[] = [];
    let relatedContacts: any[] = [];
    let relatedDeals: any[] = [];

    if (entityType === 'deal') {
      // Get vendor
      if (primaryEntity.vendor_id) {
        const vendorResult = await query(
          'SELECT * FROM vendors WHERE id = $1',
          [primaryEntity.vendor_id]
        );
        if (vendorResult.rows.length > 0) {
          relatedVendors.push(vendorResult.rows[0]);
        }
      }

      // Get contacts from deal_contacts
      const contactsResult = await query(
        `SELECT c.* FROM contacts c
         JOIN deal_contacts dc ON c.id = dc.contact_id
         WHERE dc.deal_id = $1`,
        [entityId]
      );
      relatedContacts = contactsResult.rows;

      // Find related deals (same customer or vendor)
      const relatedDealsResult = await query(
        `SELECT * FROM deal_registrations
         WHERE id != $1
           AND (customer_name = $2 OR vendor_id = $3)
         LIMIT 10`,
        [entityId, primaryEntity.customer_name, primaryEntity.vendor_id]
      );
      relatedDeals = relatedDealsResult.rows;

    } else if (entityType === 'vendor') {
      // Get deals for this vendor
      const dealsResult = await query(
        'SELECT * FROM deal_registrations WHERE vendor_id = $1 LIMIT 20',
        [entityId]
      );
      relatedDeals = dealsResult.rows;

      // Get contacts associated with vendor deals
      const contactsResult = await query(
        `SELECT DISTINCT c.* FROM contacts c
         JOIN deal_contacts dc ON c.id = dc.contact_id
         JOIN deal_registrations d ON dc.deal_id = d.id
         WHERE d.vendor_id = $1
         LIMIT 20`,
        [entityId]
      );
      relatedContacts = contactsResult.rows;

    } else if (entityType === 'contact') {
      // Get deals for this contact
      const dealsResult = await query(
        `SELECT d.* FROM deal_registrations d
         JOIN deal_contacts dc ON d.id = dc.deal_id
         WHERE dc.contact_id = $1
         LIMIT 20`,
        [entityId]
      );
      relatedDeals = dealsResult.rows;

      // Get unique vendors from those deals
      const vendorIds = [...new Set(relatedDeals.map(d => d.vendor_id).filter(Boolean))];
      if (vendorIds.length > 0) {
        const vendorsResult = await query(
          'SELECT * FROM vendors WHERE id = ANY($1::uuid[])',
          [vendorIds]
        );
        relatedVendors = vendorsResult.rows;
      }
    }

    // Calculate relationship strengths
    const relationshipStrength = new Map<string, number>();

    // Simple strength calculation based on co-occurrence
    relatedVendors.forEach(v => relationshipStrength.set(`vendor:${v.id}`, 0.9));
    relatedContacts.forEach(c => relationshipStrength.set(`contact:${c.id}`, 0.8));
    relatedDeals.forEach(d => relationshipStrength.set(`deal:${d.id}`, 0.7));

    logger.info('Related entities found', {
      entityId,
      entityType,
      vendors: relatedVendors.length,
      contacts: relatedContacts.length,
      deals: relatedDeals.length,
      sourceFiles: sourceFiles.length
    });

    return {
      primaryEntity,
      relatedVendors,
      relatedContacts,
      relatedDeals,
      sourceFiles,
      relationshipStrength
    };

  } catch (error: any) {
    logger.error('Failed to find related entities', { error: error.message, entityId });
    throw error;
  }
}

/**
 * Build correlation map for a deal
 */
export async function buildDealCorrelationMap(dealId: string): Promise<CorrelationMap> {
  try {
    // Get deal
    const dealResult = await query(
      `SELECT d.*, v.vendor_name
       FROM deal_registrations d
       LEFT JOIN vendors v ON d.vendor_id = v.id
       WHERE d.id = $1`,
      [dealId]
    );

    if (dealResult.rows.length === 0) {
      throw new Error(`Deal ${dealId} not found`);
    }

    const deal = dealResult.rows[0];

    // Get source file information
    const sourceFileIds = deal.source_file_ids || [];
    const sources: Array<{
      fileId: string;
      fileName: string;
      extractedAt: Date;
      confidence: number;
    }> = [];

    if (sourceFileIds.length > 0) {
      const filesResult = await query(
        `SELECT sf.id, sf.filename, sf.upload_date,
                ee.ai_confidence_score
         FROM source_files sf
         LEFT JOIN extracted_entities ee ON ee.source_file_id = sf.id AND ee.entity_id = $1
         WHERE sf.id::text = ANY($2::text[])`,
        [dealId, sourceFileIds]
      );

      sources.push(
        ...filesResult.rows.map(row => ({
          fileId: row.id,
          fileName: row.filename,
          extractedAt: row.upload_date,
          confidence: row.ai_confidence_score || 0.5
        }))
      );
    }

    // Get vendor correlations
    const vendorCorrelations: VendorCorrelation[] = [];
    if (deal.vendor_id) {
      const vendorResult = await query(
        'SELECT * FROM vendors WHERE id = $1',
        [deal.vendor_id]
      );

      if (vendorResult.rows.length > 0) {
        const vendor = vendorResult.rows[0];
        vendorCorrelations.push({
          vendorId: vendor.id,
          vendorName: vendor.vendor_name,
          sourceFiles: vendor.source_file_ids || [],
          confidence: 0.95,
          matchStrategy: 'direct_association'
        });
      }
    }

    // Get contact correlations
    const contactsResult = await query(
      `SELECT c.*, dc.role
       FROM contacts c
       JOIN deal_contacts dc ON c.id = dc.contact_id
       WHERE dc.deal_id = $1`,
      [dealId]
    );

    const contactCorrelations: ContactCorrelation[] = contactsResult.rows.map(contact => ({
      contactId: contact.id,
      contactName: contact.name,
      email: contact.email,
      sourceFiles: contact.source_file_ids || [],
      confidence: 0.9
    }));

    // Get field provenance
    const provenanceResult = await query(
      `SELECT field_name, source_file_id, extraction_method,
              confidence, extracted_at, raw_value
       FROM field_provenance
       WHERE entity_type = 'deal' AND entity_id = $1
       ORDER BY field_name, extracted_at DESC`,
      [dealId]
    );

    const fieldProvenance = new Map<string, FieldProvenance[]>();
    provenanceResult.rows.forEach(row => {
      const fieldName = row.field_name;
      if (!fieldProvenance.has(fieldName)) {
        fieldProvenance.set(fieldName, []);
      }

      fieldProvenance.get(fieldName)!.push({
        fieldName: row.field_name,
        value: row.raw_value,
        sourceFileId: row.source_file_id,
        extractionMethod: row.extraction_method,
        confidence: row.confidence,
        extractedAt: row.extracted_at
      });
    });

    logger.info('Deal correlation map built', {
      dealId,
      sources: sources.length,
      vendors: vendorCorrelations.length,
      contacts: contactCorrelations.length,
      fieldsWithProvenance: fieldProvenance.size
    });

    return {
      dealId,
      dealName: deal.deal_name,
      sources,
      vendorCorrelations,
      contactCorrelations,
      fieldProvenance
    };

  } catch (error: any) {
    logger.error('Failed to build correlation map', { error: error.message, dealId });
    throw error;
  }
}

/**
 * Get complete data lineage for an entity
 */
export async function getDataLineage(
  entityId: string,
  fieldName?: string,
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<DataLineage[]> {
  try {
    // Get current entity
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;
    const entityResult = await query(
      `SELECT * FROM ${tableName} WHERE id = $1`,
      [entityId]
    );

    if (entityResult.rows.length === 0) {
      throw new Error(`Entity ${entityId} not found`);
    }

    const entity = entityResult.rows[0];

    // Get field provenance
    let provenanceQuery = `
      SELECT fp.*, sf.filename as "sourceFileName"
      FROM field_provenance fp
      LEFT JOIN source_files sf ON fp.source_file_id = sf.id
      WHERE fp.entity_type = $1 AND fp.entity_id = $2
    `;
    const params: any[] = [entityType, entityId];

    if (fieldName) {
      provenanceQuery += ' AND fp.field_name = $3';
      params.push(fieldName);
    }

    provenanceQuery += ' ORDER BY fp.field_name, fp.extracted_at DESC';

    const provenanceResult = await query(provenanceQuery, params);

    // Group by field name
    const lineageByField = new Map<string, LineageEntry[]>();

    provenanceResult.rows.forEach(row => {
      const field = row.field_name;
      if (!lineageByField.has(field)) {
        lineageByField.set(field, []);
      }

      lineageByField.get(field)!.push({
        value: row.raw_value,
        sourceFileId: row.source_file_id,
        sourceFileName: row.sourceFileName || 'Unknown',
        extractionMethod: row.extraction_method,
        extractedAt: row.extracted_at,
        confidence: row.confidence,
        wasModified: row.was_modified || false,
        modifiedBy: row.modified_by,
        modifiedAt: row.modified_at
      });
    });

    // Build lineage objects
    const lineages: DataLineage[] = [];
    lineageByField.forEach((history, field) => {
      lineages.push({
        entityId,
        entityType,
        fieldName: field,
        history,
        currentValue: entity[field] || entity[field.replace(/_/g, '')], // Try both snake_case and camelCase
        sourceCount: new Set(history.map(h => h.sourceFileId)).size
      });
    });

    logger.info('Data lineage retrieved', {
      entityId,
      entityType,
      fieldName: fieldName || 'all',
      fieldsWithLineage: lineages.length
    });

    return lineages;

  } catch (error: any) {
    logger.error('Failed to get data lineage', { error: error.message, entityId });
    throw error;
  }
}

/**
 * Reconcile entity across multiple sources
 */
export async function reconcileEntityAcrossSources(
  entityKey: EntityKey,
  sourceFileIds: string[]
): Promise<ReconciledEntity | null> {
  try {
    const { type, key } = entityKey;

    // Find entities with matching correlation key across sources
    const tableName = type === 'deal' ? 'deal_registrations' : `${type}s`;

    const result = await query(
      `SELECT * FROM ${tableName}
       WHERE correlation_key = $1
         AND source_file_ids && $2::text[]
       ORDER BY is_primary_record DESC, updated_at DESC`,
      [key, sourceFileIds]
    );

    if (result.rows.length === 0) {
      logger.info('No entities found for reconciliation', { entityKey, sourceFileIds });
      return null;
    }

    // Select primary entity (or first one if none marked as primary)
    const primaryEntity = result.rows.find(e => e.is_primary_record) || result.rows[0];
    const allEntities = result.rows;

    // Collect all source files
    const allSourceFiles = new Set<string>();
    allEntities.forEach(e => {
      if (e.source_file_ids) {
        e.source_file_ids.forEach((id: string) => allSourceFiles.add(id));
      }
    });

    // Merge data from all sources (prefer validated, complete, recent)
    const mergedData = { ...primaryEntity };
    allEntities.forEach(entity => {
      Object.keys(entity).forEach(field => {
        if (!mergedData[field] && entity[field]) {
          mergedData[field] = entity[field]; // Fill in missing fields
        }
      });
    });

    // Calculate confidence based on source agreement
    const confidence = allEntities.length > 1 ? 0.9 : 0.7;

    logger.info('Entity reconciled across sources', {
      entityKey,
      primaryEntityId: primaryEntity.id,
      entitiesFound: allEntities.length,
      sourceFiles: allSourceFiles.size
    });

    return {
      entityId: primaryEntity.id,
      entityType: type,
      isPrimary: primaryEntity.is_primary_record,
      correlationKey: key,
      correlatedEntities: allEntities.map(e => e.id),
      sourceFiles: Array.from(allSourceFiles),
      mergedData,
      confidence,
      reconciliationDate: new Date()
    };

  } catch (error: any) {
    logger.error('Failed to reconcile entity', { error: error.message, entityKey });
    throw error;
  }
}

/**
 * Update entity correlation keys
 */
export async function updateCorrelationKeys(
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<{ updated: number; errors: number }> {
  try {
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;

    // Get all entities
    const result = await query(`SELECT * FROM ${tableName} WHERE correlation_key IS NULL`);
    const entities = result.rows;

    let updated = 0;
    let errors = 0;

    for (const entity of entities) {
      try {
        let correlationKey: string;

        if (entityType === 'deal') {
          correlationKey = generateDealCorrelationKey(entity);
        } else if (entityType === 'vendor') {
          correlationKey = generateVendorCorrelationKey(entity);
        } else {
          correlationKey = generateContactCorrelationKey(entity);
        }

        if (correlationKey) {
          await query(
            `UPDATE ${tableName} SET correlation_key = $1 WHERE id = $2`,
            [correlationKey, entity.id]
          );
          updated++;
        }
      } catch (error: any) {
        logger.warn('Failed to update correlation key', {
          entityId: entity.id,
          error: error.message
        });
        errors++;
      }
    }

    logger.info('Correlation keys updated', {
      entityType,
      totalEntities: entities.length,
      updated,
      errors
    });

    return { updated, errors };

  } catch (error: any) {
    logger.error('Failed to update correlation keys', { error: error.message, entityType });
    throw error;
  }
}

/**
 * Find cross-source duplicates using correlation keys
 */
export async function findCrossSourceDuplicates(
  sourceFileIds: string[],
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<Array<{ correlationKey: string; entities: any[] }>> {
  try {
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;

    // Find entities with same correlation key but different source files
    const result = await query(
      `SELECT correlation_key, array_agg(id) as entity_ids, COUNT(*) as count
       FROM ${tableName}
       WHERE correlation_key IS NOT NULL
         AND source_file_ids && $1::text[]
       GROUP BY correlation_key
       HAVING COUNT(*) > 1
       ORDER BY COUNT(*) DESC`,
      [sourceFileIds]
    );

    const duplicates: Array<{ correlationKey: string; entities: any[] }> = [];

    for (const row of result.rows) {
      const entitiesResult = await query(
        `SELECT * FROM ${tableName} WHERE id = ANY($1::uuid[])`,
        [row.entity_ids]
      );

      duplicates.push({
        correlationKey: row.correlation_key,
        entities: entitiesResult.rows
      });
    }

    logger.info('Cross-source duplicates found', {
      sourceFiles: sourceFileIds.length,
      entityType,
      duplicateGroups: duplicates.length
    });

    return duplicates;

  } catch (error: any) {
    logger.error('Failed to find cross-source duplicates', { error: error.message });
    throw error;
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  findRelatedEntities,
  buildDealCorrelationMap,
  getDataLineage,
  reconcileEntityAcrossSources,
  updateCorrelationKeys,
  findCrossSourceDuplicates,
  generateDealCorrelationKey,
  generateVendorCorrelationKey,
  generateContactCorrelationKey
};
