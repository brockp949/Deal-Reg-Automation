/**
 * Vendor Spreadsheet Export Routes
 * Exports vendor deals to Excel spreadsheet format
 */

import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router({ mergeParams: true });

interface DealForExport {
  id: string;
  deal_name: string;
  deal_stage: string;
  notes: string | null;
  deal_value: number | null;
  currency: string | null;
  metadata: {
    last_update?: string;
    yearly_unit_opportunity?: string;
    cost_upside?: string;
  } | null;
}

/**
 * Format deal value back to readable cost upside format
 */
function formatCostUpside(value: number | null, currency: string | null, originalText?: string): string {
  // If we have the original text, use it
  if (originalText) {
    return originalText;
  }

  if (!value) return '';

  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';

  if (value >= 1000000) {
    return `${symbol}${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `${symbol}${(value / 1000).toFixed(0)}K`;
  }
  return `${symbol}${value}`;
}

/**
 * GET /api/vendors/:vendorId/deals/export-spreadsheet
 * Export deals for a vendor in the original spreadsheet format
 */
router.get('/export-spreadsheet', async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required',
      });
    }

    // Get vendor info
    const vendorResult = await query(
      'SELECT id, name FROM vendors WHERE id = $1',
      [vendorId]
    );

    if (vendorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found',
      });
    }

    const vendor = vendorResult.rows[0];

    // Get deals for vendor
    const dealsResult = await query(
      `SELECT id, deal_name, deal_stage, notes, deal_value, currency, metadata
       FROM deal_registrations
       WHERE vendor_id = $1
       ORDER BY created_at DESC`,
      [vendorId]
    );

    const deals: DealForExport[] = dealsResult.rows;

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Deal Registration Automation';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Deals');

    // Define columns matching the original format
    worksheet.columns = [
      { header: 'Opportunity', key: 'opportunity', width: 40 },
      { header: 'Stage', key: 'stage', width: 20 },
      { header: 'Next steps', key: 'nextSteps', width: 50 },
      { header: 'Last update', key: 'lastUpdate', width: 15 },
      { header: 'Yearly unit opportunity', key: 'yearlyUnitOpportunity', width: 25 },
      { header: 'Cost upside', key: 'costUpside', width: 20 },
    ];

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    // Add data rows
    for (const deal of deals) {
      const metadata = deal.metadata || {};

      worksheet.addRow({
        opportunity: deal.deal_name,
        stage: deal.deal_stage,
        nextSteps: deal.notes || '',
        lastUpdate: metadata.last_update || '',
        yearlyUnitOpportunity: metadata.yearly_unit_opportunity || '',
        costUpside: formatCostUpside(deal.deal_value, deal.currency, metadata.cost_upside),
      });
    }

    // Auto-fit columns based on content
    worksheet.columns.forEach(column => {
      if (column.eachCell) {
        let maxLength = 10;
        column.eachCell({ includeEmpty: true }, cell => {
          const columnLength = cell.value ? String(cell.value).length : 10;
          if (columnLength > maxLength) {
            maxLength = Math.min(columnLength, 50);
          }
        });
        column.width = maxLength + 2;
      }
    });

    // Set filename
    const sanitizedVendorName = vendor.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedVendorName} - Deals.xlsx`;

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);

    logger.info('Exported vendor deals spreadsheet', {
      vendorId,
      vendorName: vendor.name,
      dealCount: deals.length,
    });

    res.end();

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to export deals spreadsheet', { error: message });
    return res.status(500).json({
      success: false,
      error: 'Export failed',
      details: message,
    });
  }
});

/**
 * POST /api/vendors/:vendorId/deals/export-spreadsheet
 * Export selected deals for a vendor
 */
router.post('/export-spreadsheet', async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { dealIds } = req.body;

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required',
      });
    }

    // Get vendor info
    const vendorResult = await query(
      'SELECT id, name FROM vendors WHERE id = $1',
      [vendorId]
    );

    if (vendorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found',
      });
    }

    const vendor = vendorResult.rows[0];

    // Get deals (optionally filtered by IDs)
    let dealsQuery = `
      SELECT id, deal_name, deal_stage, notes, deal_value, currency, metadata
      FROM deal_registrations
      WHERE vendor_id = $1
    `;
    const params: (string | string[])[] = [vendorId];

    if (dealIds && Array.isArray(dealIds) && dealIds.length > 0) {
      dealsQuery += ' AND id = ANY($2)';
      params.push(dealIds);
    }

    dealsQuery += ' ORDER BY created_at DESC';

    const dealsResult = await query(dealsQuery, params);
    const deals: DealForExport[] = dealsResult.rows;

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Deal Registration Automation';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Deals');

    // Define columns
    worksheet.columns = [
      { header: 'Opportunity', key: 'opportunity', width: 40 },
      { header: 'Stage', key: 'stage', width: 20 },
      { header: 'Next steps', key: 'nextSteps', width: 50 },
      { header: 'Last update', key: 'lastUpdate', width: 15 },
      { header: 'Yearly unit opportunity', key: 'yearlyUnitOpportunity', width: 25 },
      { header: 'Cost upside', key: 'costUpside', width: 20 },
    ];

    // Style header
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data
    for (const deal of deals) {
      const metadata = deal.metadata || {};
      worksheet.addRow({
        opportunity: deal.deal_name,
        stage: deal.deal_stage,
        nextSteps: deal.notes || '',
        lastUpdate: metadata.last_update || '',
        yearlyUnitOpportunity: metadata.yearly_unit_opportunity || '',
        costUpside: formatCostUpside(deal.deal_value, deal.currency, metadata.cost_upside),
      });
    }

    const sanitizedVendorName = vendor.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedVendorName} - Deals.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);

    logger.info('Exported selected vendor deals', {
      vendorId,
      dealCount: deals.length,
      selectedIds: dealIds?.length || 'all',
    });

    res.end();

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to export selected deals', { error: message });
    return res.status(500).json({
      success: false,
      error: 'Export failed',
      details: message,
    });
  }
});

export default router;
