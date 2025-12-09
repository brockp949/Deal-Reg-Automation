/**
 * Agreement API Routes
 * Handles uploading, extracting, and managing vendor agreements.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { unlink } from 'fs/promises';
import { query } from '../db';
import { extractAgreementFromPDF, validateCommissionStructure } from '../services/agreementParser';
import logger from '../utils/logger';

const router = Router({ mergeParams: true });

// Configure multer for agreement file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `agreement-${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit for agreement PDFs
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf'];
    const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF files are allowed for agreements'));
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
 * POST /api/vendors/:vendorId/agreements
 * Upload and process a vendor agreement
 */
router.post('/', validateVendor, upload.single('file'), async (req: Request, res: Response) => {
  const filePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const { vendorId } = req.params;
    const vendor = (req as any).vendor;

    logger.info('Agreement file uploaded', {
      vendorId,
      vendorName: vendor.name,
      filename: req.file.originalname,
      size: req.file.size,
      path: filePath,
    });

    // Extract agreement data using AI
    const extraction = await extractAgreementFromPDF(filePath!);

    // Validate commission structure
    const validatedCommission = validateCommissionStructure(extraction.commissionStructure);

    // Save to database
    const result = await query(
      `INSERT INTO vendor_agreements (
        vendor_id, file_name, file_path, file_size,
        agreement_type, effective_date, expiration_date, auto_renewal, renewal_terms,
        commission_structure, key_terms,
        extraction_confidence, extraction_model, raw_extracted_text, extraction_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        vendorId,
        req.file.originalname,
        filePath,
        req.file.size,
        extraction.agreementType,
        extraction.effectiveDate,
        extraction.expirationDate,
        extraction.autoRenewal,
        extraction.renewalTerms,
        validatedCommission ? JSON.stringify(validatedCommission) : null,
        JSON.stringify(extraction.keyTerms),
        extraction.confidence,
        extraction.model,
        null, // We don't store raw text to save space
        JSON.stringify({
          tokensUsed: extraction.tokensUsed,
          extractionTimeMs: extraction.extractionTimeMs,
        }),
      ]
    );

    logger.info('Agreement saved successfully', {
      agreementId: result.rows[0].id,
      vendorId,
      agreementType: extraction.agreementType,
      confidence: extraction.confidence,
    });

    return res.status(201).json({
      success: true,
      message: 'Agreement uploaded and processed successfully',
      data: result.rows[0],
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to process agreement', {
      error: message,
    });

    // Clean up file on error
    if (filePath) {
      await unlink(filePath).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to process agreement',
      details: message,
    });
  }
});

/**
 * GET /api/vendors/:vendorId/agreements
 * List all agreements for a vendor
 */
router.get('/', validateVendor, async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;

    const result = await query(
      `SELECT id, vendor_id, file_name, file_size, upload_date,
              agreement_type, effective_date, expiration_date, auto_renewal,
              commission_structure, key_terms, extraction_confidence
       FROM vendor_agreements
       WHERE vendor_id = $1
       ORDER BY upload_date DESC`,
      [vendorId]
    );

    return res.json({
      success: true,
      data: result.rows,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to fetch agreements', { error: message });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch agreements',
    });
  }
});

/**
 * GET /api/vendors/:vendorId/agreements/:id
 * Get a specific agreement
 */
router.get('/:id', validateVendor, async (req: Request, res: Response) => {
  try {
    const { vendorId, id } = req.params;

    const result = await query(
      `SELECT * FROM vendor_agreements
       WHERE id = $1 AND vendor_id = $2`,
      [id, vendorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Agreement not found',
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to fetch agreement', { error: message });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch agreement',
    });
  }
});

/**
 * PUT /api/vendors/:vendorId/agreements/:id
 * Update agreement (for manual corrections of AI extraction)
 */
router.put('/:id', validateVendor, async (req: Request, res: Response) => {
  try {
    const { vendorId, id } = req.params;
    const {
      agreement_type,
      effective_date,
      expiration_date,
      auto_renewal,
      renewal_terms,
      commission_structure,
      key_terms,
    } = req.body;

    // Build dynamic update query
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    if (agreement_type !== undefined) {
      updates.push(`agreement_type = $${paramCount++}`);
      params.push(agreement_type);
    }
    if (effective_date !== undefined) {
      updates.push(`effective_date = $${paramCount++}`);
      params.push(effective_date);
    }
    if (expiration_date !== undefined) {
      updates.push(`expiration_date = $${paramCount++}`);
      params.push(expiration_date);
    }
    if (auto_renewal !== undefined) {
      updates.push(`auto_renewal = $${paramCount++}`);
      params.push(auto_renewal);
    }
    if (renewal_terms !== undefined) {
      updates.push(`renewal_terms = $${paramCount++}`);
      params.push(renewal_terms);
    }
    if (commission_structure !== undefined) {
      const validated = validateCommissionStructure(commission_structure);
      updates.push(`commission_structure = $${paramCount++}`);
      params.push(validated ? JSON.stringify(validated) : null);
    }
    if (key_terms !== undefined) {
      updates.push(`key_terms = $${paramCount++}`);
      params.push(JSON.stringify(key_terms));
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
      });
    }

    params.push(id, vendorId);
    const result = await query(
      `UPDATE vendor_agreements
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount++} AND vendor_id = $${paramCount}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Agreement not found',
      });
    }

    return res.json({
      success: true,
      message: 'Agreement updated successfully',
      data: result.rows[0],
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to update agreement', { error: message });
    return res.status(500).json({
      success: false,
      error: 'Failed to update agreement',
    });
  }
});

/**
 * DELETE /api/vendors/:vendorId/agreements/:id
 * Delete an agreement
 */
router.delete('/:id', validateVendor, async (req: Request, res: Response) => {
  try {
    const { vendorId, id } = req.params;

    // Get the file path first
    const agreement = await query(
      `SELECT file_path FROM vendor_agreements
       WHERE id = $1 AND vendor_id = $2`,
      [id, vendorId]
    );

    if (agreement.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Agreement not found',
      });
    }

    // Delete from database
    await query(
      `DELETE FROM vendor_agreements
       WHERE id = $1 AND vendor_id = $2`,
      [id, vendorId]
    );

    // Try to delete the file
    if (agreement.rows[0].file_path) {
      await unlink(agreement.rows[0].file_path).catch((err) => {
        logger.warn('Failed to delete agreement file', {
          path: agreement.rows[0].file_path,
          error: err.message,
        });
      });
    }

    return res.json({
      success: true,
      message: 'Agreement deleted successfully',
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to delete agreement', { error: message });
    return res.status(500).json({
      success: false,
      error: 'Failed to delete agreement',
    });
  }
});

export default router;
