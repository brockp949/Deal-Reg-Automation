import { Router, Request, Response } from 'express';
import {
  findRelatedEntities,
  buildDealCorrelationMap,
  getDataLineage,
  reconcileEntityAcrossSources,
  updateCorrelationKeys,
  findCrossSourceDuplicates,
  EntityKey
} from '../services/correlationEngine';
import {
  calculateDataQualityScore,
  getDuplicateStatistics,
  identifyQualityIssues,
  generateQualityReport,
  getQualityTrends
} from '../services/qualityMetrics';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router();

// ============================================================================
// Correlation Endpoints (Phase 6.3)
// ============================================================================

/**
 * GET /api/correlation/entity/:entityId
 * Get complete entity relationship graph
 */
router.get('/entity/:entityId', async (req: Request, res: Response) => {
  try {
    const { entityId } = req.params;
    const entityType = (req.query.entityType as string) || 'deal';

    const graph = await findRelatedEntities(entityId, entityType as any);

    res.json({
      success: true,
      entityId,
      entityType,
      relationshipGraph: {
        ...graph,
        relationshipStrength: Object.fromEntries(graph.relationshipStrength)
      },
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get entity relationships', { error: error.message });
    res.status(500).json({
      error: 'Failed to get entity relationships',
      message: error.message
    });
  }
});

/**
 * GET /api/correlation/deal/:dealId/map
 * Get complete correlation map for a deal
 */
router.get('/deal/:dealId/map', async (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;

    const correlationMap = await buildDealCorrelationMap(dealId);

    res.json({
      success: true,
      correlationMap: {
        ...correlationMap,
        fieldProvenance: Object.fromEntries(correlationMap.fieldProvenance)
      },
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to build correlation map', { error: error.message });
    res.status(500).json({
      error: 'Failed to build correlation map',
      message: error.message
    });
  }
});

/**
 * GET /api/correlation/lineage/:entityId
 * Get complete data lineage for an entity
 */
router.get('/lineage/:entityId', async (req: Request, res: Response) => {
  try {
    const { entityId } = req.params;
    const fieldName = req.query.fieldName as string;
    const entityType = (req.query.entityType as string) || 'deal';

    const lineage = await getDataLineage(entityId, fieldName, entityType as any);

    res.json({
      success: true,
      entityId,
      entityType,
      fieldName: fieldName || 'all',
      lineageCount: lineage.length,
      lineage,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get data lineage', { error: error.message });
    res.status(500).json({
      error: 'Failed to get data lineage',
      message: error.message
    });
  }
});

/**
 * GET /api/correlation/multi-source
 * List entities from multiple sources
 */
router.get('/multi-source', async (req: Request, res: Response) => {
  try {
    const entityType = (req.query.entityType as string) || 'deal';
    const minSources = parseInt(req.query.minSources as string) || 2;

    const result = await query(
      `SELECT * FROM multi_source_entities
       WHERE entity_type = $1 AND source_count >= $2
       ORDER BY source_count DESC
       LIMIT 50`,
      [entityType, minSources]
    );

    res.json({
      success: true,
      filters: { entityType, minSources },
      entitiesFound: result.rows.length,
      entities: result.rows,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get multi-source entities', { error: error.message });
    res.status(500).json({
      error: 'Failed to get multi-source entities',
      message: error.message
    });
  }
});

/**
 * POST /api/correlation/reconcile
 * Reconcile entity across sources
 */
router.post('/reconcile', async (req: Request, res: Response) => {
  try {
    const { entityType, correlationKey, sourceFileIds } = req.body;

    if (!entityType || !correlationKey || !Array.isArray(sourceFileIds)) {
      return res.status(400).json({
        error: 'entityType, correlationKey, and sourceFileIds array are required'
      });
    }

    const entityKey: EntityKey = { type: entityType, key: correlationKey };
    const reconciledEntity = await reconcileEntityAcrossSources(entityKey, sourceFileIds);

    if (!reconciledEntity) {
      return res.status(404).json({
        success: false,
        message: 'No entities found for reconciliation'
      });
    }

    res.json({
      success: true,
      reconciledEntity,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to reconcile entity', { error: error.message });
    res.status(500).json({
      error: 'Failed to reconcile entity',
      message: error.message
    });
  }
});

/**
 * POST /api/correlation/update-keys
 * Update correlation keys for entities
 */
router.post('/update-keys', async (req: Request, res: Response) => {
  try {
    const { entityType = 'deal' } = req.body;

    const result = await updateCorrelationKeys(entityType);

    res.json({
      success: true,
      entityType,
      updated: result.updated,
      errors: result.errors,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to update correlation keys', { error: error.message });
    res.status(500).json({
      error: 'Failed to update correlation keys',
      message: error.message
    });
  }
});

/**
 * POST /api/correlation/cross-source-duplicates
 * Find cross-source duplicates
 */
router.post('/cross-source-duplicates', async (req: Request, res: Response) => {
  try {
    const { sourceFileIds, entityType = 'deal' } = req.body;

    if (!Array.isArray(sourceFileIds) || sourceFileIds.length < 2) {
      return res.status(400).json({
        error: 'At least 2 source file IDs required'
      });
    }

    const duplicates = await findCrossSourceDuplicates(sourceFileIds, entityType);

    res.json({
      success: true,
      sourceFiles: sourceFileIds.length,
      entityType,
      duplicateGroups: duplicates.length,
      duplicates,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to find cross-source duplicates', { error: error.message });
    res.status(500).json({
      error: 'Failed to find cross-source duplicates',
      message: error.message
    });
  }
});

/**
 * GET /api/correlation/statistics
 * Get correlation statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM correlation_statistics');

    res.json({
      success: true,
      statistics: result.rows,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get correlation statistics', { error: error.message });
    res.status(500).json({
      error: 'Failed to get correlation statistics',
      message: error.message
    });
  }
});

// ============================================================================
// Quality Metrics Endpoints (Phase 6.4)
// ============================================================================

/**
 * GET /api/quality/score
 * Get overall data quality score
 */
router.get('/score', async (req: Request, res: Response) => {
  try {
    const entityType = (req.query.entityType as string) || 'deal';

    const qualityScore = await calculateDataQualityScore(entityType as any);

    res.json({
      success: true,
      entityType,
      qualityScore,
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

/**
 * GET /api/quality/duplicates-summary
 * Get duplicate statistics
 */
router.get('/duplicates-summary', async (req: Request, res: Response) => {
  try {
    const entityType = (req.query.entityType as string) || 'deal';

    const duplicateStats = await getDuplicateStatistics(entityType as any);

    res.json({
      success: true,
      entityType,
      duplicateStats,
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
 * GET /api/quality/issues
 * List data quality issues
 */
router.get('/issues', async (req: Request, res: Response) => {
  try {
    const entityType = (req.query.entityType as string) || 'deal';
    const severity = req.query.severity as string;
    const limit = parseInt(req.query.limit as string) || 50;

    let issues = await identifyQualityIssues(entityType as any, limit);

    // Filter by severity if provided
    if (severity) {
      issues = issues.filter(issue => issue.severity === severity);
    }

    const summary = {
      total: issues.length,
      critical: issues.filter(i => i.severity === 'critical').length,
      high: issues.filter(i => i.severity === 'high').length,
      medium: issues.filter(i => i.severity === 'medium').length,
      low: issues.filter(i => i.severity === 'low').length
    };

    res.json({
      success: true,
      entityType,
      filters: { severity: severity || 'all', limit },
      summary,
      issues,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get quality issues', { error: error.message });
    res.status(500).json({
      error: 'Failed to get quality issues',
      message: error.message
    });
  }
});

/**
 * GET /api/quality/report
 * Generate comprehensive quality report
 */
router.get('/report', async (req: Request, res: Response) => {
  try {
    const entityType = (req.query.entityType as string) || 'deal';
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const report = await generateQualityReport(
      { startDate, endDate },
      entityType as any
    );

    res.json({
      success: true,
      report,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to generate quality report', { error: error.message });
    res.status(500).json({
      error: 'Failed to generate quality report',
      message: error.message
    });
  }
});

/**
 * GET /api/quality/trends
 * Get quality metrics trends over time
 */
router.get('/trends', async (req: Request, res: Response) => {
  try {
    const entityType = (req.query.entityType as string) || 'deal';
    const days = parseInt(req.query.days as string) || 30;
    const metric = req.query.metric as string;

    const trends = await getQualityTrends(days, entityType as any);

    // Filter by specific metric if requested
    let filteredTrends = trends;
    if (metric && metric !== 'overall') {
      filteredTrends = trends.map(t => ({
        date: t.date,
        value: (t as any)[metric] || 0
      })) as any;
    }

    res.json({
      success: true,
      entityType,
      period: `Last ${days} days`,
      metric: metric || 'all',
      dataPoints: filteredTrends.length,
      trends: filteredTrends,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get quality trends', { error: error.message });
    res.status(500).json({
      error: 'Failed to get quality trends',
      message: error.message
    });
  }
});

/**
 * GET /api/quality/dashboard
 * Get comprehensive dashboard data
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const entityType = (req.query.entityType as string) || 'deal';

    // Get all key metrics in parallel
    const [qualityScore, duplicateStats, issues] = await Promise.all([
      calculateDataQualityScore(entityType as any),
      getDuplicateStatistics(entityType as any),
      identifyQualityIssues(entityType as any, 20)
    ]);

    // Get recent activity
    const recentActivity = await query(
      `SELECT * FROM recent_merge_activity LIMIT 10`
    );

    // Get correlation stats
    const correlationStats = await query(
      'SELECT * FROM correlation_statistics'
    );

    const dashboard = {
      qualityScore,
      duplicateStats,
      topIssues: issues.slice(0, 10),
      issuesSummary: {
        critical: issues.filter(i => i.severity === 'critical').length,
        high: issues.filter(i => i.severity === 'high').length,
        medium: issues.filter(i => i.severity === 'medium').length,
        low: issues.filter(i => i.severity === 'low').length,
        total: issues.length
      },
      recentActivity: recentActivity.rows,
      correlationStats: correlationStats.rows
    };

    res.json({
      success: true,
      entityType,
      dashboard,
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Failed to get dashboard data', { error: error.message });
    res.status(500).json({
      error: 'Failed to get dashboard data',
      message: error.message
    });
  }
});

export default router;
