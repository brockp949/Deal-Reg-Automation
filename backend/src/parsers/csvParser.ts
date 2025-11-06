import { createReadStream } from 'fs';
import csvParser from 'csv-parser';
import { ParsedCSVRow } from '../types';
import logger from '../utils/logger';

/**
 * Parse CSV file
 */
export async function parseCSVFile(filePath: string): Promise<ParsedCSVRow[]> {
  return new Promise((resolve, reject) => {
    const rows: ParsedCSVRow[] = [];

    createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', () => {
        logger.info(`Successfully parsed ${rows.length} rows from CSV file`);
        resolve(rows);
      })
      .on('error', (error) => {
        logger.error('Error parsing CSV file', { error: error.message });
        reject(error);
      });
  });
}

/**
 * Normalize Deals with Vendors CSV format
 * This format has separate "Vendors ..." and "Deals ..." columns
 */
export function normalizeDealsWithVendorsData(rows: ParsedCSVRow[]): {
  vendors: any[];
  deals: any[];
  contacts: any[];
} {
  const vendors: any[] = [];
  const deals: any[] = [];
  const contacts: any[] = [];

  const vendorMap = new Map<string, any>();

  rows.forEach((row) => {
    // Extract vendor information from "Vendors ..." columns
    const vendorName = row['Vendors Vendor Name'];
    const vendorEmail = row['Vendors Primary Email'];
    const vendorWebsite = row['Vendors Website'];

    if (vendorName) {
      // Add vendor if not already in map
      if (!vendorMap.has(vendorName as string)) {
        const vendor = {
          name: vendorName,
          email: vendorEmail || null,
          website: vendorWebsite || null,
          industry: row['Vendors Industry'] || null,
        };

        vendorMap.set(vendorName as string, vendor);
        vendors.push(vendor);
      }

      // Extract deal information from "Deals ..." columns
      const dealName = row['Deals Deal Name'];

      // Only create deal if deal name exists
      if (dealName && dealName.toString().trim()) {
        const customerName = row['Deals Organization Name'];

        const deal = {
          vendor_name: vendorName,
          deal_name: dealName,
          deal_value: parseAmount(row['Deals Amount'] || row['Deals Deal Value']),
          currency: row['Deals Currency'] || 'USD',
          customer_name: customerName || null, // Organization Name is the CUSTOMER
          customer_industry: row['Deals Industry'],
          registration_date: parseDate(row['Deals Registration Date'] || row['Deals Created Date']),
          expected_close_date: parseDate(row['Deals Expected Close Date']),
          status: normalizeStatus(row['Deals Sales Stage'] || row['Deals Status']),
          deal_stage: row['Deals Sales Stage'] || row['Deals Stage'] || null,
          probability: row['Deals Probability'] ? parseFloat(String(row['Deals Probability'])) : null,
          notes: row['Deals Description'] || row['Deals Notes'] || null,
        };

        deals.push(deal);
      }

      // Extract contact from vendor email if available
      if (vendorEmail) {
        const contact = {
          vendor_name: vendorName,
          name: row['Vendors Contact Name'] || 'Primary Contact',
          email: vendorEmail,
          phone: row['Vendors Phone'] || null,
          role: row['Vendors Contact Role'] || 'Primary',
          is_primary: true,
        };

        contacts.push(contact);
      }
    }
  });

  logger.info('Deals with Vendors CSV data normalized', {
    vendors: vendors.length,
    deals: deals.length,
    contacts: contacts.length,
  });

  return { vendors, deals, contacts };
}

/**
 * Normalize vTiger CSV data to our schema
 * This mapping handles common vTiger field names
 */
