import { Router, Request, Response } from 'express';
import {
  previewMerge,
  mergeEntities,
  mergeCluster,
  unmergeEntities,
  autoMergeHighConfidenceDuplicates,
  calculateDataQualityScore,
  MergeStrategy,
  ConflictResolutionStrategy,
  MergeOptions
} from '../services/mergeEngine';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router();

// ============================================================================
// Merge Preview & Execution Endpoints
// ============================================================================

/**
 * POST /api/merge/preview
 * Preview merge without executing
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { entityIds, entityType = 'deal' } = req.body;

    if (!Array.isArray(entityIds) || entityIds.length < 2) {
      return res.status(400).json({
        error: 'At least 2 entity IDs required for merge preview'
      });
    }

    const preview = await previewMerge(entityIds, entityType);

    logger.info('Merge preview generated', {
      entityIds,
      conflicts: preview.conflicts.length,
      confidence: preview.confidence
    });

    res.json({
      success: true,
      preview,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Merge preview failed', { error: error.message });
    res.status(500).json({
      error: 'Merge preview failed',
      message: error.message
    });
  }
});

/**
 * POST /api/merge/execute
 * Execute merge operation
 */
router.post('/execute', async (req: Request, res: Response) => {
  try {
    const {
      sourceEntityIds,
      targetEntityId,
      mergeStrategy,
      conflictResolution,
      preserveSource = false,
      mergedBy = 'user',
      notes
    } = req.body;

    if (!Array.isArray(sourceEntityIds) || sourceEntityIds.length === 0) {
      return res.status(400).json({
        error: 'sourceEntityIds array is required'
      });
    }

    if (!targetEntityId) {
      return res.status(400).json({
        error: 'targetEntityId is required'
      });
    }

    const options: MergeOptions = {
      mergeStrategy: mergeStrategy as MergeStrategy,
      conflictResolution: conflictResolution as ConflictResolutionStrategy,
      preserveSource,
      mergedBy,
      notes
    };

    const result = await mergeEntities(sourceEntityIds, targetEntityId, options);

    logger.info('Merge executed successfully', {
      sourceEntityIds,
      targetEntityId,
      mergeHistoryId: result.mergeHistoryId
    });

    res.json({
      success: true,
      result,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Merge execution failed', { error: error.message });
    res.status(500).json({
      error: 'Merge execution failed',
      message: error.message
    });
  }
});

/**
 * POST /api/merge/cluster/:clusterId
 * Merge entire cluster
 */
router.post('/cluster/:clusterId', async (req: Request, res: Response) => {
  try {
    const { clusterId } = req.params;
    const {
      masterEntityId,
      mergeStrategy,
      conflictResolution,
      mergedBy = 'user'
    } = req.body;

    const options: MergeOptions = {
      mergeStrategy: mergeStrategy as MergeStrategy,
      conflictResolution: conflictResolution as ConflictResolutionStrategy,
      mergedBy
    };

    const result = await mergeCluster(clusterId, masterEntityId, options);

    logger.info('Cluster merged successfully', {
      clusterId,
      mergeHistoryId: result.mergeHistoryId
    });

    res.json({
      success: true,
      result,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Cluster merge failed', { error: error.message });
    res.status(500).json({
      error: 'Cluster merge failed',
      message: error.message
    });
  }
});

/**
 * POST /api/merge/auto
 * Auto-merge high confidence duplicates
 */
router.post('/auto', async (req: Request, res: Response) => {
  try {
    const {
      threshold = 0.95,
      dryRun = true,
      entityType = 'deal'
    } = req.body;

    if (threshold < 0.5 || threshold > 1.0) {
      return res.status(400).json({
        error: 'Threshold must be between 0.5 and 1.0'
      });
    }

    const result = await autoMergeHighConfidenceDuplicates(threshold, dryRun, entityType);

    logger.info('Auto-merge completed', {
      threshold,
      dryRun,
      mergedClusters: result.mergedClusters
    });

    res.json({
      success: true,
      result,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Auto-merge failed', { error: error.message });
    res.status(500).json({
      error: 'Auto-merge failed',
      message: error.message
    });
  }
});

// ============================================================================
// Unmerge Endpoints
// ============================================================================

/**
 * POST /api/merge/unmerge/:mergeHistoryId
 * Unmerge previously merged entities
 */
router.post('/unmerge/:mergeHistoryId', async (req: Request, res: Response) => {
  try {
    const { mergeHistoryId } = req.params;
    const { reason = 'Unmerge requested by user' } = req.body;

    const result = await unmergeEntities(mergeHistoryId, reason);

    logger.info('Entities unmerged', {
      mergeHistoryId,
      restoredCount: result.restoredEntityIds.length
    });

    res.json({
      success: true,
      result,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Unmerge failed', { error: error.message });
    res.status(500).json({
      error: 'Unmerge failed',
      message: error.message
    });
  }
});

/**
 * GET /api/merge/history/:entityId
 * Get merge history for an entity
 */
router.get('/history/:entityId', async (req: Request, res: Response) => {
  try {
    const { entityId } = req.params;

    // Use database function to get merge history
    const result = await query(
      'SELECT * FROM get_entity_merge_history($1::uuid)',
      [entityId]
    );

    const history = result.rows;

    // Enrich with merge details
    const enrichedHistory = await Promise.all(
      history.map(async (record) => {
        const detailsResult = await query(
          'SELECT * FROM merge_history WHERE id = $1',
          [record.merge_id]
        );

        return {
          ...record,
          details: detailsResult.rows[0] || null
        };
      })
    );

    res.json({
      success: true,
      entityId,
      historyCount: enrichedHistory.length,
      history: enrichedHistory,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get merge history', { error: error.message });
    res.status(500).json({
      error: 'Failed to get merge history',
      message: error.message
    });
  }
});

// ============================================================================
// Conflict Resolution Endpoints
// ============================================================================

/**
 * GET /api/merge/conflicts/:mergeHistoryId
 * Get unresolved conflicts for a merge
 */
router.get('/conflicts/:mergeHistoryId', async (req: Request, res: Response) => {
  try {
    const { mergeHistoryId } = req.params;

    const result = await query(
      `SELECT * FROM field_conflicts
       WHERE merge_history_id = $1
       ORDER BY field_name`,
      [mergeHistoryId]
    );

    const conflicts = result.rows;

    res.json({
      success: true,
      mergeHistoryId,
      conflictsFound: conflicts.length,
      conflicts,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get conflicts', { error: error.message });
    res.status(500).json({
      error: 'Failed to get conflicts',
      message: error.message
    });
  }
});

/**
 * POST /api/merge/conflicts/:conflictId/resolve
 * Resolve a field conflict
 */
router.post('/conflicts/:conflictId/resolve', async (req: Request, res: Response) => {
  try {
    const { conflictId } = req.params;
    const { chosenValue, strategy, notes } = req.body;

    if (chosenValue === undefined) {
      return res.status(400).json({
        error: 'chosenValue is required'
      });
    }

    // Update conflict with resolution
    const result = await query(
      `UPDATE field_conflicts
       SET chosen_value = $2,
           resolution_strategy = $3,
           manual_override = true,
           notes = $4
       WHERE id = $1
       RETURNING *`,
      [conflictId, chosenValue, strategy || 'manual', notes || '']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conflict not found' });
    }

    // Get merge history to update the merged entity
    const conflict = result.rows[0];
    const mergeResult = await query(
      'SELECT target_entity_id FROM merge_history WHERE id = $1',
      [conflict.merge_history_id]
    );

    if (mergeResult.rows.length > 0) {
      const targetEntityId = mergeResult.rows[0].target_entity_id;

      // Update the entity with the resolved value
      await query(
        `UPDATE deal_registrations
         SET ${conflict.field_name} = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [targetEntityId, chosenValue]
      );
    }

    logger.info('Conflict resolved', {
      conflictId,
      fieldName: conflict.field_name,
      chosenValue
    });

    res.json({
      success: true,
      conflict: result.rows[0],
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to resolve conflict', { error: error.message });
    res.status(500).json({
      error: 'Failed to resolve conflict',
      message: error.message
    });
  }
});

// ============================================================================
// Statistics & History Endpoints
// ============================================================================

/**
 * GET /api/merge/statistics
 * Get merge statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;

    // Get merge statistics using database function
    const statsResult = await query(
      'SELECT * FROM get_merge_statistics($1)',
      [days]
    );

    // Get additional statistics
    const recentMerges = await query(
      'SELECT * FROM recent_merge_activity LIMIT 20'
    );

    const conflictStats = await query(
      `SELECT
        COUNT(*) as total_conflicts,
        COUNT(*) FILTER (WHERE manual_override = true) as manually_resolved,
        COUNT(*) FILTER (WHERE resolution_strategy = 'manual') as manual_strategy,
        AVG(confidence) as avg_confidence
      FROM field_conflicts fc
      JOIN merge_history mh ON fc.merge_history_id = mh.id
      WHERE mh.merged_at >= CURRENT_TIMESTAMP - ($1 || ' days')::INTERVAL`,
      [days]
    );

    res.json({
      success: true,
      period: `Last ${days} days`,
      mergeStatistics: statsResult.rows,
      conflictStatistics: conflictStats.rows[0],
      recentActivity: recentMerges.rows,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get merge statistics', { error: error.message });
    res.status(500).json({
      error: 'Failed to get merge statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/merge/history
 * List merge history with filters
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const entityType = req.query.entityType as string;
    const mergeType = req.query.mergeType as string;
    const unmergedOnly = req.query.unmergedOnly === 'true';
    const limit = parseInt(req.query.limit as string) || 50;

    let queryText = `
      SELECT
        mh.*,
        array_length(mh.source_entity_ids, 1) as source_count,
        (SELECT COUNT(*) FROM field_conflicts fc WHERE fc.merge_history_id = mh.id) as conflict_count
      FROM merge_history mh
      WHERE 1=1
    `;
    const params: any[] = [];

    if (entityType) {
      params.push(entityType);
      queryText += ` AND mh.entity_type = $${params.length}`;
    }

    if (mergeType) {
      params.push(mergeType);
      queryText += ` AND mh.merge_type = $${params.length}`;
    }

    if (unmergedOnly) {
      queryText += ' AND mh.unmerged = false';
    }

    queryText += ` ORDER BY mh.merged_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(queryText, params);

    res.json({
      success: true,
      filters: { entityType, mergeType, unmergedOnly },
      historyCount: result.rows.length,
      history: result.rows,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to list merge history', { error: error.message });
    res.status(500).json({
      error: 'Failed to list merge history',
      message: error.message
    });
  }
});

/**
 * GET /api/merge/history/:mergeHistoryId/details
 * Get detailed merge history
 */
router.get('/history/:mergeHistoryId/details', async (req: Request, res: Response) => {
  try {
    const { mergeHistoryId } = req.params;

    // Get merge history
    const historyResult = await query(
      'SELECT * FROM merge_history WHERE id = $1',
      [mergeHistoryId]
    );

    if (historyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Merge history not found' });
    }

    const history = historyResult.rows[0];

    // Get conflicts
    const conflictsResult = await query(
      'SELECT * FROM field_conflicts WHERE merge_history_id = $1',
      [mergeHistoryId]
    );

    // Get source entities (if still exist)
    const sourceEntities = await query(
      'SELECT id, deal_name, customer_name, status FROM deal_registrations WHERE id = ANY($1::uuid[])',
      [history.source_entity_ids]
    );

    // Get target entity
    const targetEntity = await query(
      'SELECT id, deal_name, customer_name, status FROM deal_registrations WHERE id = $1',
      [history.target_entity_id]
    );

    res.json({
      success: true,
      mergeHistory: history,
      conflicts: conflictsResult.rows,
      sourceEntities: sourceEntities.rows,
      targetEntity: targetEntity.rows[0],
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get merge details', { error: error.message });
    res.status(500).json({
      error: 'Failed to get merge details',
      message: error.message
    });
  }
});

// ============================================================================
// Quality Score Endpoints
// ============================================================================

/**
 * GET /api/merge/quality-score/:entityId
 * Calculate data quality score for an entity
 */
router.get('/quality-score/:entityId', async (req: Request, res: Response) => {
  try {
    const { entityId } = req.params;

    // Fetch entity
    const result = await query(
      'SELECT * FROM deal_registrations WHERE id = $1',
      [entityId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    const entity = result.rows[0];
    const qualityScore = calculateDataQualityScore(entity);

    res.json({
      success: true,
      entityId,
      qualityScore,
      scoreBreakdown: {
        completeness: (Object.keys(entity).filter(k => entity[k] !== null).length / Object.keys(entity).length) * 100,
        aiConfidence: (entity.ai_confidence_score || 0.5) * 100,
        validationStatus: entity.validation_status === 'passed' ? 100 : entity.validation_status === 'failed' ? 0 : 50,
        recency: 'varies based on update time'
      },
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to calculate quality score', { error: error.message });
    res.status(500).json({
      error: 'Failed to calculate quality score',
      message: error.message
    });
  }
});

// ============================================================================
// Utility Endpoints
// ============================================================================

/**
 * GET /api/merge/strategies
 * Get available merge strategies and conflict resolution strategies
 */
router.get('/strategies', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      mergeStrategies: Object.values(MergeStrategy),
      conflictResolutionStrategies: Object.values(ConflictResolutionStrategy),
      defaults: {
        mergeStrategy: MergeStrategy.KEEP_HIGHEST_QUALITY,
        conflictResolution: ConflictResolutionStrategy.PREFER_COMPLETE,
        autoMergeThreshold: 0.95
      },
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get strategies', { error: error.message });
    res.status(500).json({
      error: 'Failed to get strategies',
      message: error.message
    });
  }
});

export default router;
