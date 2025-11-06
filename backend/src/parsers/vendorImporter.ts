/**
 * Vendor Importer - Excel and CSV Vendor List Parser
 * Supports importing vendor lists to enhance deal discovery
 */

import ExcelJS from 'exceljs';
import { createReadStream } from 'fs';
import csv from 'csv-parser';
import logger from '../utils/logger';

export interface ImportedVendor {
  name: string;
  normalized_name: string;
  email_domains?: string[];
  website?: string;
  industry?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  notes?: string;
  status?: string;
  metadata?: Record<string, any>;
}

export interface VendorImportResult {
  success: boolean;
  vendors: ImportedVendor[];
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: string[];
  duplicates: number;
}

/**
 * Normalize vendor name for deduplication and matching
 */
export function normalizeVendorName(name: string): string {
  if (!name) return '';

  return name
    .toLowerCase()
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh)\b\.?/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract email domain from email address or website
 */
export function extractDomain(input: string): string | null {
  if (!input) return null;

  // Remove protocol and www
  const cleaned = input
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .trim();

  // If it's an email
  if (cleaned.includes('@')) {
    const parts = cleaned.split('@');
    return parts[1]?.split('/')[0] || null;
  }

  // If it's a URL/domain
  return cleaned.split('/')[0] || null;
}

/**
 * Extract multiple domains from various fields
 */
export function extractVendorDomains(vendor: Partial<ImportedVendor>, row: any): string[] {
  const domains = new Set<string>();

  // From website field
  if (vendor.website) {
    const domain = extractDomain(vendor.website);
    if (domain) domains.add(domain);
  }

  // From contact email
  if (vendor.contact_email) {
    const domain = extractDomain(vendor.contact_email);
    if (domain) domains.add(domain);
  }

  // Check for common column names in raw row
  const domainColumns = ['domain', 'domains', 'email_domain', 'email domains'];
  for (const col of domainColumns) {
    const value = row[col] || row[col.toUpperCase()] || row[col.toLowerCase()];
    if (value) {
      // Handle comma or semicolon separated domains
      const parts = value.split(/[,;]/).map((d: string) => d.trim());
      for (const part of parts) {
        const domain = extractDomain(part);
        if (domain) domains.add(domain);
      }
    }
  }

  return Array.from(domains);
}

/**
 * Map common Excel column names to our vendor fields
 */
function mapColumnToField(columnName: string): string | null {
  const normalized = columnName.toLowerCase().trim().replace(/[_\s]+/g, '_');

  const mapping: Record<string, string> = {
    // Name mappings
    vendor_name: 'name',
    vendor: 'name',
    company_name: 'name',
    company: 'name',
    name: 'name',
    manufacturer: 'name',

    // Website mappings
    website: 'website',
    url: 'website',
    web: 'website',
    site: 'website',

    // Email domain mappings
    domain: 'email_domain',
    domains: 'email_domain',
    email_domain: 'email_domain',
    email_domains: 'email_domain',

    // Contact mappings
    contact: 'contact_name',
    contact_name: 'contact_name',
    contact_person: 'contact_name',
    rep: 'contact_name',

    contact_email: 'contact_email',
    email: 'contact_email',

    contact_phone: 'contact_phone',
    phone: 'contact_phone',
    telephone: 'contact_phone',

    // Industry mappings
    industry: 'industry',
    sector: 'industry',
    vertical: 'industry',
    category: 'industry',

    // Status mappings
    status: 'status',
    active: 'status',

    // Notes mappings
    notes: 'notes',
    description: 'notes',
    comments: 'notes',
  };

  return mapping[normalized] || null;
}

/**
 * Parse vendor data from Excel file
 */
export async function parseVendorExcel(filePath: string): Promise<VendorImportResult> {
  const result: VendorImportResult = {
    success: false,
    vendors: [],
    totalRows: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
    duplicates: 0,
  };

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    // Use first worksheet
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('No worksheets found in Excel file');
    }

    logger.info(`Parsing vendor Excel file: ${worksheet.name}`, {
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

    const seenNormalizedNames = new Set<string>();

    // Process data rows (starting from row 2)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header row

      result.totalRows++;

      try {
        // Build row object
        const rowData: Record<string, any> = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          if (header) {
            rowData[header] = cell.value;
          }
        });

        // Map to vendor object
        const vendor: Partial<ImportedVendor> = {
          metadata: {},
        };

        for (const [header, value] of Object.entries(rowData)) {
          if (!value) continue;

          const field = mapColumnToField(header);
          const stringValue = String(value).trim();

          if (field === 'name') {
            vendor.name = stringValue;
            vendor.normalized_name = normalizeVendorName(stringValue);
          } else if (field === 'website') {
            vendor.website = stringValue;
          } else if (field === 'email_domain') {
            // Handle comma/semicolon separated domains
            const domains = stringValue.split(/[,;]/).map(d => d.trim()).filter(Boolean);
            vendor.email_domains = domains;
          } else if (field === 'industry') {
            vendor.industry = stringValue;
          } else if (field === 'contact_name') {
            vendor.contact_name = stringValue;
          } else if (field === 'contact_email') {
            vendor.contact_email = stringValue;
          } else if (field === 'contact_phone') {
            vendor.contact_phone = stringValue;
          } else if (field === 'notes') {
            vendor.notes = stringValue;
          } else if (field === 'status') {
            vendor.status = stringValue.toLowerCase();
          } else {
            // Store unmapped columns in metadata
            vendor.metadata![header] = stringValue;
          }
        }

        // Validate required fields
        if (!vendor.name) {
          result.errors.push(`Row ${rowNumber}: Missing vendor name`);
          result.errorCount++;
          return;
        }

        // Extract domains from various sources
        const domains = extractVendorDomains(vendor, rowData);
        if (domains.length > 0) {
          vendor.email_domains = domains;
        }

        // Check for duplicates
        if (seenNormalizedNames.has(vendor.normalized_name!)) {
          result.duplicates++;
          logger.debug(`Duplicate vendor found: ${vendor.name} (row ${rowNumber})`);
          return; // Skip duplicate
        }

        seenNormalizedNames.add(vendor.normalized_name!);

        // Set default status if not provided
        if (!vendor.status) {
          vendor.status = 'active';
        }

        result.vendors.push(vendor as ImportedVendor);
        result.successCount++;

      } catch (error: any) {
        result.errors.push(`Row ${rowNumber}: ${error.message}`);
        result.errorCount++;
        logger.warn(`Error parsing row ${rowNumber}`, { error: error.message });
      }
    });

    result.success = result.successCount > 0;

    logger.info('Vendor Excel parsing complete', {
      totalRows: result.totalRows,
      successCount: result.successCount,
      errorCount: result.errorCount,
      duplicates: result.duplicates,
    });

    return result;

  } catch (error: any) {
    logger.error('Failed to parse vendor Excel file', {
      error: error.message,
      stack: error.stack,
    });
    result.errors.push(`File parsing error: ${error.message}`);
    return result;
  }
}

