/**
 * Deal Import API Routes
 * Handles uploading and importing deals for a specific vendor from Excel/CSV
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { unlink } from 'fs/promises';
import { parseDealFile } from '../parsers/dealImporter';
import { parseVendorSpreadsheet, extractVendorFromFilename } from '../parsers/vendorSpreadsheetParser';
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

/**
 * POST /api/vendors/:vendorId/deals/spreadsheet/extract-vendor
 * Extract vendor name from filename and return suggestions
 */
router.post('/spreadsheet/extract-vendor', async (req: Request, res: Response) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({
        success: false,
        error: 'Filename is required',
      });
    }

    const extractedVendor = extractVendorFromFilename(filename);

    // Search for matching vendors
    let matchingVendors: Array<{ id: string; name: string; matchType: string }> = [];

    if (extractedVendor) {
      // Exact match
      const exactResult = await query(
        'SELECT id, name FROM vendors WHERE LOWER(name) = LOWER($1)',
        [extractedVendor]
      );

      if (exactResult.rows.length > 0) {
        matchingVendors = exactResult.rows.map(v => ({
          id: v.id,
          name: v.name,
          matchType: 'exact',
        }));
      } else {
        // Similar matches
        const similarResult = await query(
          `SELECT id, name FROM vendors
           WHERE LOWER(name) LIKE LOWER($1)
           OR LOWER($2) LIKE '%' || LOWER(name) || '%'
           LIMIT 5`,
          [`%${extractedVendor}%`, extractedVendor]
        );

        matchingVendors = similarResult.rows.map(v => ({
          id: v.id,
          name: v.name,
          matchType: 'similar',
        }));
      }
    }

    return res.json({
      success: true,
      data: {
        extractedVendorName: extractedVendor,
        matchingVendors,
        canCreateNew: extractedVendor ? true : false,
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to extract vendor from filename', { error: message });
    return res.status(500).json({
      success: false,
      error: 'Failed to extract vendor',
      details: message,
    });
  }
});

/**
 * POST /api/vendors/:vendorId/deals/spreadsheet/preview
 * Preview vendor spreadsheet without saving to database
 */
router.post('/spreadsheet/preview', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const filePath = req.file.path;
    const originalFilename = req.file.originalname;

    // Parse the vendor spreadsheet
    const parseResult = await parseVendorSpreadsheet(filePath);

    // Extract vendor name from filename
    const extractedVendor = extractVendorFromFilename(originalFilename);

    // Clean up file
    await unlink(filePath).catch(() => {});

    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to parse spreadsheet',
        details: parseResult.errors,
      });
    }

    // Search for matching vendor
    let matchingVendors: Array<{ id: string; name: string; matchType: string }> = [];
    if (extractedVendor) {
      const vendorResult = await query(
        'SELECT id, name FROM vendors WHERE LOWER(name) = LOWER($1)',
        [extractedVendor]
      );
      if (vendorResult.rows.length > 0) {
        matchingVendors = vendorResult.rows.map(v => ({
          id: v.id,
          name: v.name,
          matchType: 'exact',
        }));
      }
    }

    return res.json({
      success: true,
      data: {
        extractedVendorName: extractedVendor || parseResult.vendorNameFromFile,
        matchingVendors,
        preview: {
          totalRows: parseResult.totalRows,
          successCount: parseResult.successCount,
          errorCount: parseResult.errorCount,
          deals: parseResult.deals,
          errors: parseResult.errors,
          warnings: parseResult.warnings,
        },
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to preview spreadsheet', { error: message });

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

/**
 * POST /api/vendors/:vendorId/deals/spreadsheet/import
 * Import deals from vendor spreadsheet with vendor creation/selection
 */
router.post('/spreadsheet/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const { vendorId, vendorName, createNewVendor } = req.body;
    const filePath = req.file.path;
    const originalFilename = req.file.originalname;

    let targetVendorId = vendorId;
    let targetVendorName = vendorName;

    // Create new vendor if requested
    if (createNewVendor === 'true' && vendorName) {
      // Atomically insert the vendor if it doesn't exist, preventing race conditions.
      // This requires a unique index on LOWER(name).
      const upsertResult = await query(
        `INSERT INTO vendors (name, status) VALUES ($1, 'active')
         ON CONFLICT (LOWER(name)) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name`,
        [vendorName]
      );
      targetVendorId = upsertResult.rows[0].id;
      targetVendorName = upsertResult.rows[0].name;
      logger.info('Found or created vendor for spreadsheet import', {
        vendorId: targetVendorId,
        vendorName: targetVendorName,
      });
    }

    if (!targetVendorId) {
      await unlink(filePath).catch(() => {});
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required. Either select an existing vendor or create a new one.',
      });
    }

    // Verify vendor exists
    const vendorResult = await query('SELECT id, name FROM vendors WHERE id = $1', [targetVendorId]);
    if (vendorResult.rows.length === 0) {
      await unlink(filePath).catch(() => {});
      return res.status(404).json({
        success: false,
        error: 'Vendor not found',
      });
    }
    targetVendorName = vendorResult.rows[0].name;

    // Parse the spreadsheet
    const parseResult = await parseVendorSpreadsheet(filePath);

    // Clean up file
    await unlink(filePath).catch(() => {});

    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to parse spreadsheet',
        details: parseResult.errors,
      });
    }

    // Import deals
    const importResults = {
      totalDeals: parseResult.deals.length,
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    };

        for (const deal of parseResult.deals) {
      try {
        const dealMetadata = JSON.stringify({
          last_update: deal.lastUpdate,
          yearly_unit_opportunity: deal.yearlyUnitOpportunity,
          cost_upside: deal.costUpside,
          spreadsheet_row: deal.rowNumber,
          imported_from: originalFilename,
        });

        // Atomically insert or update a deal. This requires a unique index on (vendor_id, LOWER(deal_name)).
        await query(
          `INSERT INTO deal_registrations (
            vendor_id, deal_name, deal_stage, notes, deal_value, currency, status, metadata
          ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'USD'), 'imported', $7)
          ON CONFLICT (vendor_id, LOWER(deal_name)) DO UPDATE SET
            deal_stage = COALESCE(EXCLUDED.deal_stage, deal_registrations.deal_stage),
            notes = COALESCE(EXCLUDED.notes, deal_registrations.notes),
            deal_value = COALESCE(EXCLUDED.deal_value, deal_registrations.deal_value),
            currency = COALESCE(EXCLUDED.currency, deal_registrations.currency),
            metadata = COALESCE(deal_registrations.metadata, '{}'::jsonb) || EXCLUDED.metadata,
            updated_at = NOW()`,
          [
            targetVendorId,
            deal.opportunity,
            deal.stage || null,
            deal.nextSteps || null,
            deal.parsedDealValue,
            deal.parsedCurrency,
            dealMetadata,
          ]
        );
        importResults.imported++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        importResults.errors.push(`Row ${deal.rowNumber}: ${message}`);
        importResults.skipped++;
      }
    }

    logger.info('Spreadsheet import complete', {
      vendorId: targetVendorId,
      vendorName: targetVendorName,
      filename: originalFilename,
      ...importResults,
    });

    return res.json({
      success: true,
      data: {
        vendorId: targetVendorId,
        vendorName: targetVendorName,
        filename: originalFilename,
        ...importResults,
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to import spreadsheet', { error: message });

    if (req.file) {
      await unlink(req.file.path).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      error: 'Import failed',
      details: message,
    });
  }
});

export default router;
