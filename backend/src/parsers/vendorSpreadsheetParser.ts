/**
 * Vendor Spreadsheet Parser
 *
 * Parses vendor-specific deal spreadsheets with format:
 * - Opportunity (deal name)
 * - Stage (deal stage)
 * - Next steps (notes)
 * - Last update (date)
 * - Yearly unit opportunity (volume info)
 * - Cost upside (revenue estimate)
 *
 * Vendor name is extracted from filename (e.g., "4IEC - Deals.xlsx" -> "4IEC")
 */

import ExcelJS from 'exceljs';
import { createReadStream } from 'fs';
import csv from 'csv-parser';
import logger from '../utils/logger';

export interface VendorSpreadsheetDeal {
  opportunity: string;
  stage: string;
  nextSteps: string;
  lastUpdate: string | null;
  yearlyUnitOpportunity: string;
  costUpside: string;
  parsedDealValue: number | null;
  parsedCurrency: string;
  rowNumber: number;
}

export interface VendorSpreadsheetResult {
  success: boolean;
  vendorNameFromFile: string | null;
  deals: VendorSpreadsheetDeal[];
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: string[];
  warnings: string[];
}

// Column name mappings - flexible matching
const COLUMN_MAPPINGS: Record<string, string> = {
  // Opportunity/Deal name
  'opportunity': 'opportunity',
  'deal': 'opportunity',
  'deal name': 'opportunity',
  'deal_name': 'opportunity',
  'project': 'opportunity',
  'project name': 'opportunity',

  // Stage
  'stage': 'stage',
  'deal stage': 'stage',
  'deal_stage': 'stage',
  'status': 'stage',
  'phase': 'stage',

  // Next steps/Notes
  'next steps': 'nextSteps',
  'next step': 'nextSteps',
  'next_steps': 'nextSteps',
  'notes': 'nextSteps',
  'description': 'nextSteps',
  'action': 'nextSteps',
  'action items': 'nextSteps',

  // Last update
  'last update': 'lastUpdate',
  'last_update': 'lastUpdate',
  'updated': 'lastUpdate',
  'last updated': 'lastUpdate',
  'date': 'lastUpdate',
  'update date': 'lastUpdate',

  // Yearly unit opportunity
  'yearly unit opportunity': 'yearlyUnitOpportunity',
  'yearly_unit_opportunity': 'yearlyUnitOpportunity',
  'unit opportunity': 'yearlyUnitOpportunity',
  'volume': 'yearlyUnitOpportunity',
  'units': 'yearlyUnitOpportunity',
  'quantity': 'yearlyUnitOpportunity',
  'yearly volume': 'yearlyUnitOpportunity',

  // Cost upside
  'cost upside': 'costUpside',
  'cost_upside': 'costUpside',
  'revenue': 'costUpside',
  'value': 'costUpside',
  'deal value': 'costUpside',
  'potential revenue': 'costUpside',
  'upside': 'costUpside',
  'revenue potential': 'costUpside',
};

/**
 * Extract vendor name from filename
 * Examples:
 *   "4IEC - Deals.xlsx" -> "4IEC"
 *   "Arduino - Deals .xlsx" -> "Arduino"
 *   "PacTran - Deals.xlsx" -> "PacTran"
 */
export function extractVendorFromFilename(filename: string): string | null {
  if (!filename) return null;

  // Remove path if present
  const basename = filename.split(/[/\\]/).pop() || filename;

  // Try pattern: "VendorName - Deals.xlsx"
  const dashMatch = basename.match(/^(.+?)\s*-\s*[Dd]eals?\s*\.xlsx?$/i);
  if (dashMatch && dashMatch[1]) {
    return dashMatch[1].trim();
  }

  // Try pattern: "VendorName_Deals.xlsx"
  const underscoreMatch = basename.match(/^(.+?)_[Dd]eals?\s*\.xlsx?$/i);
  if (underscoreMatch && underscoreMatch[1]) {
    return underscoreMatch[1].trim();
  }

  // Try pattern: "VendorName Deals.xlsx" (space separated)
  const spaceMatch = basename.match(/^(.+?)\s+[Dd]eals?\s*\.xlsx?$/i);
  if (spaceMatch && spaceMatch[1]) {
    return spaceMatch[1].trim();
  }

  // Fallback: just remove extension and common suffixes
  const withoutExt = basename.replace(/\.xlsx?$/i, '').trim();
  const withoutDeals = withoutExt.replace(/\s*[-_]?\s*[Dd]eals?\s*$/i, '').trim();

  return withoutDeals || null;
}

/**
 * Parse cost upside text to extract numeric value
 * Examples:
 *   "$0.75-2.8M per year" -> { value: 2800000, currency: 'USD' }
 *   "$500K" -> { value: 500000, currency: 'USD' }
 *   "~$1.2M" -> { value: 1200000, currency: 'USD' }
 *   "$50k-$750k" -> { value: 750000, currency: 'USD' }
 */
