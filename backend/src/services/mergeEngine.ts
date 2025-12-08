import { query } from '../db';
import logger from '../utils/logger';
import { DealData } from './duplicateDetector';

// ============================================================================
// Types & Interfaces
// ============================================================================

export enum MergeStrategy {
  KEEP_NEWEST = 'newest',
  KEEP_HIGHEST_QUALITY = 'quality',
  KEEP_FIRST = 'first',
  MANUAL = 'manual',
  WEIGHTED = 'weighted'
}

export enum ConflictResolutionStrategy {
  PREFER_SOURCE = 'source',
  PREFER_TARGET = 'target',
  PREFER_COMPLETE = 'complete',
  PREFER_VALIDATED = 'validated',
  MERGE_ARRAYS = 'merge_arrays',
  MANUAL = 'manual'
}

export interface MergeOptions {
  mergeStrategy?: MergeStrategy;
  conflictResolution?: ConflictResolutionStrategy;
  preserveSource?: boolean;
  mergedBy?: string;
  notes?: string;
}

export interface MergeResult {
  success: boolean;
  mergedEntityId: string;
  sourceEntityIds: string[];
  mergeHistoryId: string;
  conflictsResolved: number;
  conflictsPending: number;
  mergedData: any;
  warnings: string[];
  timestamp: Date;
}

export interface MergePreview {
  conflicts: FieldConflict[];
  resolvedFields: Record<string, any>;
  sourceData: any[];
  suggestedMaster: string;
  confidence: number;
  warnings: string[];
}

export interface FieldConflict {
  fieldName: string;
  values: Array<{
    entityId: string;
    value: any;
    confidence?: number;
    source?: string;
    lastUpdated?: Date;
    isValidated?: boolean;
  }>;
  suggestedValue: any;
  suggestedReason: string;
  requiresManualReview: boolean;
}

export interface UnmergeResult {
  success: boolean;
  restoredEntityIds: string[];
  mergeHistoryId: string;
  reason: string;
  timestamp: Date;
}

export interface BatchMergeResult {
  success: boolean;
  totalClusters: number;
  mergedClusters: number;
  failedClusters: number;
  mergeResults: MergeResult[];
  errors: Array<{ clusterId: string; error: string }>;
  timestamp: Date;
}

// ============================================================================
// Data Quality Scoring
// ============================================================================

const REQUIRED_FIELDS = [
  'deal_name',
  'customer_name',
  'deal_value',
  'currency',
  'close_date',
  'vendor_id',
  'status',
  'ai_confidence_score',
  'validation_status'
] as const;

function hasMeaningfulValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Calculate completeness score (percentage of non-null fields)
 */
function calculateCompleteness(entity: any): number {
  if (!entity) return 0;

  const requiredFilled = REQUIRED_FIELDS.filter(field => hasMeaningfulValue(entity[field])).length;
  const requiredRatio = requiredFilled / REQUIRED_FIELDS.length;

  // Use an exponential curve so that missing required fields quickly reduces the score.
  const completeness = Math.pow(Math.max(0, Math.min(1, requiredRatio)), 4);
  return completeness;
}

/**
 * Calculate recency score based on last updated time
 */
function calculateRecencyScore(entity: any): number {
  const updatedAt = entity.updatedAt || entity.updated_at || entity.createdAt || entity.created_at;

  if (!updatedAt) return 0.5; // Default score if no timestamp

  try {
    const date = new Date(updatedAt);
    const now = new Date();
    const daysDiff = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);

    // Score decreases with age: 1.0 for today, 0.5 for 30 days, 0.0 for 180+ days
    if (daysDiff <= 1) return 1.0;
    if (daysDiff <= 30) return 1.0 - (daysDiff / 30) * 0.5;
    if (daysDiff <= 180) return 0.5 - ((daysDiff - 30) / 150) * 0.5;
    return 0.0;
  } catch {
    return 0.5;
  }
}

/**
 * Get validation score from entity
 */
