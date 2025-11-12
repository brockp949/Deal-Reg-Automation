/**
 * Error Tracking API Routes
 *
 * Provides endpoints for querying and managing error logs.
 */

import express, { Request, Response } from 'express';
import {
  getErrorById,
  getErrorsByFile,
  getErrorsByCategorySeverity,
  getUnresolvedErrors,
  getRecentErrors,
  getErrorStatistics,
  getErrorCountsByCategory,
  resolveError,
  bulkResolveErrors,
  ErrorCategory,
  ErrorSeverity,
} from '../services/errorTrackingService';
import logger from '../utils/logger';

const router = express.Router();

// ============================================================================
// GET /api/errors/:id
// Get error details by ID
// ============================================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const error = await getErrorById(id);

    if (!error) {
      return res.status(404).json({
        success: false,
        error: 'Error not found',
      });
    }

    res.json({
      success: true,
      data: error,
    });
  } catch (error: any) {
    logger.error('Failed to fetch error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch error details',
    });
  }
});

// ============================================================================
// GET /api/errors
// Query errors with filters
// ============================================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      category,
      severity,
      file_id,
      unresolved_only,
      days,
      limit = '100',
    } = req.query;

    let errors;

    // Query by specific file
    if (file_id) {
      errors = await getErrorsByFile(file_id as string);
    }
    // Query unresolved errors
    else if (unresolved_only === 'true') {
      errors = await getUnresolvedErrors(parseInt(limit as string, 10));
    }
    // Query by category/severity
    else if (category) {
      errors = await getErrorsByCategorySeverity(
        category as ErrorCategory,
        severity as ErrorSeverity | undefined,
        parseInt(limit as string, 10)
      );
    }
    // Query recent errors
    else if (days) {
      errors = await getRecentErrors(parseInt(days as string, 10), parseInt(limit as string, 10));
    }
    // Default: recent errors (last 7 days)
    else {
      errors = await getRecentErrors(7, parseInt(limit as string, 10));
    }

    res.json({
      success: true,
      data: errors,
      count: errors.length,
    });
  } catch (error: any) {
    logger.error('Failed to fetch errors', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch errors',
    });
  }
});

// ============================================================================
// GET /api/errors/statistics/summary
// Get error statistics summary
// ============================================================================
router.get('/statistics/summary', async (req: Request, res: Response) => {
  try {
    const [statistics, categoryCounts] = await Promise.all([
      getErrorStatistics(),
      getErrorCountsByCategory(),
    ]);

    res.json({
      success: true,
      data: {
        statistics,
        categoryCounts,
      },
    });
  } catch (error: any) {
    logger.error('Failed to fetch error statistics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch error statistics',
    });
  }
});

// ============================================================================
// GET /api/errors/file/:fileId
// Get all errors for a specific file
// ============================================================================
router.get('/file/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;

    const errors = await getErrorsByFile(fileId);

    res.json({
      success: true,
      data: errors,
      count: errors.length,
    });
  } catch (error: any) {
    logger.error('Failed to fetch file errors', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch file errors',
    });
  }
});

// ============================================================================
// GET /api/errors/category/:category
// Get errors by category
// ============================================================================
router.get('/category/:category', async (req: Request, res: Response) => {
  try {
    const { category } = req.params;
    const { severity, limit = '100' } = req.query;

    const errors = await getErrorsByCategorySeverity(
      category as ErrorCategory,
      severity as ErrorSeverity | undefined,
      parseInt(limit as string, 10)
    );

    res.json({
      success: true,
      data: errors,
      count: errors.length,
    });
  } catch (error: any) {
    logger.error('Failed to fetch errors by category', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch errors by category',
    });
  }
});

// ============================================================================
// PATCH /api/errors/:id/resolve
// Resolve a specific error
// ============================================================================
router.patch('/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { resolved_by, resolution_notes } = req.body;

    if (!resolved_by) {
      return res.status(400).json({
        success: false,
        error: 'resolved_by is required',
      });
    }

    await resolveError(id, resolved_by, resolution_notes);

    res.json({
      success: true,
      message: 'Error resolved successfully',
    });
  } catch (error: any) {
    logger.error('Failed to resolve error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to resolve error',
    });
  }
});

// ============================================================================
// POST /api/errors/bulk-resolve
// Bulk resolve errors
// ============================================================================
router.post('/bulk-resolve', async (req: Request, res: Response) => {
  try {
    const { error_type, source_file_id, resolved_by, resolution_notes } = req.body;

    if (!resolved_by) {
      return res.status(400).json({
        success: false,
        error: 'resolved_by is required',
      });
    }

    const count = await bulkResolveErrors({
      errorType: error_type,
      sourceFileId: source_file_id,
      resolvedBy: resolved_by,
      resolutionNotes: resolution_notes,
    });

    res.json({
      success: true,
      message: `${count} errors resolved successfully`,
      count,
    });
  } catch (error: any) {
    logger.error('Failed to bulk resolve errors', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to bulk resolve errors',
    });
  }
});

export default router;
