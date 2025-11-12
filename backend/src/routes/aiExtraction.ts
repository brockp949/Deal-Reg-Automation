import { Router, Request, Response } from 'express';
import {
  extractEntitiesWithAI,
  extractDealsFromText,
  extractVendorsFromText,
  extractContactsFromText,
  extractDealValue,
  getAIUsageStats,
  clearAICache,
} from '../services/aiExtraction';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/ai/extract
 * Manual AI extraction for testing and ad-hoc analysis
 */
router.post('/extract', async (req: Request, res: Response) => {
  try {
    const { text, extractionType = 'all', context } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Text field is required and must be a string',
      });
    }

    if (text.length < 10) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Text must be at least 10 characters long',
      });
    }

    if (text.length > 100000) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Text exceeds maximum length of 100,000 characters',
      });
    }

    const validTypes = ['all', 'deal', 'vendor', 'contact'];
    if (!validTypes.includes(extractionType)) {
      return res.status(400).json({
        error: 'Invalid extraction type',
        message: `Extraction type must be one of: ${validTypes.join(', ')}`,
      });
    }

    logger.info('Manual AI extraction requested', {
      extractionType,
      textLength: text.length,
      hasContext: !!context,
    });

    const result = await extractEntitiesWithAI(text, extractionType, context);

    res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    logger.error('AI extraction failed', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Extraction failed',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/extract/deals
 * Extract only deals from text
 */
router.post('/extract/deals', async (req: Request, res: Response) => {
  try {
    const { text, context } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Text field is required',
      });
    }

    const deals = await extractDealsFromText(text, context);

    res.json({
      success: true,
      deals,
      count: deals.length,
    });
  } catch (error: any) {
    logger.error('Deal extraction failed', { error: error.message });
    res.status(500).json({
      error: 'Deal extraction failed',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/extract/vendors
 * Extract only vendors from text
 */
router.post('/extract/vendors', async (req: Request, res: Response) => {
  try {
    const { text, context } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Text field is required',
      });
    }

    const vendors = await extractVendorsFromText(text, context);

    res.json({
      success: true,
      vendors,
      count: vendors.length,
    });
  } catch (error: any) {
    logger.error('Vendor extraction failed', { error: error.message });
    res.status(500).json({
      error: 'Vendor extraction failed',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/extract/contacts
 * Extract only contacts from text
 */
router.post('/extract/contacts', async (req: Request, res: Response) => {
  try {
    const { text, context } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Text field is required',
      });
    }

    const contacts = await extractContactsFromText(text, context);

    res.json({
      success: true,
      contacts,
      count: contacts.length,
    });
  } catch (error: any) {
    logger.error('Contact extraction failed', { error: error.message });
    res.status(500).json({
      error: 'Contact extraction failed',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/extract/value
 * Extract deal value from text
 */
router.post('/extract/value', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Text field is required',
      });
    }

    const value = await extractDealValue(text);

    if (!value) {
      return res.json({
        success: true,
        value: null,
        message: 'No deal value found in text',
      });
    }

    res.json({
      success: true,
      value,
    });
  } catch (error: any) {
    logger.error('Value extraction failed', { error: error.message });
    res.status(500).json({
      error: 'Value extraction failed',
      message: error.message,
    });
  }
});

/**
 * GET /api/ai/usage
 * Get AI usage statistics
 */
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, extractionType } = req.query;

    const stats = await getAIUsageStats({
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      extractionType: extractionType as string | undefined,
    });

    // Also get summary stats
    const summaryResult = await query(`
      SELECT
        SUM(total_requests) AS total_requests,
        SUM(total_tokens) AS total_tokens,
        SUM(cache_hits) AS total_cache_hits,
        ROUND(AVG(average_confidence)::numeric, 2) AS avg_confidence,
        ROUND(AVG(success_rate)::numeric, 2) AS avg_success_rate
      FROM ai_usage_stats
      WHERE 1=1
        ${startDate ? `AND date >= '${startDate}'` : ''}
        ${endDate ? `AND date <= '${endDate}'` : ''}
        ${extractionType ? `AND extraction_type = '${extractionType}'` : ''}
    `);

    const summary = summaryResult.rows[0] || {};

    res.json({
      success: true,
      summary: {
        totalRequests: parseInt(summary.total_requests || '0', 10),
        totalTokens: parseInt(summary.total_tokens || '0', 10),
        totalCacheHits: parseInt(summary.total_cache_hits || '0', 10),
        averageConfidence: parseFloat(summary.avg_confidence || '0'),
        averageSuccessRate: parseFloat(summary.avg_success_rate || '0'),
        cacheHitRate: summary.total_requests > 0
          ? (summary.total_cache_hits / summary.total_requests).toFixed(2)
          : '0.00',
      },
      dailyStats: stats,
    });
  } catch (error: any) {
    logger.error('Failed to get AI usage stats', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve usage statistics',
      message: error.message,
    });
  }
});