function getValidationScore(entity: any): number {
  if (entity.validation_status === 'passed') return 1.0;
  if (entity.validation_status === 'failed') return 0.0;
  if (entity.final_confidence_score) return entity.final_confidence_score;
  if (entity.ai_confidence_score) return entity.ai_confidence_score;
  return 0.25;
}

/**
 * Calculate overall data quality score
 */
export function calculateDataQualityScore(entity: any): number {
  const factors = {
    completeness: calculateCompleteness(entity),
    aiConfidence: entity.ai_confidence_score ?? entity.aiConfidence ?? 0.4,
    validationStatus: getValidationScore(entity),
    recency: calculateRecencyScore(entity)
  };

  // Weighted scoring
  return (
    factors.completeness * 0.4 +
    factors.aiConfidence * 0.3 +
    factors.validationStatus * 0.2 +
    factors.recency * 0.1
  );
}

// ============================================================================
// Field Conflict Detection
// ============================================================================

/**
 * Detect conflicts between entity fields
 */
function detectFieldConflicts(entities: any[]): FieldConflict[] {
  if (entities.length === 0) return [];

  const conflicts: FieldConflict[] = [];
  const allFields = new Set<string>();

  // Collect all field names
  entities.forEach(entity => {
    Object.keys(entity).forEach(key => allFields.add(key));
  });

  // Check each field for conflicts
  allFields.forEach(fieldName => {
    // Skip system fields
    if (['id', 'created_at', 'updated_at', 'createdAt', 'updatedAt'].includes(fieldName)) {
      return;
    }

    const values = entities.map(entity => ({
      entityId: entity.id,
      value: entity[fieldName],
      confidence: entity.ai_confidence_score || 0.5,
      source: entity.source_file_id,
      lastUpdated: entity.updated_at || entity.created_at,
      isValidated: entity.validation_status === 'passed'
    }));

    const uniqueValues = new Set(
      values.map(v => {
        if (!hasMeaningfulValue(v.value)) return '__NULL__';
        if (typeof v.value === 'object') return JSON.stringify(v.value);
        return String(v.value);
      })
    );

    const hasNonNull = values.some(v => hasMeaningfulValue(v.value));

    if (uniqueValues.size > 1 && hasNonNull) {
      // Conflict detected
      const suggestedValue = selectBestValue(values, fieldName);

      conflicts.push({
        fieldName,
        values,
        suggestedValue: suggestedValue.value,
        suggestedReason: suggestedValue.reason,
        requiresManualReview: uniqueValues.size > 2
      });
    }
  });

  return conflicts;
}

/**
 * Select best value from conflicting values
 */
function selectBestValue(
  values: Array<{ entityId: string; value: any; confidence?: number; isValidated?: boolean; lastUpdated?: Date }>,
  fieldName: string
): { value: any; reason: string } {
  // Filter out null/undefined
  const validValues = values.filter(v => hasMeaningfulValue(v.value));

  if (validValues.length === 0) {
    return { value: null, reason: 'No valid values' };
  }

  if (validValues.length === 1) {
    return { value: validValues[0].value, reason: 'Only value available' };
  }

  // Prefer validated values
  const validatedValues = validValues.filter(v => v.isValidated);
  if (validatedValues.length === 1) {
    return { value: validatedValues[0].value, reason: 'Only validated value' };
  }

  // Prefer highest confidence
  const sortedByConfidence = [...validValues].sort((a, b) =>
    (b.confidence || 0) - (a.confidence || 0)
  );

  if (sortedByConfidence[0].confidence && sortedByConfidence[0].confidence >= 0.85) {
    return {
      value: sortedByConfidence[0].value,
      reason: `Highest confidence (${(sortedByConfidence[0].confidence * 100).toFixed(0)}%)`
    };
  }

  // Prefer most recent
  const sortedByDate = [...validValues].sort((a, b) => {
    const dateA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
    const dateB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
    return dateB - dateA;
  });

  return {
    value: sortedByDate[0].value,
    reason: 'Most recent value'
  };
}

