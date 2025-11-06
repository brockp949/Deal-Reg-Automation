/**
 * Vendor Import API Routes
 * Handles uploading and importing vendor lists from Excel/CSV
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { parseVendorFile } from '../parsers/vendorImporter';
import { importAndMergeVendors, getAllVendorDomains } from '../services/vendorIntelligence';
import { addVendorImportJob, getVendorImportJobStatus } from '../queues/vendorImportQueue';
import logger from '../utils/logger';

const router = Router();

// Configure multer for vendor file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `vendor-import-${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for vendor files
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
 * POST /api/vendors/import
 * Upload and import vendor list (async with progress tracking)
 */
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const filePath = req.file.path;
    logger.info('Vendor import file uploaded', {
      filename: req.file.originalname,
      size: req.file.size,
      path: filePath,
    });

    // Add to queue for async processing
    const job = await addVendorImportJob(filePath, req.file.originalname);

    return res.json({
      success: true,
      message: 'Vendor import queued successfully',
      jobId: job.id,
      checkStatusUrl: `/api/vendors/import/${job.id}/status`,
    });

  } catch (error: any) {
    logger.error('Failed to queue vendor import', {
      error: error.message,
      stack: error.stack,
    });

    // Clean up file if it exists
    if (req.file) {
      await unlink(req.file.path).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to queue vendor import',
      details: error.message,
    });
  }
});

/**
 * GET /api/vendors/import/:jobId/status
 * Check the status and progress of a vendor import job
 */
router.get('/import/:jobId/status', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const status = await getVendorImportJobStatus(jobId);

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
        filename: status.data.originalFilename,
        result: status.result,
        failedReason: status.failedReason,
        attemptsMade: status.attemptsMade,
        processedOn: status.processedOn,
        finishedOn: status.finishedOn,
      },
    });

  } catch (error: any) {
    logger.error('Failed to get vendor import status', {
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve import status',
      details: error.message,
    });
  }
});

/**
 * GET /api/vendors/domains
 * Get list of all known vendor domains for filtering
 */
router.get('/domains', async (req: Request, res: Response) => {
  try {
    const domains = await getAllVendorDomains();

    return res.json({
      success: true,
      domains,
      count: domains.length,
    });

  } catch (error: any) {
    logger.error('Failed to get vendor domains', {
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve vendor domains',
      details: error.message,
    });
  }
});

/**
 * POST /api/vendors/preview-import
 * Preview vendor import without saving to database
 */
router.post('/preview-import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const filePath = req.file.path;

    // Parse the vendor file
    const parseResult = await parseVendorFile(filePath);

    // Clean up file
    await unlink(filePath).catch(() => {});

    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to parse vendor file',
        details: parseResult.errors,
      });
    }

    // Return preview without importing
    return res.json({
      success: true,
      preview: {
        totalRows: parseResult.totalRows,
        successCount: parseResult.successCount,
        errorCount: parseResult.errorCount,
        duplicates: parseResult.duplicates,
        vendors: parseResult.vendors.slice(0, 10), // First 10 for preview
        errors: parseResult.errors.slice(0, 10), // First 10 errors
      },
    });

  } catch (error: any) {
    logger.error('Vendor preview failed', {
      error: error.message,
    });

    if (req.file) {
      await unlink(req.file.path).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      error: 'Preview failed',
      details: error.message,
    });
  }
});

export default router;
