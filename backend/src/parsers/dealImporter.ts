/**
 * Deal Importer - Excel and CSV Deal List Parser
 * Supports importing deals for a specific vendor via bulk upload
 */

import ExcelJS from 'exceljs';
import { createReadStream } from 'fs';
import csv from 'csv-parser';
import logger from '../utils/logger';

export interface ImportedDeal {
  deal_name: string;
  deal_value?: number;
  currency?: string;
  customer_name?: string;
  customer_industry?: string;
  registration_date?: string;
  expected_close_date?: string;
  status?: string;
  deal_stage?: string;
  probability?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface DealImportResult {
  success: boolean;
  deals: ImportedDeal[];
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: string[];
  duplicates: number;
}

const VALID_STATUSES = ['registered', 'approved', 'rejected', 'closed-won', 'closed-lost'];

/**
 * Normalize status value to match valid enum values
 */
function normalizeStatus(status: string): string {
  const normalized = status.toLowerCase().trim().replace(/[\s_]+/g, '-');

  const statusMapping: Record<string, string> = {
    'registered': 'registered',
    'new': 'registered',
    'pending': 'registered',
    'submitted': 'registered',
    'approved': 'approved',
    'accepted': 'approved',
    'active': 'approved',
    'rejected': 'rejected',
    'denied': 'rejected',
    'declined': 'rejected',
    'closed-won': 'closed-won',
    'closedwon': 'closed-won',
    'won': 'closed-won',
    'closed_won': 'closed-won',
    'closed-lost': 'closed-lost',
    'closedlost': 'closed-lost',
    'lost': 'closed-lost',
    'closed_lost': 'closed-lost',
  };

  return statusMapping[normalized] || 'registered';
}

/**
 * Parse date string into ISO format
 */
function parseDate(dateValue: unknown): string | undefined {
  if (!dateValue) return undefined;

  // Handle ExcelJS Date objects
  if (dateValue instanceof Date) {
    return dateValue.toISOString().split('T')[0];
  }

  // Handle string dates
  if (typeof dateValue === 'string') {
    const trimmed = dateValue.trim();
    if (!trimmed) return undefined;

    // Try common date formats
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }

    // Try MM/DD/YYYY format
    const mmddyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (mmddyyyy) {
      const [, month, day, year] = mmddyyyy;
      return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
    }

    // Try DD/MM/YYYY format (European)
    const ddmmyyyy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(trimmed);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
    }
  }

  // Handle Excel serial date numbers
  if (typeof dateValue === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + dateValue * 86400000);
    return date.toISOString().split('T')[0];
  }

  return undefined;
}

/**
 * Parse numeric value from various input types
 */
function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'number') {
    return isNaN(value) ? undefined : value;
  }

  if (typeof value === 'string') {
    // Remove currency symbols and formatting
    const cleaned = value.replace(/[$€£¥,\s]/g, '').trim();
    if (!cleaned) return undefined;

    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  }

  return undefined;
}

/**
 * Map common Excel column names to deal fields
 */
