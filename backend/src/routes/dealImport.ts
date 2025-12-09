/**
 * Deal Import API Routes
 * Handles uploading and importing deals for a specific vendor from Excel/CSV
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { unlink } from 'fs/promises';
import { parseDealFile } from '../parsers/dealImporter';
import { addDealImportJob, getDealImportJobStatus } from '../queues/dealImportQueue';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router({ mergeParams: true });

// Configure multer for deal file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `deal-import-${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for deal files
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls', '.csv'];
    const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV files are allowed'));
    }
  },
});

/**
 * Validate vendor exists middleware
 */
async function validateVendor(req: Request, res: Response, next: () => void) {
  const { vendorId } = req.params;

  if (!vendorId) {
    return res.status(400).json({
      success: false,
      error: 'Vendor ID is required',
    });
  }

  try {
    const vendorResult = await query('SELECT id, name FROM vendors WHERE id = $1', [vendorId]);

    if (vendorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found',
      });
    }

    // Attach vendor to request for later use
    (req as any).vendor = vendorResult.rows[0];
    next();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to validate vendor', { vendorId, error: message });
    return res.status(500).json({
      success: false,
      error: 'Failed to validate vendor',
    });
  }
}

/**
 * POST /api/vendors/:vendorId/deals/import
 * Upload and import deals for a specific vendor (async with progress tracking)
 */
router.post('/import', validateVendor, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const { vendorId } = req.params;
    const vendor = (req as any).vendor;
    const filePath = req.file.path;

    logger.info('Deal import file uploaded', {
      vendorId,
      vendorName: vendor.name,
      filename: req.file.originalname,
      size: req.file.size,
      path: filePath,
    });

    // Add to queue for async processing
    const job = await addDealImportJob(filePath, req.file.originalname, vendorId);

    return res.json({
      success: true,
      message: 'Deal import queued successfully',
      vendorId,
      vendorName: vendor.name,
      jobId: job.id,
      checkStatusUrl: `/api/vendors/${vendorId}/deals/import/${job.id}/status`,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to queue deal import', {
      error: message,
    });

    // Clean up file if it exists
    if (req.file) {
      await unlink(req.file.path).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to queue deal import',
      details: message,
    });
  }
});

/**
 * GET /api/vendors/:vendorId/deals/import/:jobId/status
 * Check the status and progress of a deal import job
 */
router.get('/import/:jobId/status', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const status = await getDealImportJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Import job not found',
      });
    }

    return res.json({
      success: true,
      data: {
        jobId: status.id,
        state: status.state,
        progress: status.progress,
        vendorId: status.data.vendorId,
        filename: status.data.originalFilename,
        result: status.result,
        failedReason: status.failedReason,
        attemptsMade: status.attemptsMade,
        processedOn: status.processedOn,
        finishedOn: status.finishedOn,
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get deal import status', {
      error: message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve import status',
      details: message,
    });
  }
});

/**
 * POST /api/vendors/:vendorId/deals/preview-import
 * Preview deal import without saving to database
 */
router.post('/preview-import', validateVendor, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const vendor = (req as any).vendor;
    const filePath = req.file.path;

    // Parse the deal file
    const parseResult = await parseDealFile(filePath);

    // Clean up file
    await unlink(filePath).catch(() => {});

    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to parse deal file',
        details: parseResult.errors,
      });
    }

    // Return preview without importing
    return res.json({
      success: true,
      vendorId: vendor.id,
      vendorName: vendor.name,
      preview: {
        totalRows: parseResult.totalRows,
        successCount: parseResult.successCount,
        errorCount: parseResult.errorCount,
        duplicates: parseResult.duplicates,
        deals: parseResult.deals.slice(0, 10), // First 10 for preview
        errors: parseResult.errors.slice(0, 10), // First 10 errors
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Deal preview failed', {
      error: message,
    });

    if (req.file) {
      await unlink(req.file.path).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      error: 'Preview failed',
      details: message,
    });
  }
});

export default router;