export function parseCostUpside(text: string): { value: number | null; currency: string } {
  if (!text || typeof text !== 'string') {
    return { value: null, currency: 'USD' };
  }

  // Detect currency
  let currency = 'USD';
  if (text.includes('€')) currency = 'EUR';
  else if (text.includes('£')) currency = 'GBP';
  else if (text.includes('¥')) currency = 'JPY';

  // Remove currency symbols and normalize
  const normalized = text
    .replace(/[$€£¥]/g, '')
    .replace(/,/g, '')
    .replace(/per\s*(year|month|quarter|annum)/gi, '')
    .replace(/annually/gi, '')
    .replace(/approx\.?/gi, '')
    .replace(/estimated?/gi, '')
    .replace(/~|approximately/gi, '')
    .trim();

  // Try to find numbers with K/M/B multipliers
  // Pattern matches: "0.75-2.8M", "500K", "1.2M", "$5.72 M"
  const rangePattern = /([\d.]+)\s*([KMBkmb])?\s*[-–—to]+\s*([\d.]+)\s*([KMBkmb])?/;
  const singlePattern = /([\d.]+)\s*([KMBkmb])?/;

  const getMultiplier = (suffix: string | undefined): number => {
    if (!suffix) return 1;
    switch (suffix.toUpperCase()) {
      case 'K': return 1000;
      case 'M': return 1000000;
      case 'B': return 1000000000;
      default: return 1;
    }
  };

  // Try range pattern first (use higher value)
  const rangeMatch = normalized.match(rangePattern);
  if (rangeMatch) {
    const lowValue = parseFloat(rangeMatch[1]!) * getMultiplier(rangeMatch[2] || rangeMatch[4]);
    const highValue = parseFloat(rangeMatch[3]!) * getMultiplier(rangeMatch[4] || rangeMatch[2]);
    // Use higher value in range
    const value = Math.max(lowValue, highValue);
    if (!isNaN(value) && value > 0) {
      return { value: Math.round(value), currency };
    }
  }

  // Try single value pattern
  const singleMatch = normalized.match(singlePattern);
  if (singleMatch) {
    const value = parseFloat(singleMatch[1]!) * getMultiplier(singleMatch[2]);
    if (!isNaN(value) && value > 0) {
      return { value: Math.round(value), currency };
    }
  }

  return { value: null, currency };
}

/**
 * Parse date from various formats
 */
function parseDate(value: unknown): string | null {
  if (!value) return null;

  // Handle Excel Date objects
  if (value instanceof Date) {
    return value.toISOString().split('T')[0]!;
  }

  // Handle string dates
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Try parsing as date
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]!;
    }

    // Try various date formats
    // DD MMM YYYY (e.g., "17 Jun 2025")
    const dmmyPattern = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/;
    const dmmyMatch = trimmed.match(dmmyPattern);
    if (dmmyMatch) {
      const d = new Date(`${dmmyMatch[2]} ${dmmyMatch[1]}, ${dmmyMatch[3]}`);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0]!;
      }
    }

    // Return original string if it looks like a date description
    if (/\d/.test(trimmed)) {
      return trimmed;
    }
  }

  // Handle Excel serial date numbers
  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return date.toISOString().split('T')[0]!;
  }

  return null;
}

/**
 * Map column header to field name
 */
function mapColumnToField(header: string): string | null {
  const normalized = header.toLowerCase().trim();
  return COLUMN_MAPPINGS[normalized] || null;
}

/**
 * Parse vendor spreadsheet from Excel file
 */