function mapColumnToField(columnName: string): string | null {
  const normalized = columnName.toLowerCase().trim().replace(/[_\s]+/g, '_');

  const mapping: Record<string, string> = {
    // Deal name mappings
    deal_name: 'deal_name',
    deal: 'deal_name',
    name: 'deal_name',
    opportunity: 'deal_name',
    opportunity_name: 'deal_name',
    project: 'deal_name',
    project_name: 'deal_name',
    title: 'deal_name',

    // Deal value mappings
    deal_value: 'deal_value',
    value: 'deal_value',
    amount: 'deal_value',
    price: 'deal_value',
    total: 'deal_value',
    total_value: 'deal_value',
    revenue: 'deal_value',
    contract_value: 'deal_value',

    // Currency mappings
    currency: 'currency',
    currency_code: 'currency',

    // Customer mappings
    customer_name: 'customer_name',
    customer: 'customer_name',
    client: 'customer_name',
    client_name: 'customer_name',
    company: 'customer_name',
    company_name: 'customer_name',
    account: 'customer_name',
    account_name: 'customer_name',
    end_customer: 'customer_name',

    // Customer industry mappings
    customer_industry: 'customer_industry',
    industry: 'customer_industry',
    sector: 'customer_industry',
    vertical: 'customer_industry',

    // Registration date mappings
    registration_date: 'registration_date',
    reg_date: 'registration_date',
    date: 'registration_date',
    created_date: 'registration_date',
    submit_date: 'registration_date',
    submitted_date: 'registration_date',

    // Expected close date mappings
    expected_close_date: 'expected_close_date',
    close_date: 'expected_close_date',
    expected_close: 'expected_close_date',
    estimated_close: 'expected_close_date',
    target_close: 'expected_close_date',

    // Status mappings
    status: 'status',
    deal_status: 'status',
    state: 'status',

    // Deal stage mappings
    deal_stage: 'deal_stage',
    stage: 'deal_stage',
    phase: 'deal_stage',
    sales_stage: 'deal_stage',

    // Probability mappings
    probability: 'probability',
    prob: 'probability',
    chance: 'probability',
    win_probability: 'probability',
    close_probability: 'probability',

    // Notes mappings
    notes: 'notes',
    description: 'notes',
    comments: 'notes',
    details: 'notes',
  };

  return mapping[normalized] || null;
}

/**
 * Parse deal data from Excel file
 */
