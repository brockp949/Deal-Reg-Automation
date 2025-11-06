import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { query } from '../db';
import { ExportOptions } from '../types';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/export/excel
 * Generate Excel report for selected vendors
 */
router.post('/excel', async (req: Request, res: Response) => {
  try {
    const options: ExportOptions = req.body;

    if (!options.vendor_ids || options.vendor_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one vendor ID is required',
      });
    }

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Deal Registration System';
    workbook.created = new Date();

    // Add Vendors sheet
    const vendorsSheet = workbook.addWorksheet('Vendors');

    // Vendor headers
    vendorsSheet.columns = [
      { header: 'Vendor Name', key: 'name', width: 30 },
      { header: 'Industry', key: 'industry', width: 20 },
      { header: 'Website', key: 'website', width: 30 },
      { header: 'Email Domains', key: 'email_domains', width: 30 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Total Deals', key: 'total_deals', width: 15 },
      { header: 'Total Value', key: 'total_value', width: 20 },
    ];

    // Style headers
    vendorsSheet.getRow(1).font = { bold: true };
    vendorsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2563EB' },
    };
    vendorsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Get vendors data
    const vendorPlaceholders = options.vendor_ids.map((_, i) => `$${i + 1}`).join(',');
    const vendorsResult = await query(
      `SELECT v.*,
              COUNT(d.id) as total_deals,
              COALESCE(SUM(d.deal_value), 0) as total_value
       FROM vendors v
       LEFT JOIN deal_registrations d ON v.id = d.vendor_id
       WHERE v.id IN (${vendorPlaceholders})
       GROUP BY v.id
       ORDER BY v.name`,
      options.vendor_ids
    );

    // Add vendor rows
    vendorsResult.rows.forEach((vendor) => {
      vendorsSheet.addRow({
        name: vendor.name,
        industry: vendor.industry || '',
        website: vendor.website || '',
        email_domains: vendor.email_domains ? vendor.email_domains.join(', ') : '',
        status: vendor.status,
        total_deals: vendor.total_deals,
        total_value: `$${parseFloat(vendor.total_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      });
    });

    // Add Deals sheet if requested
    if (options.include_deals !== false) {
      const dealsSheet = workbook.addWorksheet('Deals');

      dealsSheet.columns = [
        { header: 'Vendor Name', key: 'vendor_name', width: 25 },
        { header: 'Deal Name', key: 'deal_name', width: 35 },
        { header: 'Customer', key: 'customer_name', width: 25 },
        { header: 'Value', key: 'deal_value', width: 15 },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Stage', key: 'deal_stage', width: 15 },
        { header: 'Probability', key: 'probability', width: 12 },
        { header: 'Registration Date', key: 'registration_date', width: 18 },
        { header: 'Expected Close', key: 'expected_close_date', width: 18 },
      ];

      // Style headers
      dealsSheet.getRow(1).font = { bold: true };
      dealsSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2563EB' },
      };
      dealsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      // Get deals data
      let dealsQuery = `
        SELECT d.*, v.name as vendor_name
        FROM deal_registrations d
        LEFT JOIN vendors v ON d.vendor_id = v.id
        WHERE d.vendor_id IN (${vendorPlaceholders})
      `;
      const dealsParams = [...options.vendor_ids];

      // Add date filtering if provided
      if (options.date_from || options.date_to) {
        if (options.date_from) {
          dealsQuery += ` AND d.registration_date >= $${dealsParams.length + 1}`;
          dealsParams.push(options.date_from instanceof Date ? options.date_from.toISOString() : options.date_from);
        }
        if (options.date_to) {
          dealsQuery += ` AND d.registration_date <= $${dealsParams.length + 1}`;
          dealsParams.push(options.date_to instanceof Date ? options.date_to.toISOString() : options.date_to);
        }
      }

      dealsQuery += ' ORDER BY v.name, d.registration_date DESC';

      const dealsResult = await query(dealsQuery, dealsParams);

      // Add deal rows
      dealsResult.rows.forEach((deal) => {
        dealsSheet.addRow({
          vendor_name: deal.vendor_name,
          deal_name: deal.deal_name,
          customer_name: deal.customer_name || '',
          deal_value: parseFloat(deal.deal_value),
          currency: deal.currency,
          status: deal.status,
          deal_stage: deal.deal_stage || '',
          probability: deal.probability ? `${deal.probability}%` : '',
          registration_date: deal.registration_date ? new Date(deal.registration_date).toLocaleDateString() : '',
          expected_close_date: deal.expected_close_date ? new Date(deal.expected_close_date).toLocaleDateString() : '',
        });
      });

      // Format value column as currency
      dealsSheet.getColumn('deal_value').numFmt = '$#,##0.00';
    }

    // Add Contacts sheet if requested
    if (options.include_contacts) {
      const contactsSheet = workbook.addWorksheet('Contacts');

      contactsSheet.columns = [
        { header: 'Vendor Name', key: 'vendor_name', width: 25 },
        { header: 'Contact Name', key: 'name', width: 25 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Phone', key: 'phone', width: 20 },
        { header: 'Role', key: 'role', width: 25 },
        { header: 'Primary Contact', key: 'is_primary', width: 15 },
      ];

      // Style headers
      contactsSheet.getRow(1).font = { bold: true };
      contactsSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2563EB' },
      };
      contactsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      // Get contacts data
      const contactsResult = await query(
        `SELECT c.*, v.name as vendor_name
         FROM contacts c
         LEFT JOIN vendors v ON c.vendor_id = v.id
         WHERE c.vendor_id IN (${vendorPlaceholders})
         ORDER BY v.name, c.is_primary DESC, c.name`,
        options.vendor_ids
      );

      // Add contact rows
      contactsResult.rows.forEach((contact) => {
        contactsSheet.addRow({
          vendor_name: contact.vendor_name,
          name: contact.name,
          email: contact.email || '',
          phone: contact.phone || '',
          role: contact.role || '',
          is_primary: contact.is_primary ? 'Yes' : 'No',
        });
      });
    }

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `deal_registration_report_${timestamp}.xlsx`;

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);

    logger.info('Excel report generated', {
      vendors: options.vendor_ids.length,
      filename,
    });

    res.end();
  } catch (error: any) {
    logger.error('Error generating Excel report', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to generate Excel report',
    });
  }
});

/**
 * POST /api/export/csv
 * Generate CSV report for selected vendors
 */
router.post('/csv', async (req: Request, res: Response) => {
  try {
    const options: ExportOptions = req.body;

    if (!options.vendor_ids || options.vendor_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one vendor ID is required',
      });
    }

    // Get deals data
    const vendorPlaceholders = options.vendor_ids.map((_, i) => `$${i + 1}`).join(',');
    const dealsResult = await query(
      `SELECT d.*, v.name as vendor_name
       FROM deal_registrations d
       LEFT JOIN vendors v ON d.vendor_id = v.id
       WHERE d.vendor_id IN (${vendorPlaceholders})
       ORDER BY v.name, d.registration_date DESC`,
      options.vendor_ids
    );

    // Build CSV
    const headers = [
      'Vendor Name',
      'Deal Name',
      'Customer',
      'Value',
      'Currency',
      'Status',
      'Stage',
      'Probability',
      'Registration Date',
      'Expected Close',
    ];

    let csv = headers.join(',') + '\n';

    dealsResult.rows.forEach((deal) => {
      const row = [
        deal.vendor_name,
        deal.deal_name,
        deal.customer_name || '',
        deal.deal_value,
        deal.currency,
        deal.status,
        deal.deal_stage || '',
        deal.probability || '',
        deal.registration_date ? new Date(deal.registration_date).toLocaleDateString() : '',
        deal.expected_close_date ? new Date(deal.expected_close_date).toLocaleDateString() : '',
      ];

      csv += row.map((field) => `"${field}"`).join(',') + '\n';
    });

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `deal_registration_report_${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error: any) {
    logger.error('Error generating CSV report', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to generate CSV report',
    });
  }
});

export default router;
