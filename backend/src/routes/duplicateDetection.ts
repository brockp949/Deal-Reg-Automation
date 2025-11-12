import { Router, Request, Response } from 'express';
import {
  detectDuplicateDeals,
  detectDuplicatesInBatch,
  clusterDuplicates,
  calculateSimilarityScore,
  DealData,
  DuplicateStrategy,
  MATCH_CONFIG
} from '../services/duplicateDetector';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router();

// ============================================================================
// Detection Endpoints
// ============================================================================

/**
 * POST /api/duplicates/detect/deal
 * Detect duplicates for a specific deal
 */
router.post('/detect/deal', async (req: Request, res: Response) => {
  try {
    const { dealId, dealData, threshold, strategies } = req.body;

    if (!dealId && !dealData) {
      return res.status(400).json({
        error: 'Either dealId or dealData is required'
      });
    }

    let deal: DealData;

    if (dealId) {
      // Fetch deal from database
      const result = await query(
        `SELECT
          id, deal_name as "dealName", customer_name as "customerName",
          deal_value as "dealValue", currency, close_date as "closeDate",
          registration_date as "registrationDate", vendor_id as "vendorId",
          products, status
        FROM deal_registrations
        WHERE id = $1`,
        [dealId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Deal not found' });
      }

      deal = result.rows[0];
    } else {
      deal = dealData;
    }

    // Detect duplicates
    const detectionResult = await detectDuplicateDeals(deal, {
      threshold: threshold || MATCH_CONFIG.MINIMUM_MATCH_THRESHOLD,
      strategies: strategies || undefined
    });

    logger.info('Duplicate detection completed via API', {
      dealId: deal.id,
      dealName: deal.dealName,
      matchesFound: detectionResult.matches.length,
      suggestedAction: detectionResult.suggestedAction
    });

    res.json({
      success: true,
      deal: {
        id: deal.id,
        dealName: deal.dealName,
        customerName: deal.customerName
      },
      detection: detectionResult,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Duplicate detection failed', { error: error.message });
    res.status(500).json({
      error: 'Duplicate detection failed',
      message: error.message
    });
  }
});

/**
 * POST /api/duplicates/detect/batch
 * Batch duplicate detection
 */
router.post('/detect/batch', async (req: Request, res: Response) => {
  try {
    const { dealIds, threshold } = req.body;

    if (!Array.isArray(dealIds) || dealIds.length === 0) {
      return res.status(400).json({
        error: 'dealIds array is required'
      });
    }

    // Fetch all deals
    const result = await query(
      `SELECT
        id, deal_name as "dealName", customer_name as "customerName",
        deal_value as "dealValue", currency, close_date as "closeDate",
        registration_date as "registrationDate", vendor_id as "vendorId",
        products, status
      FROM deal_registrations
      WHERE id = ANY($1::uuid[])`,
      [dealIds]
    );

    const deals: DealData[] = result.rows;

    if (deals.length === 0) {
      return res.status(404).json({ error: 'No deals found' });
    }

    // Batch detection
    const results = await detectDuplicatesInBatch(deals);

    // Convert Map to Object for JSON response
    const resultsObject: Record<string, any> = {};
    results.forEach((value, key) => {
      resultsObject[key] = value;
    });

    const summary = {
      totalDeals: deals.length,
      dealsWithDuplicates: Array.from(results.values()).filter(r => r.isDuplicate).length,
      totalDuplicatesFound: Array.from(results.values()).reduce((sum, r) => sum + r.matches.length, 0),
      autoMergeCandidates: Array.from(results.values()).filter(r => r.suggestedAction === 'auto_merge').length,
      manualReviewCandidates: Array.from(results.values()).filter(r => r.suggestedAction === 'manual_review').length
    };

    logger.info('Batch duplicate detection completed', summary);

    res.json({
      success: true,
      summary,
      results: resultsObject,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Batch duplicate detection failed', { error: error.message });
    res.status(500).json({
      error: 'Batch duplicate detection failed',
      message: error.message
    });
  }
});

/**
 * POST /api/duplicates/detect/cross-source
 * Detect duplicates across multiple source files
 */
router.post('/detect/cross-source', async (req: Request, res: Response) => {
  try {
    const { sourceFileIds, entityType, threshold } = req.body;

    if (!Array.isArray(sourceFileIds) || sourceFileIds.length < 2) {
      return res.status(400).json({
        error: 'At least 2 source file IDs are required'
      });
    }

    if (entityType && entityType !== 'deal') {
      return res.status(400).json({
        error: 'Only deal entity type is currently supported'
      });
    }

    // Get all deals from specified source files
    const result = await query(
      `SELECT
        id, deal_name as "dealName", customer_name as "customerName",
        deal_value as "dealValue", currency, close_date as "closeDate",
        registration_date as "registrationDate", vendor_id as "vendorId",
        products, status, source_file_id as "sourceFileId"
      FROM deal_registrations
      WHERE source_file_id = ANY($1::text[])
      AND status != 'rejected'`,
      [sourceFileIds]
    );

    const deals: DealData[] = result.rows;

    if (deals.length === 0) {
      return res.status(404).json({ error: 'No deals found in specified files' });
    }

    // Detect duplicates
    const results = await detectDuplicatesInBatch(deals);

    // Filter for cross-source duplicates only
    const crossSourceDuplicates: any[] = [];
    results.forEach((detection, dealId) => {
      if (detection.isDuplicate) {
        const deal = deals.find(d => d.id === dealId);
        const crossSourceMatches = detection.matches.filter(match => {
          const matchedDeal = deals.find(d => d.id === match.matchedEntityId);
          return matchedDeal && matchedDeal.sourceFileId !== deal?.sourceFileId;
        });

        if (crossSourceMatches.length > 0) {
          crossSourceDuplicates.push({
            dealId,
            dealName: deal?.dealName,
            sourceFileId: deal?.sourceFileId,
            matches: crossSourceMatches
          });
        }
      }
    });

    logger.info('Cross-source duplicate detection completed', {
      sourceFiles: sourceFileIds.length,
      totalDeals: deals.length,
      crossSourceDuplicates: crossSourceDuplicates.length
    });

    res.json({
      success: true,
      summary: {
        sourceFilesAnalyzed: sourceFileIds.length,
        totalDealsAnalyzed: deals.length,
        crossSourceDuplicatesFound: crossSourceDuplicates.length
      },
      duplicates: crossSourceDuplicates,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Cross-source duplicate detection failed', { error: error.message });
    res.status(500).json({
      error: 'Cross-source duplicate detection failed',
      message: error.message
    });
  }
});

/**
 * GET /api/duplicates/candidates/:entityId
 * Get duplicate candidates for a specific entity
 */
router.get('/candidates/:entityId', async (req: Request, res: Response) => {
  try {
    const { entityId } = req.params;
    const threshold = parseFloat(req.query.threshold as string) || 0.7;
    const limit = parseInt(req.query.limit as string) || 10;

    // Use database function to get candidates
    const result = await query(
      'SELECT * FROM get_duplicate_candidates($1::uuid, $2, $3)',
      [entityId, threshold, limit]
    );

    const candidates = result.rows;

    // Enrich candidates with entity data
    const enrichedCandidates = await Promise.all(
      candidates.map(async (candidate) => {
        const dealResult = await query(
          `SELECT
            id, deal_name as "dealName", customer_name as "customerName",
            deal_value as "dealValue", close_date as "closeDate"
          FROM deal_registrations
          WHERE id = $1`,
          [candidate.candidate_id]
        );

        return {
          ...candidate,
          deal: dealResult.rows[0] || null
        };
      })
    );

    res.json({
      success: true,
      entityId,
      threshold,
      candidatesFound: enrichedCandidates.length,
      candidates: enrichedCandidates,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get duplicate candidates', { error: error.message });
    res.status(500).json({
      error: 'Failed to get duplicate candidates',
      message: error.message
    });
  }
});

// ============================================================================
// Cluster Management Endpoints
// ============================================================================

/**
 * POST /api/duplicates/clusters/create
 * Create a duplicate cluster from entity IDs
 */
router.post('/clusters/create', async (req: Request, res: Response) => {
  try {
    const { entityIds, entityType, masterEntityId } = req.body;

    if (!Array.isArray(entityIds) || entityIds.length < 2) {
      return res.status(400).json({
        error: 'At least 2 entity IDs are required to create a cluster'
      });
    }

    // Fetch entities to verify they exist
    const deals = await Promise.all(
      entityIds.map(async (id) => {
        const result = await query(
          'SELECT id, deal_name FROM deal_registrations WHERE id = $1',
          [id]
        );
        return result.rows[0];
      })
    );

    const validIds = deals.filter(Boolean).map(d => d.id);

    if (validIds.length < 2) {
      return res.status(400).json({
        error: 'Not enough valid entities found'
      });
    }

    // Create cluster using database function
    const result = await query(
      'SELECT create_duplicate_cluster($1, $2::uuid[], $3, $4::uuid)',
      [
        entityType || 'deal',
        validIds,
        0.85, // Default confidence
        masterEntityId || null
      ]
    );

    const clusterId = result.rows[0].create_duplicate_cluster;

    logger.info('Duplicate cluster created', {
      clusterId,
      entityCount: validIds.length,
      entityType: entityType || 'deal'
    });

    res.json({
      success: true,
      clusterId,
      entityCount: validIds.length,
      entityIds: validIds,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to create duplicate cluster', { error: error.message });
    res.status(500).json({
      error: 'Failed to create duplicate cluster',
      message: error.message
    });
  }
});

/**
 * GET /api/duplicates/clusters
 * List all duplicate clusters
 */
router.get('/clusters', async (req: Request, res: Response) => {
  try {
    const entityType = req.query.entityType as string;
    const status = req.query.status as string || 'active';
    const minSize = parseInt(req.query.minSize as string) || 2;
    const limit = parseInt(req.query.limit as string) || 50;

    let queryText = `
      SELECT
        id, cluster_key, entity_type, entity_ids, master_entity_id,
        cluster_size, confidence_score, created_at, updated_at, status
      FROM duplicate_clusters
      WHERE cluster_size >= $1
        AND status = $2
    `;
    const params: any[] = [minSize, status];

    if (entityType) {
      params.push(entityType);
      queryText += ` AND entity_type = $${params.length}`;
    }

    queryText += ` ORDER BY confidence_score DESC, created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(queryText, params);

    res.json({
      success: true,
      filters: { entityType, status, minSize },
      clustersFound: result.rows.length,
      clusters: result.rows,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to list duplicate clusters', { error: error.message });
    res.status(500).json({
      error: 'Failed to list duplicate clusters',
      message: error.message
    });
  }
});

/**
 * GET /api/duplicates/clusters/:clusterId
 * Get cluster details with entity data
 */
router.get('/clusters/:clusterId', async (req: Request, res: Response) => {
  try {
    const { clusterId } = req.params;

    // Get cluster
    const clusterResult = await query(
      'SELECT * FROM duplicate_clusters WHERE id = $1',
      [clusterId]
    );

    if (clusterResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cluster not found' });
    }

    const cluster = clusterResult.rows[0];

    // Get entity details
    const entities = await Promise.all(
      cluster.entity_ids.map(async (id: string) => {
        const entityResult = await query(
          `SELECT
            id, deal_name as "dealName", customer_name as "customerName",
            deal_value as "dealValue", close_date as "closeDate",
            vendor_id as "vendorId", status
          FROM deal_registrations
          WHERE id = $1`,
          [id]
        );
        return entityResult.rows[0];
      })
    );

    res.json({
      success: true,
      cluster: {
        ...cluster,
        entities
      },
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get cluster details', { error: error.message });
    res.status(500).json({
      error: 'Failed to get cluster details',
      message: error.message
    });
  }
});

/**
 * POST /api/duplicates/clusters/:clusterId/split
 * Split a cluster (mark as non-duplicates)
 */
router.post('/clusters/:clusterId/split', async (req: Request, res: Response) => {
  try {
    const { clusterId } = req.params;
    const { reason } = req.body;

    // Update cluster status to 'split'
    const result = await query(
      `UPDATE duplicate_clusters
       SET status = 'split', notes = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [clusterId, reason || 'Manually split - not actual duplicates']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cluster not found' });
    }

    // Also update duplicate_detections status
    const entityIds = result.rows[0].entity_ids;
    await query(
      `UPDATE duplicate_detections
       SET status = 'rejected',
           resolution_notes = $1,
           resolved_at = CURRENT_TIMESTAMP
       WHERE
         (entity_id_1 = ANY($2::uuid[]) OR entity_id_2 = ANY($2::uuid[]))
         AND status = 'pending'`,
      [reason || 'Cluster split', entityIds]
    );

    logger.info('Cluster split', { clusterId, entityCount: entityIds.length });

    res.json({
      success: true,
      message: 'Cluster split successfully',
      cluster: result.rows[0],
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to split cluster', { error: error.message });
    res.status(500).json({
      error: 'Failed to split cluster',
      message: error.message
    });
  }
});

/**
 * DELETE /api/duplicates/clusters/:clusterId
 * Delete a cluster
 */
router.delete('/clusters/:clusterId', async (req: Request, res: Response) => {
  try {
    const { clusterId } = req.params;

    const result = await query(
      'DELETE FROM duplicate_clusters WHERE id = $1 RETURNING *',
      [clusterId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cluster not found' });
    }

    logger.info('Cluster deleted', { clusterId });

    res.json({
      success: true,
      message: 'Cluster deleted successfully',
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to delete cluster', { error: error.message });
    res.status(500).json({
      error: 'Failed to delete cluster',
      message: error.message
    });
  }
});

// ============================================================================
// Statistics Endpoints
// ============================================================================

/**
 * GET /api/duplicates/statistics
 * Get duplicate detection statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const entityType = req.query.entityType as string;

    // Get detection statistics
    let statsQuery = `
      SELECT
        entity_type,
        COUNT(*) as total_detections,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_count,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
        COUNT(*) FILTER (WHERE status = 'auto_merged') as auto_merged_count,
        AVG(confidence_level) as avg_confidence,
        COUNT(*) FILTER (WHERE confidence_level >= 0.95) as very_high_confidence_count,
        COUNT(*) FILTER (WHERE confidence_level >= 0.85 AND confidence_level < 0.95) as high_confidence_count
      FROM duplicate_detections
      WHERE detected_at >= CURRENT_TIMESTAMP - ($1 || ' days')::INTERVAL
    `;
    const params: any[] = [days];

    if (entityType) {
      params.push(entityType);
      statsQuery += ` AND entity_type = $${params.length}`;
    }

    statsQuery += ' GROUP BY entity_type';

    const statsResult = await query(statsQuery, params);

    // Get cluster statistics
    const clusterResult = await query(
      `SELECT
        entity_type,
        COUNT(*) as total_clusters,
        AVG(cluster_size) as avg_cluster_size,
        MAX(cluster_size) as max_cluster_size,
        COUNT(*) FILTER (WHERE status = 'active') as active_clusters,
        COUNT(*) FILTER (WHERE status = 'merged') as merged_clusters
      FROM duplicate_clusters
      WHERE created_at >= CURRENT_TIMESTAMP - ($1 || ' days')::INTERVAL
      ${entityType ? 'AND entity_type = $2' : ''}
      GROUP BY entity_type`,
      entityType ? [days, entityType] : [days]
    );

    // Get detection strategy breakdown
    const strategyResult = await query(
      `SELECT
        detection_strategy,
        COUNT(*) as usage_count,
        AVG(confidence_level) as avg_confidence
      FROM duplicate_detections
      WHERE detected_at >= CURRENT_TIMESTAMP - ($1 || ' days')::INTERVAL
      ${entityType ? 'AND entity_type = $2' : ''}
      GROUP BY detection_strategy
      ORDER BY usage_count DESC`,
      entityType ? [days, entityType] : [days]
    );

    res.json({
      success: true,
      period: `Last ${days} days`,
      entityType: entityType || 'all',
      detectionStats: statsResult.rows,
      clusterStats: clusterResult.rows,
      strategyBreakdown: strategyResult.rows,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get duplicate statistics', { error: error.message });
    res.status(500).json({
      error: 'Failed to get duplicate statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/duplicates/high-confidence
 * Get high-confidence duplicates ready for review/merge
 */
router.get('/high-confidence', async (req: Request, res: Response) => {
  try {
    const threshold = parseFloat(req.query.threshold as string) || 0.95;
    const limit = parseInt(req.query.limit as string) || 50;
    const entityType = req.query.entityType as string || 'deal';

    const result = await query(
      `SELECT * FROM high_confidence_duplicates
       WHERE entity_type = $1 AND confidence_level >= $2
       LIMIT $3`,
      [entityType, threshold, limit]
    );

    // Enrich with entity data
    const enriched = await Promise.all(
      result.rows.map(async (dup) => {
        const entity1 = await query(
          'SELECT id, deal_name, customer_name, deal_value FROM deal_registrations WHERE id = $1',
          [dup.entity_id_1]
        );
        const entity2 = await query(
          'SELECT id, deal_name, customer_name, deal_value FROM deal_registrations WHERE id = $1',
          [dup.entity_id_2]
        );

        return {
          ...dup,
          entity1: entity1.rows[0],
          entity2: entity2.rows[0]
        };
      })
    );

    res.json({
      success: true,
      threshold,
      duplicatesFound: enriched.length,
      duplicates: enriched,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get high-confidence duplicates', { error: error.message });
    res.status(500).json({
      error: 'Failed to get high-confidence duplicates',
      message: error.message
    });
  }
});

/**
 * POST /api/duplicates/similarity
 * Calculate similarity between two deals
 */
router.post('/similarity', async (req: Request, res: Response) => {
  try {
    const { deal1Id, deal2Id, weights } = req.body;

    if (!deal1Id || !deal2Id) {
      return res.status(400).json({
        error: 'Both deal1Id and deal2Id are required'
      });
    }

    // Fetch both deals
    const deal1Result = await query(
      `SELECT
        id, deal_name as "dealName", customer_name as "customerName",
        deal_value as "dealValue", currency, close_date as "closeDate",
        vendor_id as "vendorId", products
      FROM deal_registrations
      WHERE id = $1`,
      [deal1Id]
    );

    const deal2Result = await query(
      `SELECT
        id, deal_name as "dealName", customer_name as "customerName",
        deal_value as "dealValue", currency, close_date as "closeDate",
        vendor_id as "vendorId", products
      FROM deal_registrations
      WHERE id = $1`,
      [deal2Id]
    );

    if (deal1Result.rows.length === 0 || deal2Result.rows.length === 0) {
      return res.status(404).json({ error: 'One or both deals not found' });
    }

    const deal1 = deal1Result.rows[0];
    const deal2 = deal2Result.rows[0];

    // Calculate similarity
    const similarity = calculateSimilarityScore(deal1, deal2, weights);

    res.json({
      success: true,
      deal1: {
        id: deal1.id,
        dealName: deal1.dealName,
        customerName: deal1.customerName
      },
      deal2: {
        id: deal2.id,
        dealName: deal2.dealName,
        customerName: deal2.customerName
      },
      similarity,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to calculate similarity', { error: error.message });
    res.status(500).json({
      error: 'Failed to calculate similarity',
      message: error.message
    });
  }
});

// ============================================================================
// Utility Endpoints
// ============================================================================

/**
 * GET /api/duplicates/config
 * Get current duplicate detection configuration
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      config: {
        autoMergeThreshold: MATCH_CONFIG.AUTO_MERGE_THRESHOLD,
        highConfidenceThreshold: MATCH_CONFIG.HIGH_CONFIDENCE_THRESHOLD,
        mediumConfidenceThreshold: MATCH_CONFIG.MEDIUM_CONFIDENCE_THRESHOLD,
        lowConfidenceThreshold: MATCH_CONFIG.LOW_CONFIDENCE_THRESHOLD,
        minimumMatchThreshold: MATCH_CONFIG.MINIMUM_MATCH_THRESHOLD,
        valueTolerance: MATCH_CONFIG.VALUE_TOLERANCE_PERCENT + '%',
        dateTolerance: MATCH_CONFIG.DATE_TOLERANCE_DAYS + ' days',
        defaultWeights: MATCH_CONFIG.DEFAULT_DEAL_WEIGHTS,
        batchSize: MATCH_CONFIG.BATCH_SIZE
      },
      availableStrategies: Object.values(DuplicateStrategy),
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get config', { error: error.message });
    res.status(500).json({
      error: 'Failed to get config',
      message: error.message
    });
  }
});

export default router;