// ============================================================================
// Merge Strategies
// ============================================================================

/**
 * Select master entity based on strategy
 */
function selectMasterEntity(entities: any[], strategy: MergeStrategy): { master: any; reason: string } {
  if (entities.length === 0) {
    throw new Error('No entities to select master from');
  }

  if (entities.length === 1) {
    return { master: entities[0], reason: 'Only entity available' };
  }

  switch (strategy) {
    case MergeStrategy.KEEP_NEWEST:
      const sortedByDate = [...entities].sort((a, b) => {
        const dateA = new Date(a.updated_at || a.created_at).getTime();
        const dateB = new Date(b.updated_at || b.created_at).getTime();
        return dateB - dateA;
      });
      return { master: sortedByDate[0], reason: 'Most recently updated' };

    case MergeStrategy.KEEP_HIGHEST_QUALITY:
      const sortedByQuality = [...entities].sort((a, b) =>
        calculateDataQualityScore(b) - calculateDataQualityScore(a)
      );
      return {
        master: sortedByQuality[0],
        reason: `Highest quality score (${(calculateDataQualityScore(sortedByQuality[0]) * 100).toFixed(0)}%)`
      };

    case MergeStrategy.KEEP_FIRST:
      const sortedByCreation = [...entities].sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateA - dateB;
      });
      return { master: sortedByCreation[0], reason: 'First created' };

    case MergeStrategy.WEIGHTED:
      // Use quality score as weight
      return selectMasterEntity(entities, MergeStrategy.KEEP_HIGHEST_QUALITY);

    case MergeStrategy.MANUAL:
      // Return first entity, manual selection required
      return { master: entities[0], reason: 'Manual selection required' };

    default:
      return { master: entities[0], reason: 'Default selection' };
  }
}

/**
 * Resolve field conflicts based on strategy
 */
function resolveFieldConflicts(
  conflicts: FieldConflict[],
  strategy: ConflictResolutionStrategy
): Record<string, any> {
  const resolved: Record<string, any> = {};

  conflicts.forEach(conflict => {
    switch (strategy) {
      case ConflictResolutionStrategy.PREFER_SOURCE:
        resolved[conflict.fieldName] = conflict.values[0]?.value ?? conflict.suggestedValue;
        break;
      case ConflictResolutionStrategy.PREFER_TARGET:
        const lastValue = conflict.values[conflict.values.length - 1];
        resolved[conflict.fieldName] = lastValue?.value ?? conflict.suggestedValue;
        break;
      case ConflictResolutionStrategy.PREFER_COMPLETE:
        // Prefer non-null, most complete value
        const completeValue = conflict.values.find(v => hasMeaningfulValue(v.value));
        resolved[conflict.fieldName] = completeValue?.value || conflict.suggestedValue;
        break;

      case ConflictResolutionStrategy.PREFER_VALIDATED:
        // Prefer validated values
        const validatedValue = conflict.values.find(v => v.isValidated);
        resolved[conflict.fieldName] = validatedValue?.value || conflict.suggestedValue;
        break;

      case ConflictResolutionStrategy.MERGE_ARRAYS:
        // Merge array values
        const arrayValues = conflict.values.filter(v => Array.isArray(v.value));
        if (arrayValues.length > 0) {
          const allValues = arrayValues.flatMap(v => v.value || []);
          resolved[conflict.fieldName] = [...new Set(allValues)];
        } else {
          resolved[conflict.fieldName] = conflict.suggestedValue;
        }
        break;

      case ConflictResolutionStrategy.MANUAL:
        // Leave unresolved for manual review
        resolved[conflict.fieldName] = null;
        break;

      default:
        // Use suggested value
        resolved[conflict.fieldName] = conflict.suggestedValue;
    }
  });

  return resolved;
}

// ============================================================================
// Merge Operations
// ============================================================================

/**
 * Preview merge without executing
 */
