/**
 * Standardized CSV Parser
 *
 * Wraps existing CSV parsing logic and returns standardized output.
 * Supports multiple CRM formats with auto-detection.
 */

import { BaseParser } from './BaseParser';
import { parseCSVFile, normalizeVTigerData, parseGenericCSV, normalizeDealsWithVendorsData } from './csvParser';
import {
  StandardizedParserOutput,
  CSVParserOptions,
  NormalizedVendor,
  NormalizedDeal,
  NormalizedContact,
  ParsingErrorSeverity,
} from '../types/parsing';
import { stat } from 'fs/promises';
import logger from '../utils/logger';

export class StandardizedCSVParser extends BaseParser {
  constructor() {
    super('StandardizedCSVParser', '2.0.0', ['csv', 'vtiger_csv']);
  }

  protected getCapabilities(): string[] {
    return [
      'csv_parsing',
      'vtiger_format',
      'generic_format',
      'deals_with_vendors_format',
      'auto_format_detection',
      'vendor_extraction',
      'deal_extraction',
      'contact_extraction',
    ];
  }

  /**
   * Parse CSV file and return standardized output
   */
  async parse(filePath: string, options?: CSVParserOptions): Promise<StandardizedParserOutput> {
    const startTime = Date.now();
    const fileName = filePath.split('/').pop() || 'unknown.csv';

    // Get file size
    let fileSize: number | undefined;
    try {
      const stats = await stat(filePath);
      fileSize = stats.size;
    } catch (error) {
      // File size is optional, continue without it
    }

    // Determine file type
    const fileType = fileName.toLowerCase().includes('vtiger') ? 'vtiger_csv' : 'csv';

    // Create output skeleton
    const output = this.createOutputSkeleton(fileName, 'csv', fileType, fileSize);

    try {
      logger.info('Starting CSV parsing', { fileName, fileSize });

      // Parse CSV file
      const rows = await parseCSVFile(filePath);
      output.statistics.rowsProcessed = rows.length;

      if (rows.length === 0) {
        this.addWarning(output, 'CSV file is empty', undefined, 'Ensure the file contains data rows');
        return this.finalizeOutput(output, startTime);
      }

      // Detect format or use specified format
      let format = options?.format;
      if (!format && options?.autoDetectFormat !== false) {
        format = this.detectFormat(rows);
        logger.info('Auto-detected CSV format', { format });
      }

      // Parse based on format
      let extractedData: any;
      switch (format) {
        case 'vtiger':
          extractedData = normalizeVTigerData(rows);
          break;
        case 'generic':
          extractedData = parseGenericCSV(rows);
          break;
        default:
          // Try deals with vendors format first
          const headers = Object.keys(rows[0]);
          if (headers.some((h) => h.startsWith('Vendors ')) && headers.some((h) => h.startsWith('Deals '))) {
            extractedData = normalizeDealsWithVendorsData(rows);
          } else if (this.looksLikeVTiger(rows)) {
            extractedData = normalizeVTigerData(rows);
          } else {
            extractedData = parseGenericCSV(rows);
          }
      }

      // Convert to standardized format
      const { vendors, deals, contacts } = extractedData;

      // Map vendors
      output.entities.vendors = vendors.map((v: any) => this.normalizeVendor(v));

      // Map deals
      output.entities.deals = deals.map((d: any) => this.normalizeDeal(d));

      // Map contacts
      output.entities.contacts = contacts.map((c: any) => this.normalizeContact(c));

      // Add raw data if requested
      if (options?.includeRawData) {
        output.rawData = {
          rows,
          extractedData,
        };
      }

      // Filter by confidence threshold
      if (options?.confidenceThreshold) {
        this.filterByConfidence(output, options.confidenceThreshold);
      }

      // Finalize output
      const finalOutput = this.finalizeOutput(output, startTime);

      // Log summary
      this.logParsingSummary(finalOutput);

      return finalOutput;
    } catch (error: any) {
      this.addError(
        output,
        `Failed to parse CSV file: ${error.message}`,
        ParsingErrorSeverity.CRITICAL,
        undefined,
        { error: error.stack },
        false
      );

      return this.finalizeOutput(output, startTime);
    }
  }

  /**
   * Detect CSV format based on headers
   */
  private detectFormat(rows: any[]): 'vtiger' | 'generic' {
    if (rows.length === 0) return 'generic';

    const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());

    // vTiger detection
    const vtigerHeaders = ['account_no', 'accountname', 'cf_'];
    const vtigerMatches = vtigerHeaders.filter((h) => headers.some((header) => header.includes(h)));

    if (vtigerMatches.length >= 2) {
      return 'vtiger';
    }

    return 'generic';
  }

  /**
   * Check if rows look like vTiger format
   */
  private looksLikeVTiger(rows: any[]): boolean {
    if (rows.length === 0) return false;
    const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());
    return headers.some((h) => h.includes('account_no') || h.includes('accountname'));
  }

  /**
   * Normalize vendor from CSV parser output
   */
  private normalizeVendor(v: any): NormalizedVendor {
    return {
      name: v.name,
      normalized_name: v.name.toLowerCase().replace(/[^\w\s]/g, '').trim(),
      email_domains: v.email_domain ? [v.email_domain] : undefined,
      industry: v.industry,
      website: v.website,
      notes: v.notes,
      contact_name: v.contact_name,
      contact_email: v.email,
      contact_phone: v.phone,
      origin: 'imported',
      confidence: 1.0, // CSV data is typically manually entered, so high confidence
      source_location: 'CSV import',
    };
  }

  /**
   * Normalize deal from CSV parser output
   */
  private normalizeDeal(d: any): NormalizedDeal {
    return {
      deal_name: d.deal_name || 'Untitled Deal',
      vendor_name: d.vendor_name || 'Unknown Vendor',
      deal_value: d.deal_value || 0,
      currency: d.currency || 'USD',
      customer_name: d.customer_name,
      customer_industry: d.customer_industry,
      registration_date: d.registration_date,
      expected_close_date: d.expected_close_date,
      status: d.status || 'registered',
      deal_stage: d.deal_stage,
      probability: d.probability,
      notes: d.notes,
      confidence_score: 1.0, // High confidence for CSV data
      extraction_method: 'manual',
      source_location: 'CSV import',
    };
  }

  /**
   * Normalize contact from CSV parser output
   */
  private normalizeContact(c: any): NormalizedContact {
    return {
      name: c.name,
      vendor_name: c.vendor_name,
      email: c.email,
      phone: c.phone,
      role: c.role || 'contact',
      is_primary: c.is_primary,
      source_location: 'CSV import',
    };
  }
}