export async function parseVendorSpreadsheet(filePath: string): Promise<VendorSpreadsheetResult> {
  const result: VendorSpreadsheetResult = {
    success: false,
    vendorNameFromFile: null,
    deals: [],
    totalRows: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
    warnings: [],
  };

  // Extract vendor name from filename
  result.vendorNameFromFile = extractVendorFromFilename(filePath);

  try {
    if (filePath.endsWith('.csv')) {
      return await parseVendorSpreadsheetCSV(filePath, result);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('No worksheets found in Excel file');
    }

    logger.info('Parsing vendor spreadsheet', {
      sheetName: worksheet.name,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      vendorFromFile: result.vendorNameFromFile,
    });

    // Get headers from first row
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    const columnMapping: Map<number, string> = new Map();

    headerRow.eachCell((cell, colNumber) => {
      const headerValue = String(cell.value || '').trim();
      headers[colNumber - 1] = headerValue;

      const field = mapColumnToField(headerValue);
      if (field) {
        columnMapping.set(colNumber, field);
      }
    });

    logger.info('Column mapping', {
      headers,
      mappedFields: Array.from(columnMapping.entries())
    });

    // Check if we have the required opportunity column
    const hasOpportunityColumn = Array.from(columnMapping.values()).includes('opportunity');
    if (!hasOpportunityColumn) {
      result.warnings.push('No "Opportunity" column found. Using first text column as deal name.');
    }

    // Process data rows
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      result.totalRows++;

      try {
        const deal: Partial<VendorSpreadsheetDeal> = {
          rowNumber,
          opportunity: '',
          stage: '',
          nextSteps: '',
          lastUpdate: null,
          yearlyUnitOpportunity: '',
          costUpside: '',
          parsedDealValue: null,
          parsedCurrency: 'USD',
        };

        // Extract values based on column mapping
        row.eachCell((cell, colNumber) => {
          const field = columnMapping.get(colNumber);
          const value = cell.value;

          if (!field) {
            // If no opportunity column mapped, use first non-empty text as deal name
            if (!hasOpportunityColumn && !deal.opportunity && value) {
              const strValue = String(value).trim();
              if (strValue && strValue.length > 0) {
                deal.opportunity = strValue;
              }
            }
            return;
          }

          switch (field) {
            case 'opportunity':
              deal.opportunity = String(value || '').trim();
              break;
            case 'stage':
              deal.stage = String(value || '').trim();
              break;
            case 'nextSteps':
              deal.nextSteps = String(value || '').trim();
              break;
            case 'lastUpdate':
              deal.lastUpdate = parseDate(value);
              break;
            case 'yearlyUnitOpportunity':
              deal.yearlyUnitOpportunity = String(value || '').trim();
              break;
            case 'costUpside':
              const costUpsideText = String(value || '').trim();
              deal.costUpside = costUpsideText;
              const parsed = parseCostUpside(costUpsideText);
              deal.parsedDealValue = parsed.value;
              deal.parsedCurrency = parsed.currency;
              break;
          }
        });

        // Validate - must have opportunity (deal name)
        if (!deal.opportunity) {
          // Check if entire row is empty
          let hasAnyValue = false;
          row.eachCell((cell) => {
            if (cell.value && String(cell.value).trim()) {
              hasAnyValue = true;
            }
          });

          if (hasAnyValue) {
            result.errors.push(`Row ${rowNumber}: Missing opportunity/deal name`);
            result.errorCount++;
          }
          // Skip empty rows silently
          return;
        }

        result.deals.push(deal as VendorSpreadsheetDeal);
        result.successCount++;

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Row ${rowNumber}: ${message}`);
        result.errorCount++;
      }
    });

    result.success = result.successCount > 0;

    logger.info('Vendor spreadsheet parsing complete', {
      totalRows: result.totalRows,
      successCount: result.successCount,
      errorCount: result.errorCount,
      vendorFromFile: result.vendorNameFromFile,
    });

    return result;

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to parse vendor spreadsheet', { error: message });
    result.errors.push(`File parsing error: ${message}`);
    return result;
  }
}

/**
 * Parse vendor spreadsheet from CSV file
 */
async function parseVendorSpreadsheetCSV(
  filePath: string,
  result: VendorSpreadsheetResult
): Promise<VendorSpreadsheetResult> {
  return new Promise((resolve) => {
    let rowNumber = 1;

    createReadStream(filePath)
      .pipe(csv())
      .on('headers', (headers: string[]) => {
        logger.info('CSV headers', { headers });
      })
      .on('data', (row: Record<string, unknown>) => {
        rowNumber++;
        result.totalRows++;

        try {
          const deal: Partial<VendorSpreadsheetDeal> = {
            rowNumber,
            opportunity: '',
            stage: '',
            nextSteps: '',
            lastUpdate: null,
            yearlyUnitOpportunity: '',
            costUpside: '',
            parsedDealValue: null,
            parsedCurrency: 'USD',
          };

          for (const [header, value] of Object.entries(row)) {
            const field = mapColumnToField(header);
            if (!field) continue;

            switch (field) {
              case 'opportunity':
                deal.opportunity = String(value || '').trim();
                break;
              case 'stage':
                deal.stage = String(value || '').trim();
                break;
              case 'nextSteps':
                deal.nextSteps = String(value || '').trim();
                break;
              case 'lastUpdate':
                deal.lastUpdate = parseDate(value);
                break;
              case 'yearlyUnitOpportunity':
                deal.yearlyUnitOpportunity = String(value || '').trim();
                break;
              case 'costUpside':
                const costUpsideText = String(value || '').trim();
                deal.costUpside = costUpsideText;
                const parsed = parseCostUpside(costUpsideText);
                deal.parsedDealValue = parsed.value;
                deal.parsedCurrency = parsed.currency;
                break;
            }
          }

          if (!deal.opportunity) {
            const hasAnyValue = Object.values(row).some(v => v && String(v).trim());
            if (hasAnyValue) {
              result.errors.push(`Row ${rowNumber}: Missing opportunity/deal name`);
              result.errorCount++;
            }
            return;
          }

          result.deals.push(deal as VendorSpreadsheetDeal);
          result.successCount++;

        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Row ${rowNumber}: ${message}`);
          result.errorCount++;
        }
      })
      .on('end', () => {
        result.success = result.successCount > 0;
        logger.info('Vendor CSV parsing complete', {
          totalRows: result.totalRows,
          successCount: result.successCount,
        });
        resolve(result);
      })
      .on('error', (error: Error) => {
        result.errors.push(`CSV parsing error: ${error.message}`);
        resolve(result);
      });
  });
}

export default {
  extractVendorFromFilename,
  parseCostUpside,
  parseVendorSpreadsheet,
};
