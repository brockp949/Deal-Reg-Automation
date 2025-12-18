// @ts-nocheck
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
import { getColumnMapper } from '../skills/IntelligentColumnMapper';
import { isSkillEnabled } from '../config/claude';

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
 * Map column header to field name (fallback when skill disabled)
 */
function mapColumnToField(header: string): string | null {
  const normalized = header.toLowerCase().trim();
  return COLUMN_MAPPINGS[normalized] || null;
}

/**
 * Define target schema for vendor spreadsheet
 */
const VENDOR_SPREADSHEET_SCHEMA = {
  opportunity: {
    type: 'string' as const,
    description: 'Deal or opportunity name',
    required: true,
    examples: ['Project Phoenix', 'Acme Corp Deal', 'Q1 Expansion'],
  },
  stage: {
    type: 'string' as const,
    description: 'Deal stage or status',
    required: false,
    examples: ['Qualified', 'Proposal', 'Negotiation', 'Closed Won'],
  },
  nextSteps: {
    type: 'string' as const,
    description: 'Next action items or notes',
    required: false,
    examples: ['Follow up call', 'Send proposal', 'Schedule demo'],
  },
  lastUpdate: {
    type: 'date' as const,
    description: 'Last update date',
    required: false,
    examples: ['2025-12-17', '12/17/2025', '17 Dec 2025'],
  },
  yearlyUnitOpportunity: {
    type: 'string' as const,
    description: 'Unit volume or quantity information',
    required: false,
    examples: ['1000 units', '500K annually', '250 licenses'],
  },
  costUpside: {
    type: 'string' as const,
    description: 'Revenue potential or deal value',
    required: false,
    examples: ['$500K', '$1.2M-2.5M', '€750K per year'],
  },
};

/**
 * Build intelligent column mapping using Claude skill
 */
async function buildIntelligentColumnMapping(
  headers: string[],
  sampleRows: Array<Record<string, any>>
): Promise<Map<number, string>> {
  const columnMapping = new Map<number, string>();

  // Check if skill is enabled
  if (!isSkillEnabled('intelligentColumnMapper')) {
    logger.info('IntelligentColumnMapper skill disabled, using fallback');
    // Fallback to hardcoded mappings
    headers.forEach((header, index) => {
      const field = mapColumnToField(header);
      if (field) {
        columnMapping.set(index + 1, field); // ExcelJS uses 1-based indexing
      }
    });
    return columnMapping;
  }

  try {
    logger.info('Using IntelligentColumnMapper skill for dynamic column mapping');
    const mapper = getColumnMapper();

    // Prepare sample data for intelligent mapping
    const sampleData = sampleRows.map((row) => {
      const obj: Record<string, any> = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });

    const mappingResult = await mapper.mapColumns({
      headers,
      sampleRows: sampleData,
      targetSchema: VENDOR_SPREADSHEET_SCHEMA,
    });

    logger.info('IntelligentColumnMapper result', {
      mappingCount: mappingResult.mappings.length,
      averageConfidence: mappingResult.summary.averageConfidence,
      unmappedColumns: mappingResult.summary.unmappedSourceColumns,
    });

    // Build column mapping from result
    mappingResult.mappings.forEach((mapping) => {
      const columnIndex = headers.indexOf(mapping.sourceColumn) + 1; // ExcelJS 1-based
      if (columnIndex > 0 && mapping.confidence >= 0.5) {
        columnMapping.set(columnIndex, mapping.targetField);
        logger.debug('Mapped column', {
          source: mapping.sourceColumn,
          target: mapping.targetField,
          confidence: mapping.confidence,
        });
      } else if (columnIndex > 0) {
        logger.warn('Low confidence mapping skipped', {
          source: mapping.sourceColumn,
          target: mapping.targetField,
          confidence: mapping.confidence,
        });
      }
    });

    return columnMapping;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('IntelligentColumnMapper failed, falling back to hardcoded mappings', {
      error: message,
    });

    // Fallback to hardcoded mappings on error
    headers.forEach((header, index) => {
      const field = mapColumnToField(header);
      if (field) {
        columnMapping.set(index + 1, field);
      }
    });
    return columnMapping;
  }
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

    headerRow.eachCell((cell, colNumber) => {
      const headerValue = String(cell.value || '').trim();
      headers[colNumber - 1] = headerValue;
    });

    // Extract sample rows for intelligent mapping (first 5 data rows)
    const sampleRows: Array<Record<string, any>> = [];
    let sampleRowCount = 0;
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1 || sampleRowCount >= 5) return; // Skip header, limit to 5 samples

      const rowData: Record<string, any> = {};
      row.eachCell((cell, colNumber) => {
        rowData[colNumber - 1] = cell.value;
      });
      sampleRows.push(rowData);
      sampleRowCount++;
    });

    // Build intelligent column mapping
    const columnMapping = await buildIntelligentColumnMapping(headers, sampleRows);

    logger.info('Column mapping complete', {
      headers,
      mappedFieldCount: columnMapping.size,
      mappedFields: Array.from(columnMapping.entries()),
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
    let headers: string[] = [];
    const allRows: Array<Record<string, unknown>> = [];
    let columnMapping: Map<number, string> | null = null;

    createReadStream(filePath)
      .pipe(csv())
      .on('headers', (csvHeaders: string[]) => {
        headers = csvHeaders;
        logger.info('CSV headers', { headers });
      })
      .on('data', (row: Record<string, unknown>) => {
        allRows.push(row);
      })
      .on('end', async () => {
        try {
          // Extract sample rows for intelligent mapping (first 5 rows)
          const sampleRows = allRows.slice(0, 5).map((row) => {
            const rowData: Record<string, any> = {};
            headers.forEach((header, index) => {
              rowData[index] = row[header];
            });
            return rowData;
          });

          // Build intelligent column mapping
          columnMapping = await buildIntelligentColumnMapping(headers, sampleRows);

          logger.info('CSV column mapping complete', {
            headers,
            mappedFieldCount: columnMapping.size,
          });

          // Process all rows with the mapping
          for (const row of allRows) {
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
                const headerIndex = headers.indexOf(header) + 1; // 1-based
                const field = columnMapping.get(headerIndex);
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
                const hasAnyValue = Object.values(row).some((v) => v && String(v).trim());
                if (hasAnyValue) {
                  result.errors.push(`Row ${rowNumber}: Missing opportunity/deal name`);
                  result.errorCount++;
                }
                continue;
              }

              result.deals.push(deal as VendorSpreadsheetDeal);
              result.successCount++;
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error';
              result.errors.push(`Row ${rowNumber}: ${message}`);
              result.errorCount++;
            }
          }

          result.success = result.successCount > 0;
          logger.info('Vendor CSV parsing complete', {
            totalRows: result.totalRows,
            successCount: result.successCount,
          });
          resolve(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`CSV parsing error: ${message}`);
          resolve(result);
        }
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