/**
 * GET /api/ai/logs/:id
 * Get specific extraction log details
 */
router.get('/logs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT
        ael.*,
        sf.filename AS source_filename,
        sf.file_type AS source_file_type
       FROM ai_extraction_logs ael
       LEFT JOIN source_files sf ON ael.source_file_id = sf.id
       WHERE ael.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `Extraction log ${id} not found`,
      });
    }

    res.json({
      success: true,
      log: result.rows[0],
    });
  } catch (error: any) {
    logger.error('Failed to get extraction log', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve extraction log',
      message: error.message,
    });
  }
});

/**
 * GET /api/ai/logs
 * List extraction logs with filtering
 */
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const {
      sourceFileId,
      extractionType,
      success,
      limit = '50',
      offset = '0',
    } = req.query;

    let queryText = `
      SELECT
        ael.id,
        ael.extraction_type,
        ael.ai_model,
        ael.prompt_version,
        ael.tokens_used,
        ael.extraction_time_ms,
        ael.confidence_score,
        ael.success,
        ael.error_message,
        ael.created_at,
        sf.filename AS source_filename,
        sf.file_type AS source_file_type,
        jsonb_array_length(ael.extracted_entities) AS entities_count
      FROM ai_extraction_logs ael
      LEFT JOIN source_files sf ON ael.source_file_id = sf.id
      WHERE 1=1
    `;

    const queryParams: any[] = [];
    let paramCount = 1;

    if (sourceFileId) {
      queryText += ` AND ael.source_file_id = $${paramCount}`;
      queryParams.push(sourceFileId);
      paramCount++;
    }

    if (extractionType) {
      queryText += ` AND ael.extraction_type = $${paramCount}`;
      queryParams.push(extractionType);
      paramCount++;
    }

    if (success !== undefined) {
      queryText += ` AND ael.success = $${paramCount}`;
      queryParams.push(success === 'true');
      paramCount++;
    }

    queryText += ` ORDER BY ael.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    queryParams.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

    const result = await query(queryText, queryParams);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM ai_extraction_logs ael WHERE 1=1';
    const countParams: any[] = [];
    let countParamNum = 1;

    if (sourceFileId) {
      countQuery += ` AND ael.source_file_id = $${countParamNum}`;
      countParams.push(sourceFileId);
      countParamNum++;
    }

    if (extractionType) {
      countQuery += ` AND ael.extraction_type = $${countParamNum}`;
      countParams.push(extractionType);
      countParamNum++;
    }

    if (success !== undefined) {
      countQuery += ` AND ael.success = $${countParamNum}`;
      countParams.push(success === 'true');
    }

    const countResult = await query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    res.json({
      success: true,
      logs: result.rows,
      pagination: {
        total: totalCount,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        hasMore: totalCount > parseInt(offset as string, 10) + result.rows.length,
      },
    });
  } catch (error: any) {
    logger.error('Failed to list extraction logs', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve extraction logs',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/reprocess/:sourceFileId
 * Reprocess a file with AI extraction
 */
router.post('/reprocess/:sourceFileId', async (req: Request, res: Response) => {
  try {
    const { sourceFileId } = req.params;

    // Get source file
    const fileResult = await query(
      'SELECT id, filename, file_type, file_path FROM source_files WHERE id = $1',
      [sourceFileId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `Source file ${sourceFileId} not found`,
      });
    }

    // TODO: Implement reprocessing queue
    // For now, return a placeholder response

    res.json({
      success: true,
      message: 'Reprocessing queued (feature not yet implemented)',
      sourceFileId,
    });
  } catch (error: any) {
    logger.error('Failed to queue reprocessing', { error: error.message });
    res.status(500).json({
      error: 'Failed to queue reprocessing',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/ai/cache
 * Clear AI extraction cache
 */
router.delete('/cache', async (req: Request, res: Response) => {
  try {
    const deletedCount = await clearAICache();

    logger.info('AI cache cleared', { deletedCount });

    res.json({
      success: true,
      message: `Cleared ${deletedCount} cache entries`,
      deletedCount,
    });
  } catch (error: any) {
    logger.error('Failed to clear AI cache', { error: error.message });
    res.status(500).json({
      error: 'Failed to clear cache',
      message: error.message,
    });
  }
});

/**
 * GET /api/ai/stats/summary
 * Get summary statistics from views
 */
router.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    // Get extraction stats
    const extractionStats = await query('SELECT * FROM ai_extraction_stats_summary');

    // Get cache effectiveness
    const cacheStats = await query('SELECT * FROM ai_cache_effectiveness');

    // Get recent extractions
    const recentExtractions = await query('SELECT * FROM recent_ai_extractions LIMIT 10');

    res.json({
      success: true,
      extractionStats: extractionStats.rows,
      cacheStats: cacheStats.rows,
      recentExtractions: recentExtractions.rows,
    });
  } catch (error: any) {
    logger.error('Failed to get stats summary', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve statistics summary',
      message: error.message,
    });
  }
});

export default router;
