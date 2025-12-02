import { Router, Request, Response } from 'express';
import { query } from '../db';
import { normalizeVendorName, extractEmailDomains } from '../utils/fileHelpers';
import { Vendor, CreateVendorInput, UpdateVendorInput, ApiResponse, PaginatedResponse } from '../types';
import logger from '../utils/logger';
import { vendorValidations } from '../middleware/validation';

const router = Router();

/**
 * GET /api/vendors
 * Get all vendors with optional filtering and pagination
 */
router.get('/', vendorValidations.getAll, async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      limit = '20',
      status,
      industry,
      search,
      approval_status,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    // Build WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (status) {
      conditions.push(`status = $${paramCount++}`);
      params.push(status);
    }

    if (industry) {
      conditions.push(`industry = $${paramCount++}`);
      params.push(industry);
    }

    if (approval_status) {
      conditions.push(`approval_status = $${paramCount++}`);
      params.push(approval_status);
    }

    if (search) {
      conditions.push(`(name ILIKE $${paramCount} OR normalized_name ILIKE $${paramCount})`);
      params.push(`%${search}%`);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate and sanitize sort column to prevent SQL injection
    const allowedSortColumns = ['name', 'created_at', 'updated_at', 'status', 'approval_status'];
    const sortColumn = allowedSortColumns.includes(sort_by as string) ? sort_by : 'created_at';
    const sortDirection = sort_order === 'asc' ? 'ASC' : 'DESC';

    // Use window function to get total count in a single query
    params.push(limitNum, offset);
    const vendorsResult = await query(
      `SELECT *, COUNT(*) OVER() AS total_count FROM vendors ${whereClause}
       ORDER BY ${sortColumn} ${sortDirection}
       LIMIT $${paramCount++} OFFSET $${paramCount++}`,
      params
    );

    const total = vendorsResult.rows.length > 0 ? parseInt(vendorsResult.rows[0].total_count, 10) : 0;

    // Remove total_count from results
    const vendors = vendorsResult.rows.map(({ total_count, ...vendor }) => vendor);

    const response: PaginatedResponse<Vendor> = {
      success: true,
      data: vendors,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching vendors', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendors',
    });
  }
});

/**
 * GET /api/vendors/:id
 * Get a single vendor by ID
 */
router.get('/:id', vendorValidations.getById, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('SELECT * FROM vendors WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found',
      });
    }

    const response: ApiResponse<Vendor> = {
      success: true,
      data: result.rows[0],
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching vendor', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor',
    });
  }
});

/**
 * POST /api/vendors
 * Create a new vendor
 */
router.post('/', vendorValidations.create, async (req: Request, res: Response) => {
  try {
    const input: CreateVendorInput = req.body;

    if (!input.name) {
      return res.status(400).json({
        success: false,
        error: 'Vendor name is required',
      });
    }

    const normalizedName = normalizeVendorName(input.name);
    const emailDomains = input.email_domains || extractEmailDomains(input);

    const origin = input.origin || 'manual';
    const approvalStatus = input.approval_status || 'approved';
    const approvedAt = approvalStatus === 'approved' ? new Date() : null;

    const result = await query(
      `INSERT INTO vendors (
        name, normalized_name, email_domains, industry, website, notes,
        status, origin, approval_status, approved_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.name,
        normalizedName,
        emailDomains,
        input.industry || null,
        input.website || null,
        input.notes || null,
        input.status || 'active',
        origin,
        approvalStatus,
        approvedAt,
      ]
    );

    const response: ApiResponse<Vendor> = {
      success: true,
      data: result.rows[0],
      message: 'Vendor created successfully',
    };

    res.status(201).json(response);
  } catch (error: any) {
    logger.error('Error creating vendor', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create vendor',
    });
  }
});

/**
 * PUT /api/vendors/:id
 * Update a vendor
 */
router.put('/:id', vendorValidations.update, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input: UpdateVendorInput = req.body;

    // Check if vendor exists
    const existingResult = await query('SELECT * FROM vendors WHERE id = $1', [id]);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found',
      });
    }

    // Build UPDATE query dynamically
    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      params.push(input.name);
      updates.push(`normalized_name = $${paramCount++}`);
      params.push(normalizeVendorName(input.name));
    }

    if (input.email_domains !== undefined) {
      updates.push(`email_domains = $${paramCount++}`);
      params.push(input.email_domains);
    }

    if (input.industry !== undefined) {
      updates.push(`industry = $${paramCount++}`);
      params.push(input.industry);
    }

    if (input.website !== undefined) {
      updates.push(`website = $${paramCount++}`);
      params.push(input.website);
    }

    if (input.notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      params.push(input.notes);
    }

    if (input.status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      params.push(input.status);
    }

    if (input.origin !== undefined) {
      updates.push(`origin = $${paramCount++}`);
      params.push(input.origin);
    }

    if (input.approval_status !== undefined) {
      updates.push(`approval_status = $${paramCount++}`);
      params.push(input.approval_status);

      if (input.approval_status === 'approved') {
        updates.push(`approved_at = CURRENT_TIMESTAMP`);
      } else if (input.approval_status === 'pending' || input.approval_status === 'denied') {
        updates.push(`approved_at = NULL`);
      }
    }

    if (input.approval_notes !== undefined) {
      updates.push(`approval_notes = $${paramCount++}`);
      params.push(input.approval_notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
      });
    }

    params.push(id);
    const result = await query(
      `UPDATE vendors SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    const response: ApiResponse<Vendor> = {
      success: true,
      data: result.rows[0],
      message: 'Vendor updated successfully',
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error updating vendor', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update vendor',
    });
  }
});

/**
 * DELETE /api/vendors/:id
 * Delete a vendor
 */
router.delete('/:id', vendorValidations.delete, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('DELETE FROM vendors WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found',
      });
    }

    res.json({
      success: true,
      message: 'Vendor deleted successfully',
    });
  } catch (error: any) {
    logger.error('Error deleting vendor', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to delete vendor',
    });
  }
});

/**
 * GET /api/vendors/:id/deals
 * Get all deals for a vendor
 */
router.get('/:id/deals', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT * FROM deal_registrations WHERE vendor_id = $1 ORDER BY created_at DESC',
      [id]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    logger.error('Error fetching vendor deals', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor deals',
    });
  }
});

/**
 * GET /api/vendors/:id/contacts
 * Get all contacts for a vendor
 */
router.get('/:id/contacts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT * FROM contacts WHERE vendor_id = $1 ORDER BY is_primary DESC, name ASC',
      [id]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    logger.error('Error fetching vendor contacts', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor contacts',
    });
  }
});

export default router;
