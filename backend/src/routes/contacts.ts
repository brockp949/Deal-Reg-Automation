import { Router, Request, Response } from 'express';
import { query } from '../db';
import { Contact, CreateContactInput, ApiResponse } from '../types';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/contacts
 * Get all contacts with optional vendor filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { vendor_id } = req.query;

    let queryText = 'SELECT * FROM contacts';
    const params: any[] = [];

    if (vendor_id) {
      queryText += ' WHERE vendor_id = $1';
      params.push(vendor_id);
    }

    queryText += ' ORDER BY is_primary DESC, name ASC';

    const result = await query(queryText, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    logger.error('Error fetching contacts', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contacts',
    });
  }
});

/**
 * POST /api/contacts
 * Create a new contact
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreateContactInput = req.body;

    if (!input.vendor_id || !input.name) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID and name are required',
      });
    }

    const result = await query(
      `INSERT INTO contacts (vendor_id, name, email, phone, role, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.vendor_id,
        input.name,
        input.email || null,
        input.phone || null,
        input.role || null,
        input.is_primary || false,
      ]
    );

    const response: ApiResponse<Contact> = {
      success: true,
      data: result.rows[0],
      message: 'Contact created successfully',
    };

    res.status(201).json(response);
  } catch (error: any) {
    logger.error('Error creating contact', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create contact',
    });
  }
});

/**
 * PUT /api/contacts/:id
 * Update a contact
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input = req.body;

    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    const fields = ['name', 'email', 'phone', 'role', 'is_primary'];

    fields.forEach((field) => {
      if (input[field] !== undefined) {
        updates.push(`${field} = $${paramCount++}`);
        params.push(input[field]);
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
      `UPDATE contacts SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Contact updated successfully',
    });
  } catch (error: any) {
    logger.error('Error updating contact', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update contact',
    });
  }
});

/**
 * DELETE /api/contacts/:id
 * Delete a contact
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('DELETE FROM contacts WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    res.json({
      success: true,
      message: 'Contact deleted successfully',
    });
  } catch (error: any) {
    logger.error('Error deleting contact', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to delete contact',
    });
  }
});

export default router;
