import { Router, Request, Response } from 'express';
import { query } from '../db';
import { DealRegistration, CreateDealInput, UpdateDealInput, ApiResponse, PaginatedResponse } from '../types';
import logger from '../utils/logger';
import { dealValidations } from '../middleware/validation';

const router = Router();

/**
 * GET /api/deals
 * Get all deals with optional filtering and pagination
 */
router.get('/', dealValidations.getAll, async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      limit = '20',
      vendor_id,
      status,
      min_value,
      max_value,
      sort_by = 'created_at',
      sort_order = 'desc',
      search,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    // Build WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (vendor_id) {
      conditions.push(`vendor_id = $${paramCount++}`);
      params.push(vendor_id);
    }

    if (status) {
      conditions.push(`status = $${paramCount++}`);
      params.push(status);
    }

    if (min_value) {
      conditions.push(`deal_value >= $${paramCount++}`);
      params.push(parseFloat(min_value as string));
    }

    if (max_value) {
      conditions.push(`deal_value <= $${paramCount++}`);
      params.push(parseFloat(max_value as string));
    }

    if (search) {
      // Search across deal name, customer name, vendor name, and notes
      conditions.push(`(
        d.deal_name ILIKE $${paramCount} OR
        d.customer_name ILIKE $${paramCount} OR
        v.name ILIKE $${paramCount} OR
        d.notes ILIKE $${paramCount}
      )`);
      params.push(`%${search}%`);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate and sanitize sort column to prevent SQL injection
    const allowedSortColumns = ['deal_name', 'deal_value', 'registration_date', 'created_at', 'status'];
    const sortColumn = allowedSortColumns.includes(sort_by as string) ? sort_by : 'created_at';
    const sortDirection = sort_order === 'asc' ? 'ASC' : 'DESC';

    // Use window function to get total count in a single query
    params.push(limitNum, offset);
    const dealsResult = await query(
      `SELECT d.*, v.name as vendor_name, COUNT(*) OVER() AS total_count
       FROM deal_registrations d
       LEFT JOIN vendors v ON d.vendor_id = v.id
       ${whereClause}
       ORDER BY d.${sortColumn} ${sortDirection}
       LIMIT $${paramCount++} OFFSET $${paramCount++}`,
      params
    );

    const total = dealsResult.rows.length > 0 ? parseInt(dealsResult.rows[0].total_count, 10) : 0;

    // Remove total_count from results
    const deals = dealsResult.rows.map(({ total_count, ...deal }) => deal);

    const response: PaginatedResponse<DealRegistration> = {
      success: true,
      data: deals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching deals', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch deals',
    });
  }
});

/**
 * GET /api/deals/:id
 * Get a single deal by ID
 */
router.get('/:id', dealValidations.getById, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT d.*, v.name as vendor_name
       FROM deal_registrations d
       LEFT JOIN vendors v ON d.vendor_id = v.id
       WHERE d.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found',
      });
    }

    const response: ApiResponse<DealRegistration> = {
      success: true,
      data: result.rows[0],
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching deal', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch deal',
    });
  }
});

/**
 * POST /api/deals
 * Create a new deal
 */
router.post('/', dealValidations.create, async (req: Request, res: Response) => {
  try {
    const input: CreateDealInput = req.body;

    if (!input.vendor_id || !input.deal_name) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID and deal name are required',
      });
    }

    const result = await query(
      `INSERT INTO deal_registrations (
        vendor_id, deal_name, deal_value, currency, customer_name,
        customer_industry, registration_date, expected_close_date,
        status, deal_stage, probability, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        input.vendor_id,
        input.deal_name,
        input.deal_value || 0,
        input.currency || 'USD',
        input.customer_name || null,
        input.customer_industry || null,
        input.registration_date || new Date(),
        input.expected_close_date || null,
        input.status || 'registered',
        input.deal_stage || null,
        input.probability || null,
        input.notes || null,
      ]
    );

    const response: ApiResponse<DealRegistration> = {
      success: true,
      data: result.rows[0],
      message: 'Deal created successfully',
    };

    res.status(201).json(response);
  } catch (error: any) {
    logger.error('Error creating deal', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create deal',
    });
  }
});

/**
 * PUT /api/deals/:id
 * Update a deal
 */
router.put('/:id', dealValidations.update, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input: UpdateDealInput = req.body;

    // Check if deal exists
    const existingResult = await query('SELECT * FROM deal_registrations WHERE id = $1', [id]);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found',
      });
    }

    // Build UPDATE query dynamically
    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    const fields = [
      'vendor_id', 'deal_name', 'deal_value', 'currency', 'customer_name',
      'customer_industry', 'registration_date', 'expected_close_date',
      'status', 'deal_stage', 'probability', 'notes'
    ];

    fields.forEach((field) => {
      if (input[field as keyof UpdateDealInput] !== undefined) {
        updates.push(`${field} = $${paramCount++}`);
        params.push(input[field as keyof UpdateDealInput]);
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
      });
    }

    params.push(id);
    const result = await query(
      `UPDATE deal_registrations SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    const response: ApiResponse<DealRegistration> = {
      success: true,
      data: result.rows[0],
      message: 'Deal updated successfully',
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error updating deal', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update deal',
    });
  }
});

/**
 * DELETE /api/deals/:id
 * Delete a deal
 */
router.delete('/:id', dealValidations.delete, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('DELETE FROM deal_registrations WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found',
      });
    }

    res.json({
      success: true,
      message: 'Deal deleted successfully',
    });
  } catch (error: any) {
    logger.error('Error deleting deal', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to delete deal',
    });
  }
});

/**
 * PATCH /api/deals/:id/status
 * Update deal status
 */
router.patch('/:id/status', dealValidations.updateStatus, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required',
      });
    }

    const result = await query(
      `UPDATE deal_registrations
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Deal status updated successfully',
    });
  } catch (error: any) {
    logger.error('Error updating deal status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update deal status',
    });
  }
});

export default router;
