/**
 * Vendor Matching API Routes
 * Phase 5: Advanced Vendor Matching & Association
 *
 * Endpoints for testing and managing vendor matching
 */

import express, { Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import * as vendorMatcher from '../services/vendorMatcher';
import pool from '../db';

const router = express.Router();

// ============================================================================
// Validation Middleware
// ============================================================================

const handleValidationErrors = (req: Request, res: Response): boolean => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, errors: errors.array() });
    return true;
  }
  return false;
};

// ============================================================================
// Vendor Matching Endpoints
// ============================================================================

/**
 * POST /api/vendor-matching/match
 * Test vendor matching with various inputs
 */
router.post(
  '/match',
  [
    body('extractedName').optional().isString().trim(),
    body('emailDomain').optional().isString().trim(),
    body('contactEmail').optional().isEmail(),
    body('productMentions').optional().isArray(),
    body('keywords').optional().isArray(),
    body('sourceText').optional().isString(),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const context = {
        extractedName: req.body.extractedName,
        emailDomain: req.body.emailDomain,
        contactEmail: req.body.contactEmail,
        productMentions: req.body.productMentions,
        keywords: req.body.keywords,
        sourceText: req.body.sourceText,
      };

      const result = await vendorMatcher.matchVendor(context);

      // Log the match attempt
      if (result.matched && result.vendor) {
        await pool.query(
          `SELECT log_vendor_match($1, $2, $3, $4, $5::jsonb)`,
          [
            context.extractedName || 'unknown',
            result.vendor.id,
            result.matchStrategy,
            result.confidence,
            JSON.stringify(result.matchDetails || {}),
          ]
        );
      } else if (context.extractedName) {
        await pool.query(
          `SELECT log_unmatched_vendor($1)`,
          [context.extractedName]
        );
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('Vendor matching error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to match vendor',
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/vendor-matching/match-multiple
 * Match multiple vendor names from a list
 */
router.post(
  '/match-multiple',
  [body('vendorNames').isArray().notEmpty()],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { vendorNames, context } = req.body;

      const results = await vendorMatcher.matchMultipleVendors(vendorNames, context);

      res.json({
        success: true,
        data: {
          matches: results,
          totalProcessed: vendorNames.length,
          matched: results.filter((r) => r.matched).length,
          unmatched: results.filter((r) => !r.matched).length,
        },
      });
    } catch (error: any) {
      console.error('Multiple vendor matching error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to match vendors',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/vendor-matching/test
 * Quick test endpoint for vendor matching
 * Usage: GET /api/vendor-matching/test?name=Acme%20Corp
 */
router.get(
  '/test',
  [query('name').optional().isString().trim()],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { name, email, product } = req.query;

      const context: any = {};
      if (name) context.extractedName = name as string;
      if (email) context.contactEmail = email as string;
      if (product) context.productMentions = [product as string];

      const result = await vendorMatcher.matchVendor(context);

      res.json({
        success: true,
        data: result,
        query: { name, email, product },
      });
    } catch (error: any) {
      console.error('Vendor matching test error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to test vendor matching',
        message: error.message,
      });
    }
  }
);

// ============================================================================
// Vendor Alias Management
// ============================================================================

/**
 * POST /api/vendor-matching/aliases
 * Add a new vendor alias
 */
router.post(
  '/aliases',
  [
    body('vendorId').isUUID(),
    body('alias').isString().trim().notEmpty(),
    body('aliasType')
      .isIn(['abbreviation', 'subsidiary', 'product', 'domain', 'nickname'])
      .withMessage('Invalid alias type'),
    body('confidence').optional().isFloat({ min: 0, max: 1 }),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { vendorId, alias, aliasType, confidence } = req.body;

      const newAlias = await vendorMatcher.addVendorAlias(
        vendorId,
        alias,
        aliasType,
        confidence || 1.0
      );

      res.status(201).json({
        success: true,
        data: newAlias,
        message: 'Vendor alias added successfully',
      });
    } catch (error: any) {
      console.error('Add vendor alias error:', error);

      if (error.code === '23505') {
        // Unique constraint violation
        res.status(409).json({
          success: false,
          error: 'Alias already exists for this vendor',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to add vendor alias',
          message: error.message,
        });
      }
    }
  }
);

/**
 * GET /api/vendor-matching/aliases/:vendorId
 * Get all aliases for a vendor
 */
router.get(
  '/aliases/:vendorId',
  [param('vendorId').isUUID()],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { vendorId } = req.params;

      const aliases = await vendorMatcher.getVendorAliases(vendorId);

      res.json({
        success: true,
        data: {
          vendorId,
          aliases,
          count: aliases.length,
        },
      });
    } catch (error: any) {
      console.error('Get vendor aliases error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get vendor aliases',
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /api/vendor-matching/aliases/:aliasId
 * Remove a vendor alias
 */
router.delete(
  '/aliases/:aliasId',
  [param('aliasId').isUUID()],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { aliasId } = req.params;

      const removed = await vendorMatcher.removeVendorAlias(aliasId);

      if (removed) {
        res.json({
          success: true,
          message: 'Vendor alias removed successfully',
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Vendor alias not found',
        });
      }
    } catch (error: any) {
      console.error('Remove vendor alias error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove vendor alias',
        message: error.message,
      });
    }
  }
);

// ============================================================================
// Unmatched Vendor Names
// ============================================================================

/**
 * GET /api/vendor-matching/unmatched
 * Get list of unmatched vendor names
 */
router.get('/unmatched', async (req: Request, res: Response) => {
  try {
    const { limit = 50, status = 'pending' } = req.query;

    const result = await pool.query(
      `SELECT * FROM top_unmatched_vendors
       WHERE resolution_status = $1
       LIMIT $2`,
      [status, limit]
    );

    res.json({
      success: true,
      data: {
        unmatchedNames: result.rows,
        count: result.rows.length,
      },
    });
  } catch (error: any) {
    console.error('Get unmatched vendors error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get unmatched vendor names',
      message: error.message,
    });
  }
});