export function normalizeVTigerData(rows: ParsedCSVRow[]): {
  vendors: any[];
  deals: any[];
  contacts: any[];
} {
  const vendors: any[] = [];
  const deals: any[] = [];
  const contacts: any[] = [];

  const vendorMap = new Map<string, any>();

  rows.forEach((row) => {
    // Extract vendor information
    // Support both standard and "Deals ..." prefixed column names
    const vendorName =
      row['Account Name'] ||
      row['Organization Name'] ||
      row['Deals Organization Name'] ||
      row['Company'] ||
      row['Vendor Name'];

    if (vendorName) {
      if (!vendorMap.has(vendorName as string)) {
        const vendor = {
          name: vendorName,
          industry: row['Industry'] || row['Sector'],
          website: row['Website'] || row['URL'],
          notes: row['Description'] || row['Deals Description'] || row['Notes'],
        };

        vendorMap.set(vendorName as string, vendor);
        vendors.push(vendor);
      }

      // Extract deal information
      const dealName =
        row['Opportunity Name'] ||
        row['Deal Name'] ||
        row['Deals Deal Name'] ||
        row['Subject'];

      if (dealName) {
        const deal = {
          vendor_name: vendorName,
          deal_name: dealName,
          deal_value: parseAmount(
            row['Amount'] ||
            row['Deals Amount'] ||
            row['Value'] ||
            row['Deal Value']
          ),
          currency: row['Currency'] || 'USD',
          customer_name: row['Customer'] || row['End Customer'] || row['Account'],
          customer_industry: row['Customer Industry'],
          registration_date: parseDate(row['Registration Date'] || row['Created Date'] || row['Date']),
          expected_close_date: parseDate(
            row['Expected Close Date'] ||
            row['Close Date'] ||
            row['Closing Date'] ||
            row['Deals Expected Close Date']
          ),
          status: normalizeStatus(row['Status'] || row['Sales Stage'] || row['Deals Sales Stage']),
          deal_stage: row['Sales Stage'] || row['Deals Sales Stage'] || row['Stage'],
          probability: (row['Probability'] || row['Win Probability']) ? parseFloat(String(row['Probability'] || row['Win Probability'])) : null,
          notes: row['Description'] || row['Deals Description'] || row['Notes'] || row['Comments'] || row['Deals Next Step'],
        };

        deals.push(deal);
      }

      // Extract contact information
      const contactName =
        row['Contact Name'] ||
        row['Deals Contact Name'] ||
        row['Primary Contact'];
      const contactEmail = row['Email'] || row['Contact Email'];

      if (contactName || contactEmail) {
        const contact = {
          vendor_name: vendorName,
          name: contactName || 'Unknown',
          email: contactEmail,
          phone: row['Phone'] || row['Contact Phone'],
          role: row['Role'] || row['Title'] || row['Position'],
        };

        contacts.push(contact);
      }
    }
  });

  logger.info('vTiger data normalized', {
    vendors: vendors.length,
    deals: deals.length,
    contacts: contacts.length,
  });

  return { vendors, deals, contacts };
}

/**
 * Parse amount string to number
 */
function parseAmount(value: any): number {
  if (!value) return 0;

  const str = value.toString().replace(/[,$]/g, '');
  const num = parseFloat(str);

  return isNaN(num) ? 0 : num;
}

/**
 * Parse date string to Date object
 */
function parseDate(value: any): Date | null {
  if (!value) return null;

  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Normalize status values to our standard statuses
 */
function normalizeStatus(status: any): string {
  if (!status) return 'registered';

  const statusStr = status.toString().toLowerCase();

  if (statusStr.includes('won') || statusStr.includes('closed won')) {
    return 'closed-won';
  } else if (statusStr.includes('lost') || statusStr.includes('closed lost')) {
    return 'closed-lost';
  } else if (statusStr.includes('approved')) {
    return 'approved';
  } else if (statusStr.includes('rejected')) {
    return 'rejected';
  } else {
    return 'registered';
  }
}

/**
 * Generic CSV parser that attempts to auto-detect structure
 */
export function parseGenericCSV(rows: ParsedCSVRow[]): {
  vendors: any[];
  deals: any[];
  contacts: any[];
} {
  if (!rows || rows.length === 0) {
    logger.warn('No rows to parse');
    return { vendors: [], deals: [], contacts: [] };
  }

  // Check for "Deals with Vendors" format (has both "Vendors Vendor Name" and "Deals Deal Name" columns)
  const hasDealsWithVendorsFormat = rows.some(
    (row) =>
      row['Vendors Vendor Name'] !== undefined ||
      (row['Vendors Website'] !== undefined && row['Deals Deal Name'] !== undefined)
  );

  if (hasDealsWithVendorsFormat) {
    logger.info('Detected Deals with Vendors CSV format');
    return normalizeDealsWithVendorsData(rows);
  }

  // Try vTiger format
  const hasVTigerFields = rows.some(
    (row) =>
      row['Account Name'] ||
      row['Opportunity Name'] ||
      row['Organization Name'] ||
      row['Deals Organization Name'] ||
      row['Deals Deal Name']
  );

  if (hasVTigerFields) {
    logger.info('Detected vTiger CSV format');
    return normalizeVTigerData(rows);
  }

  // Fallback: basic extraction
  const vendors: any[] = [];
  const deals: any[] = [];
  const contacts: any[] = [];

  logger.warn('Could not detect CSV format, using basic extraction');

  // Try to find vendor/company columns
  const headers = Object.keys(rows[0] || {});
  const companyColumn = headers.find(
    (h) =>
      h.toLowerCase().includes('company') ||
      h.toLowerCase().includes('vendor') ||
      h.toLowerCase().includes('organization')
  );

  if (companyColumn) {
    rows.forEach((row) => {
      const vendorName = row[companyColumn];
      if (vendorName) {
        vendors.push({
          name: vendorName,
        });
      }
    });
  }

  return { vendors, deals, contacts };
}