/**
 * Parse vendor data from CSV file
 */
export async function parseVendorCSV(filePath: string): Promise<VendorImportResult> {
  const result: VendorImportResult = {
    success: false,
    vendors: [],
    totalRows: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
    duplicates: 0,
  };

  return new Promise((resolve) => {
    const seenNormalizedNames = new Set<string>();

    createReadStream(filePath)
      .pipe(csv())
      .on('data', (row: Record<string, any>) => {
        result.totalRows++;

        try {
          // Map to vendor object
          const vendor: Partial<ImportedVendor> = {
            metadata: {},
          };

          for (const [header, value] of Object.entries(row)) {
            if (!value) continue;

            const field = mapColumnToField(header);
            const stringValue = String(value).trim();

            if (field === 'name') {
              vendor.name = stringValue;
              vendor.normalized_name = normalizeVendorName(stringValue);
            } else if (field === 'website') {
              vendor.website = stringValue;
            } else if (field === 'email_domain') {
              const domains = stringValue.split(/[,;]/).map(d => d.trim()).filter(Boolean);
              vendor.email_domains = domains;
            } else if (field === 'industry') {
              vendor.industry = stringValue;
            } else if (field === 'contact_name') {
              vendor.contact_name = stringValue;
            } else if (field === 'contact_email') {
              vendor.contact_email = stringValue;
            } else if (field === 'contact_phone') {
              vendor.contact_phone = stringValue;
            } else if (field === 'notes') {
              vendor.notes = stringValue;
            } else if (field === 'status') {
              vendor.status = stringValue.toLowerCase();
            } else {
              vendor.metadata![header] = stringValue;
            }
          }

          // Validate
          if (!vendor.name) {
            result.errors.push(`Row ${result.totalRows}: Missing vendor name`);
            result.errorCount++;
            return;
          }

          // Extract domains
          const domains = extractVendorDomains(vendor, row);
          if (domains.length > 0) {
            vendor.email_domains = domains;
          }

          // Check duplicates
          if (seenNormalizedNames.has(vendor.normalized_name!)) {
            result.duplicates++;
            return;
          }

          seenNormalizedNames.add(vendor.normalized_name!);

          if (!vendor.status) {
            vendor.status = 'active';
          }

          result.vendors.push(vendor as ImportedVendor);
          result.successCount++;

        } catch (error: any) {
          result.errors.push(`Row ${result.totalRows}: ${error.message}`);
          result.errorCount++;
        }
      })
      .on('end', () => {
        result.success = result.successCount > 0;
        logger.info('Vendor CSV parsing complete', {
          totalRows: result.totalRows,
          successCount: result.successCount,
          errorCount: result.errorCount,
          duplicates: result.duplicates,
        });
        resolve(result);
      })
      .on('error', (error: Error) => {
        result.errors.push(`CSV parsing error: ${error.message}`);
        logger.error('Failed to parse vendor CSV file', { error: error.message });
        resolve(result);
      });
  });
}

/**
 * Auto-detect file type and parse accordingly
 */
export async function parseVendorFile(filePath: string): Promise<VendorImportResult> {
  if (filePath.endsWith('.xlsx') || filePath.endsWith('.xls')) {
    return parseVendorExcel(filePath);
  } else if (filePath.endsWith('.csv')) {
    return parseVendorCSV(filePath);
  } else {
    return {
      success: false,
      vendors: [],
      totalRows: 0,
      successCount: 0,
      errorCount: 1,
      errors: ['Unsupported file type. Please use .xlsx or .csv'],
      duplicates: 0,
    };
  }
}

export default {
  parseVendorExcel,
  parseVendorCSV,
  parseVendorFile,
  normalizeVendorName,
  extractDomain,
  extractVendorDomains,
};