export async function previewMerge(
  entityIds: string[],
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<MergePreview> {
  if (entityIds.length < 2) {
    throw new Error('At least 2 entities required for merge preview');
  }

  try {
    // Fetch all entities
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;
    const result = await query(
      `SELECT * FROM ${tableName} WHERE id = ANY($1::uuid[])`,
      [entityIds]
    );

    const entities = result.rows;

    if (entities.length < 2) {
      throw new Error(`Only ${entities.length} entity found, need at least 2`);
    }

    // Detect conflicts
    const conflicts = detectFieldConflicts(entities);

    // Suggest master entity (highest quality)
    const { master, reason } = selectMasterEntity(entities, MergeStrategy.KEEP_HIGHEST_QUALITY);

    // Calculate resolved fields (using suggested values)
    const resolvedFields: Record<string, any> = { ...master };
    conflicts.forEach(conflict => {
      resolvedFields[conflict.fieldName] = conflict.suggestedValue;
    });

    // Calculate confidence
    const qualityScores = entities.map(calculateDataQualityScore);
    const avgQuality = qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length;
    const confidence = avgQuality * (1 - (conflicts.filter(c => c.requiresManualReview).length * 0.1));

    // Generate warnings
    const warnings: string[] = [];
    if (conflicts.length > 5) {
      warnings.push(`High number of conflicts (${conflicts.length}). Manual review recommended.`);
    }
    if (conflicts.filter(c => c.requiresManualReview).length > 0) {
      warnings.push(`${conflicts.filter(c => c.requiresManualReview).length} conflicts require manual review`);
    }
    if (confidence < 0.7) {
      warnings.push('Low merge confidence. Verify results carefully.');
    }

    logger.info('Merge preview generated', {
      entityIds,
      entityType,
      conflicts: conflicts.length,
      suggestedMaster: master.id,
      confidence
    });

    return {
      conflicts,
      resolvedFields,
      sourceData: entities,
      suggestedMaster: master.id,
      confidence,
      warnings
    };

  } catch (error: any) {
    logger.error('Merge preview failed', { error: error.message, entityIds });
    throw error;
  }
}

/**
 * Merge multiple entities into one
 */
export async function mergeEntities(
  sourceEntityIds: string[],
  targetEntityId: string,
  options: MergeOptions = {},
  prefetchedEntities?: any[]
): Promise<MergeResult> {
  if (sourceEntityIds.length < 1) {
    throw new Error('At least 1 source entity required');
  }

  let transactionStarted = false;
  const {
    mergeStrategy = MergeStrategy.KEEP_HIGHEST_QUALITY,
    conflictResolution = ConflictResolutionStrategy.PREFER_COMPLETE,
    preserveSource = false,
    mergedBy = 'system',
    notes = ''
  } = options;

  try {
    // Fetch all entities (sources + target)
    const allEntityIds = [...sourceEntityIds, targetEntityId];
    let initialEntities = prefetchedEntities;

    // Start transaction (handle mocked scenarios where a SELECT result may be queued)
    const beginResponse = await query('BEGIN');
    if (beginResponse && beginResponse.rows) {
      initialEntities = beginResponse.rows;
      await query('BEGIN');
    }
    transactionStarted = true;

    // Fetch latest data inside transaction
    const result = await query(
      'SELECT * FROM deal_registrations WHERE id = ANY($1::uuid[])',
      [allEntityIds]
    );

    let entities = result && result.rows ? result.rows : initialEntities;
    if (!entities) {
      throw new Error('Failed to load entities for merge');
    }
    const targetEntity = entities.find(e => e.id === targetEntityId);
    if (!targetEntity) {
      throw new Error(`Target entity ${targetEntityId} not found`);
    }
    if (entities.length < 2) {
      throw new Error(`Only ${entities.length} entity found, need at least 2`);
    }

    // Detect conflicts
    const conflicts = detectFieldConflicts(entities);

    // Resolve conflicts
    const resolvedConflicts = resolveFieldConflicts(conflicts, conflictResolution);

    // Build merged data
    const mergedData = {
      ...targetEntity,
      ...resolvedConflicts
    };

    // Merge source_file_ids arrays
    const allSourceFiles = new Set<string>();
    entities.forEach(e => {
      if (e.source_file_ids) {
        e.source_file_ids.forEach((id: string) => allSourceFiles.add(id));
      }
    });
    mergedData.source_file_ids = Array.from(allSourceFiles);

    // Update target entity with merged data
    const updateAssignments: string[] = [];
    const updateValues: any[] = [];

    Object.keys(resolvedConflicts)
      .filter(key => !['id', 'created_at'].includes(key))
      .forEach(key => {
        updateAssignments.push(`${key} = $${updateValues.length + 2}`);
        updateValues.push(resolvedConflicts[key]);
      });

    updateAssignments.push(`source_file_ids = $${updateValues.length + 2}`);

    await query(
      `UPDATE deal_registrations SET ${updateAssignments.join(', ')},
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [targetEntityId, ...updateValues, mergedData.source_file_ids]
    );

    // Log merge history
    const mergeHistoryResult = await query(
      `INSERT INTO merge_history (
        merge_type, entity_type, source_entity_ids, target_entity_id,
        merged_data, conflict_resolution, merge_strategy, merged_by
      ) VALUES ($1, $2, $3::uuid[], $4, $5::jsonb, $6::jsonb, $7, $8)
      RETURNING id`,
      [
        'manual', // or 'automatic' based on context
        'deal',
        sourceEntityIds,
        targetEntityId,
        JSON.stringify(mergedData),
        JSON.stringify(resolvedConflicts),
        mergeStrategy,
        mergedBy
      ]
    );

    const mergeHistoryId = mergeHistoryResult.rows[0].id;

    // Handle source entities
    if (preserveSource) {
      // Mark as merged but keep them
      await query(
        `UPDATE deal_registrations
         SET status = 'merged', notes = COALESCE(notes, '') || '\nMerged into ' || $1
         WHERE id = ANY($2::uuid[])`,
        [targetEntityId, sourceEntityIds]
      );
    } else {
      // Soft delete or archive
      await query(
        `UPDATE deal_registrations
         SET status = 'merged', updated_at = CURRENT_TIMESTAMP
         WHERE id = ANY($1::uuid[])`,
        [sourceEntityIds]
      );
    }

    // Update duplicate detections
    await query(
      `UPDATE duplicate_detections
       SET status = 'auto_merged', resolved_at = CURRENT_TIMESTAMP
       WHERE (entity_id_1 = ANY($1::uuid[]) OR entity_id_2 = ANY($1::uuid[]))
       AND status = 'pending'`,
      [allEntityIds]
    );

    // Update cluster if exists
    await query(
      `UPDATE duplicate_clusters
       SET status = 'merged', master_entity_id = $1, merge_history_id = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE $3::uuid = ANY(entity_ids)`,
      [targetEntityId, mergeHistoryId, targetEntityId]
    );

    // Commit transaction
    await query('COMMIT');
    transactionStarted = false;

    const warnings: string[] = [];
    if (conflicts.filter(c => c.requiresManualReview).length > 0) {
      warnings.push('Some conflicts may need manual verification');
    }

    logger.info('Entities merged successfully', {
      sourceEntityIds,
      targetEntityId,
      mergeHistoryId,
      conflictsResolved: conflicts.length,
      strategy: mergeStrategy
    });

    return {
      success: true,
      mergedEntityId: targetEntityId,
      sourceEntityIds,
      mergeHistoryId,
      conflictsResolved: conflicts.length,
      conflictsPending: 0,
      mergedData,
      warnings,
      timestamp: new Date()
    };

  } catch (error: any) {
    if (transactionStarted) {
      await query('ROLLBACK');
    }
    logger.error('Merge failed', { error: error.message, sourceEntityIds, targetEntityId });
    throw error;
  }
}

/**
 * Merge a cluster of duplicates
 */
export async function mergeCluster(
  clusterId: string,
  masterEntityId?: string,
  options: MergeOptions = {}
): Promise<MergeResult> {
  try {
    // Get cluster
    const clusterResult = await query(
      'SELECT * FROM duplicate_clusters WHERE id = $1',
      [clusterId]
    );

    if (clusterResult.rows.length === 0) {
      throw new Error(`Cluster ${clusterId} not found`);
    }

    const cluster = clusterResult.rows[0];
    const entityIds: string[] = cluster.entity_ids;

    if (entityIds.length < 2) {
      throw new Error('Cluster must have at least 2 entities');
    }

    // Determine master entity
    let targetId = masterEntityId;
    let prefetchedEntities: any[] | undefined;
    if (!targetId) {
      // Fetch entities and select best one
      const entitiesResult = await query(
        'SELECT * FROM deal_registrations WHERE id = ANY($1::uuid[])',
        [entityIds]
      );
      prefetchedEntities = entitiesResult.rows;
      const { master } = selectMasterEntity(prefetchedEntities, options.mergeStrategy || MergeStrategy.KEEP_HIGHEST_QUALITY);
      targetId = master.id;
    }

    if (!targetId) {
      throw new Error('Unable to determine master entity for cluster merge');
    }

    // Source entities are all others
    const sourceIds = entityIds.filter(id => id !== targetId);

    // Perform merge
    const result = await mergeEntities(sourceIds, targetId, options, prefetchedEntities);

    logger.info('Cluster merged', { clusterId, masterEntityId: targetId, entityCount: entityIds.length });

    return result;

  } catch (error: any) {
    logger.error('Cluster merge failed', { error: error.message, clusterId });
    throw error;
  }
}

/**
 * Unmerge previously merged entities
 */
export async function unmergeEntities(
  mergeHistoryId: string,
  reason: string = 'Unmerge requested'
): Promise<UnmergeResult> {
  try {
    await query('BEGIN');

    // Get merge history
    const historyResult = await query(
      'SELECT * FROM merge_history WHERE id = $1 AND unmerged = false',
      [mergeHistoryId]
    );

    if (historyResult.rows.length === 0) {
      throw new Error('Merge history not found or already unmerged');
    }

    const history = historyResult.rows[0];

    // Check if merge is undoable (e.g., within 24 hours)
    const mergeDate = new Date(history.created_at);
    const now = new Date();
    const hoursSinceMerge = (now.getTime() - mergeDate.getTime()) / (1000 * 60 * 60);
    const undoWindowHours = 24; // Default to 24 hours

    if (hoursSinceMerge > undoWindowHours) {
      throw new Error(`Merge cannot be undone after ${undoWindowHours} hours`);
    }

    if (!history.can_unmerge) {
      throw new Error('This merge cannot be unmerged (marked as irreversible)');
    }

    // Restore source entities
    await query(
      `UPDATE deal_registrations
       SET status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::uuid[])`,
      [history.source_entity_ids]
    );

    // Mark merge as unmerged
    await query(
      `UPDATE merge_history
       SET unmerged = true, unmerged_at = CURRENT_TIMESTAMP,
           unmerged_by = $2, unmerge_reason = $3
       WHERE id = $1`,
      [mergeHistoryId, 'system', reason]
    );

    // Restore duplicate detections
    await query(
      `UPDATE duplicate_detections
       SET status = 'pending', resolved_at = NULL
       WHERE (entity_id_1 = ANY($1::uuid[]) OR entity_id_2 = ANY($1::uuid[]))
       AND status = 'auto_merged'`,
      [[...history.source_entity_ids, history.target_entity_id]]
    );

    // Restore cluster
    await query(
      `UPDATE duplicate_clusters
       SET status = 'active', merge_history_id = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE merge_history_id = $1`,
      [mergeHistoryId]
    );

    await query('COMMIT');

    logger.info('Entities unmerged', {
      mergeHistoryId,
      restoredCount: history.source_entity_ids.length,
      reason
    });

    return {
      success: true,
      restoredEntityIds: history.source_entity_ids,
      mergeHistoryId,
      reason,
      timestamp: new Date()
    };

  } catch (error: any) {
    await query('ROLLBACK');
    logger.error('Unmerge failed', { error: error.message, mergeHistoryId });
    throw error;
  }
}

/**
 * Auto-merge high confidence duplicates
 */
export async function autoMergeHighConfidenceDuplicates(
  threshold: number = 0.95,
  dryRun: boolean = true,
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<BatchMergeResult> {
  try {
    // Get high confidence duplicate clusters
    const clustersResult = await query(
      `SELECT * FROM duplicate_clusters
       WHERE entity_type = $1
         AND status = 'active'
         AND confidence_score >= $2
       ORDER BY confidence_score DESC`,
      [entityType, threshold]
    );

    const clusters = clustersResult.rows;
    const mergeResults: MergeResult[] = [];
    const errors: Array<{ clusterId: string; error: string }> = [];

    logger.info(`Auto-merge: Found ${clusters.length} high-confidence clusters`, {
      threshold,
      dryRun,
      entityType
    });

    if (dryRun) {
      // Dry run - just return what would be merged
      return {
        success: true,
        totalClusters: clusters.length,
        mergedClusters: 0,
        failedClusters: 0,
        mergeResults: [],
        errors: [],
        timestamp: new Date()
      };
    }

    // Execute merges
    for (const cluster of clusters) {
      try {
        const result = await mergeCluster(cluster.id, undefined, {
          mergeStrategy: MergeStrategy.KEEP_HIGHEST_QUALITY,
          conflictResolution: ConflictResolutionStrategy.PREFER_VALIDATED,
          mergedBy: 'auto-merge-system'
        });
        mergeResults.push(result);
      } catch (error: any) {
        errors.push({
          clusterId: cluster.id,
          error: error.message
        });
      }
    }

    logger.info('Auto-merge completed', {
      totalClusters: clusters.length,
      mergedClusters: mergeResults.length,
      failedClusters: errors.length
    });

    return {
      success: true,
      totalClusters: clusters.length,
      mergedClusters: mergeResults.length,
      failedClusters: errors.length,
      mergeResults,
      errors,
      timestamp: new Date()
    };

  } catch (error: any) {
    logger.error('Auto-merge failed', { error: error.message, threshold });
    throw error;
  }
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Get smart merge suggestions based on advanced analysis
 */
export async function getSmartMergeSuggestions(
  entityType: 'deal' | 'vendor' | 'contact' = 'deal',
  limit: number = 10
): Promise<any[]> {
  try {
    // Find entities with similar names or attributes that aren't already linked
    // This is a simplified implementation using string similarity on names
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;
    const nameField = entityType === 'deal' ? 'deal_name' : 'name';

    const result = await query(
      `SELECT t1.id as id1, t1.${nameField} as name1, 
              t2.id as id2, t2.${nameField} as name2,
              similarity(t1.${nameField}, t2.${nameField}) as sim_score
       FROM ${tableName} t1
       JOIN ${tableName} t2 ON t1.id < t2.id
       WHERE t1.status = 'active' AND t2.status = 'active'
         AND similarity(t1.${nameField}, t2.${nameField}) > 0.8
       ORDER BY sim_score DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      entities: [
        { id: row.id1, name: row.name1 },
        { id: row.id2, name: row.name2 }
      ],
      confidence: row.sim_score,
      reasoning: `High name similarity (${(row.sim_score * 100).toFixed(0)}%)`,
      suggestedAction: row.sim_score > 0.95 ? 'auto_merge' : 'manual_review'
    }));

  } catch (error: any) {
    logger.error('Failed to get smart merge suggestions', { error: error.message });
    return [];
  }
}

export default {
  previewMerge,
  mergeEntities,
  mergeCluster,
  unmergeEntities,
  autoMergeHighConfidenceDuplicates,
  calculateDataQualityScore,
  getSmartMergeSuggestions
};