/**
 * GET /api/vendor-matching/suggest-aliases/:unmatchedName
 * Suggest potential vendor matches for an unmatched name
 */
router.get(
  '/suggest-aliases/:unmatchedName',
  [param('unmatchedName').isString().trim().notEmpty()],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { unmatchedName } = req.params;

      const suggestions = await vendorMatcher.suggestAliases(unmatchedName);

      res.json({
        success: true,
        data: {
          unmatchedName,
          suggestions,
          count: suggestions.length,
        },
      });
    } catch (error: any) {
      console.error('Suggest aliases error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to suggest aliases',
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/vendor-matching/unmatched/:id/resolve
 * Resolve an unmatched vendor name by linking to a vendor
 */
router.post(
  '/unmatched/:id/resolve',
  [param('id').isUUID(), body('vendorId').isUUID()],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { id } = req.params;
      const { vendorId } = req.body;

      // Get the unmatched name
      const unmatchedResult = await pool.query(
        `SELECT * FROM unmatched_vendor_names WHERE id = $1`,
        [id]
      );

      if (unmatchedResult.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Unmatched vendor name not found',
        });
        return;
      }

      const unmatchedName = unmatchedResult.rows[0];

      // Create an alias
      await vendorMatcher.addVendorAlias(
        vendorId,
        unmatchedName.extracted_name,
        'nickname',
        0.90
      );

      // Mark as resolved
      await pool.query(
        `UPDATE unmatched_vendor_names
         SET
           resolution_status = 'resolved',
           resolved_at = CURRENT_TIMESTAMP,
           resolved_to_vendor_id = $1
         WHERE id = $2`,
        [vendorId, id]
      );

      res.json({
        success: true,
        message: 'Unmatched vendor name resolved and alias created',
      });
    } catch (error: any) {
      console.error('Resolve unmatched vendor error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to resolve unmatched vendor name',
        message: error.message,
      });
    }
  }
);

// ============================================================================
// Vendor Inference
// ============================================================================

/**
 * POST /api/vendor-matching/infer-from-contact
 * Infer vendor from contact email domain
 */
router.post(
  '/infer-from-contact',
  [body('contactEmail').isEmail()],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { contactEmail } = req.body;

      const result = await vendorMatcher.inferVendorFromContact(contactEmail);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('Infer vendor from contact error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to infer vendor from contact',
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/vendor-matching/infer-from-products
 * Infer vendor from product mentions
 */
router.post(
  '/infer-from-products',
  [body('products').isArray().notEmpty()],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { products } = req.body;

      const result = await vendorMatcher.inferVendorFromProducts(products);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('Infer vendor from products error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to infer vendor from products',
        message: error.message,
      });
    }
  }
);

// ============================================================================
// Learning and Statistics
// ============================================================================

/**
 * POST /api/vendor-matching/learn-patterns
 * Trigger learning of vendor patterns from historical data
 */
router.post('/learn-patterns', async (req: Request, res: Response) => {
  try {
    const result = await vendorMatcher.learnVendorPatterns();

    res.json({
      success: true,
      data: result,
      message: `Learned ${result.patternsLearned} patterns and created ${result.aliasesCreated} new aliases`,
    });
  } catch (error: any) {
    console.error('Learn vendor patterns error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to learn vendor patterns',
      message: error.message,
    });
  }
});

/**
 * GET /api/vendor-matching/statistics
 * Get vendor matching statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const { days = 30 } = req.query;

    // Get statistics from service
    const matchingStats = await vendorMatcher.getMatchingStatistics();

    // Get statistics from database
    const dbStats = await pool.query(`SELECT * FROM get_vendor_matching_stats($1)`, [days]);

    // Get strategy effectiveness
    const strategyStats = await pool.query(`SELECT * FROM matching_strategy_stats`);

    // Get alias statistics
    const aliasStats = await pool.query(
      `SELECT
        COUNT(*) as total_aliases,
        SUM(usage_count) as total_uses,
        AVG(confidence) as avg_confidence
       FROM vendor_aliases`
    );

    res.json({
      success: true,
      data: {
        period: `Last ${days} days`,
        matching: {
          ...matchingStats,
          ...dbStats.rows[0],
        },
        strategies: strategyStats.rows,
        aliases: aliasStats.rows[0],
      },
    });
  } catch (error: any) {
    console.error('Get matching statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get matching statistics',
      message: error.message,
    });
  }
});

/**
 * GET /api/vendor-matching/performance
 * Get daily matching performance metrics
 */
router.get('/performance', async (req: Request, res: Response) => {
  try {
    const { days = 30 } = req.query;

    const result = await pool.query(
      `SELECT * FROM vendor_matching_performance
       WHERE match_date >= CURRENT_DATE - $1 * INTERVAL '1 day'
       ORDER BY match_date DESC`,
      [days]
    );

    res.json({
      success: true,
      data: {
        period: `Last ${days} days`,
        performance: result.rows,
      },
    });
  } catch (error: any) {
    console.error('Get matching performance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get matching performance',
      message: error.message,
    });
  }
});

// ============================================================================
// Export Router
// ============================================================================

export default router;