export async function parseDealExcel(filePath: string): Promise<DealImportResult> {
  const result: DealImportResult = {
    success: false,
    deals: [],
    totalRows: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
    duplicates: 0,
  };

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('No worksheets found in Excel file');
    }

    logger.info(`Parsing deal Excel file: ${worksheet.name}`, {
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
    });

    // Get headers from first row
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value || '').trim();
    });

    logger.info('Excel headers detected', { headers });

    const seenDealNames = new Set<string>();

    // Process data rows (starting from row 2)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header row

      result.totalRows++;

      try {
        // Build row object
        const rowData: Record<string, unknown> = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          if (header) {
            rowData[header] = cell.value;
          }
        });

        // Map to deal object
        const deal: Partial<ImportedDeal> = {
          metadata: {},
        };

        for (const [header, value] of Object.entries(rowData)) {
          if (value === null || value === undefined) continue;

          const field = mapColumnToField(header);
          const stringValue = String(value).trim();

          if (field === 'deal_name') {
            deal.deal_name = stringValue;
          } else if (field === 'deal_value') {
            deal.deal_value = parseNumber(value);
          } else if (field === 'currency') {
            deal.currency = stringValue.toUpperCase().substring(0, 3);
          } else if (field === 'customer_name') {
            deal.customer_name = stringValue;
          } else if (field === 'customer_industry') {
            deal.customer_industry = stringValue;
          } else if (field === 'registration_date') {
            deal.registration_date = parseDate(value);
          } else if (field === 'expected_close_date') {
            deal.expected_close_date = parseDate(value);
          } else if (field === 'status') {
            deal.status = normalizeStatus(stringValue);
          } else if (field === 'deal_stage') {
            deal.deal_stage = stringValue;
          } else if (field === 'probability') {
            const prob = parseNumber(value);
            if (prob !== undefined) {
              deal.probability = Math.min(100, Math.max(0, prob));
            }
          } else if (field === 'notes') {
            deal.notes = stringValue;
          } else {
            // Store unmapped columns in metadata
            deal.metadata![header] = stringValue;
          }
        }

        // Validate required fields
        if (!deal.deal_name) {
          result.errors.push(`Row ${rowNumber}: Missing deal name`);
          result.errorCount++;
          return;
        }

        // Check for duplicates
        const normalizedName = deal.deal_name.toLowerCase();
        if (seenDealNames.has(normalizedName)) {
          result.duplicates++;
          logger.debug(`Duplicate deal found: ${deal.deal_name} (row ${rowNumber})`);
          return;
        }

        seenDealNames.add(normalizedName);

        // Set default values
        if (!deal.currency) {
          deal.currency = 'USD';
        }
        if (!deal.status) {
          deal.status = 'registered';
        }

        result.deals.push(deal as ImportedDeal);
        result.successCount++;

      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Row ${rowNumber}: ${message}`);
        result.errorCount++;
        logger.warn(`Error parsing row ${rowNumber}`, { error: message });
      }
    });

    result.success = result.successCount > 0;

    logger.info('Deal Excel parsing complete', {
      totalRows: result.totalRows,
      successCount: result.successCount,
      errorCount: result.errorCount,
      duplicates: result.duplicates,
    });

    return result;

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to parse deal Excel file', {
      error: message,
    });
    result.errors.push(`File parsing error: ${message}`);
    return result;
  }
}

/**
 * Parse deal data from CSV file
 */
export async function parseDealCSV(filePath: string): Promise<DealImportResult> {
  const result: DealImportResult = {
    success: false,
    deals: [],
    totalRows: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
    duplicates: 0,
  };

  return new Promise((resolve) => {
    const seenDealNames = new Set<string>();

    createReadStream(filePath)
      .pipe(csv())
      .on('data', (row: Record<string, unknown>) => {
        result.totalRows++;

        try {
          // Map to deal object
          const deal: Partial<ImportedDeal> = {
            metadata: {},
          };

          for (const [header, value] of Object.entries(row)) {
            if (value === null || value === undefined) continue;

            const field = mapColumnToField(header);
            const stringValue = String(value).trim();

            if (field === 'deal_name') {
              deal.deal_name = stringValue;
            } else if (field === 'deal_value') {
              deal.deal_value = parseNumber(value);
            } else if (field === 'currency') {
              deal.currency = stringValue.toUpperCase().substring(0, 3);
            } else if (field === 'customer_name') {
              deal.customer_name = stringValue;
            } else if (field === 'customer_industry') {
              deal.customer_industry = stringValue;
            } else if (field === 'registration_date') {
              deal.registration_date = parseDate(value);
            } else if (field === 'expected_close_date') {
              deal.expected_close_date = parseDate(value);
            } else if (field === 'status') {
              deal.status = normalizeStatus(stringValue);
            } else if (field === 'deal_stage') {
              deal.deal_stage = stringValue;
            } else if (field === 'probability') {
              const prob = parseNumber(value);
              if (prob !== undefined) {
                deal.probability = Math.min(100, Math.max(0, prob));
              }
            } else if (field === 'notes') {
              deal.notes = stringValue;
            } else {
              deal.metadata![header] = stringValue;
            }
          }

          // Validate
          if (!deal.deal_name) {
            result.errors.push(`Row ${result.totalRows}: Missing deal name`);
            result.errorCount++;
            return;
          }

          // Check duplicates
          const normalizedName = deal.deal_name.toLowerCase();
          if (seenDealNames.has(normalizedName)) {
            result.duplicates++;
            return;
          }

          seenDealNames.add(normalizedName);

          // Set defaults
          if (!deal.currency) {
            deal.currency = 'USD';
          }
          if (!deal.status) {
            deal.status = 'registered';
          }

          result.deals.push(deal as ImportedDeal);
          result.successCount++;

        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Row ${result.totalRows}: ${message}`);
          result.errorCount++;
        }
      })
      .on('end', () => {
        result.success = result.successCount > 0;
        logger.info('Deal CSV parsing complete', {
          totalRows: result.totalRows,
          successCount: result.successCount,
          errorCount: result.errorCount,
          duplicates: result.duplicates,
        });
        resolve(result);
      })
      .on('error', (error: Error) => {
        result.errors.push(`CSV parsing error: ${error.message}`);
        logger.error('Failed to parse deal CSV file', { error: error.message });
        resolve(result);
      });
  });
}

/**
 * Auto-detect file type and parse accordingly
 */
export async function parseDealFile(filePath: string): Promise<DealImportResult> {
  if (filePath.endsWith('.xlsx') || filePath.endsWith('.xls')) {
    return parseDealExcel(filePath);
  } else if (filePath.endsWith('.csv')) {
    return parseDealCSV(filePath);
  } else {
    return {
      success: false,
      deals: [],
      totalRows: 0,
      successCount: 0,
      errorCount: 1,
      errors: ['Unsupported file type. Please use .xlsx or .csv'],
      duplicates: 0,
    };
  }
}

export default {
  parseDealExcel,
  parseDealCSV,
  parseDealFile,
  normalizeStatus,
};
