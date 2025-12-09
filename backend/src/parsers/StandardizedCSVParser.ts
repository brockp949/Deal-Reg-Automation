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
import NormalizationService from '../services/normalizationService';

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
    const sourceTags = new Set<string>();

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
      sourceTags.add('source:csv');

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
          logger.info('Using vTiger parser');
          extractedData = normalizeVTigerData(rows);
          sourceTags.add('format:vtiger');
          break;

        case 'deals_with_vendors':
          logger.info('Using Deals with Vendors parser');
          extractedData = normalizeDealsWithVendorsData(rows);
          sourceTags.add('format:deals_with_vendors');
          break;

        case 'salesforce':
          logger.info('Detected Salesforce format, using generic parser (specific parser TODO)');
          this.addWarning(output, 'Salesforce format detected but using generic parser', undefined, 'Implement Salesforce-specific parser for better extraction');
          extractedData = parseGenericCSV(rows);
          sourceTags.add('format:salesforce');
          break;

        case 'hubspot':
          logger.info('Detected HubSpot format, using generic parser (specific parser TODO)');
          this.addWarning(output, 'HubSpot format detected but using generic parser', undefined, 'Implement HubSpot-specific parser for better extraction');
          extractedData = parseGenericCSV(rows);
          sourceTags.add('format:hubspot');
          break;

        case 'zoho':
          logger.info('Detected Zoho format, using generic parser (specific parser TODO)');
          this.addWarning(output, 'Zoho format detected but using generic parser', undefined, 'Implement Zoho-specific parser for better extraction');
          extractedData = parseGenericCSV(rows);
          sourceTags.add('format:zoho');
          break;

        case 'pipedrive':
          logger.info('Detected Pipedrive format, using generic parser (specific parser TODO)');
          this.addWarning(output, 'Pipedrive format detected but using generic parser', undefined, 'Implement Pipedrive-specific parser for better extraction');
          extractedData = parseGenericCSV(rows);
          sourceTags.add('format:pipedrive');
          break;

        case 'generic':
        default:
          logger.info('Using generic CSV parser');
          extractedData = parseGenericCSV(rows);
          sourceTags.add('format:generic');
          break;
      }

      // Convert to standardized format
      const { vendors, deals, contacts } = extractedData;

      // Map vendors
      output.entities.vendors = vendors.map((v: any) => this.normalizeVendor(v));

      // Map deals
      output.entities.deals = deals.map((d: any) => this.normalizeDeal(d));

      // Map contacts
      output.entities.contacts = contacts.map((c: any) => this.normalizeContact(c));

      output.metadata.sourceTags = Array.from(sourceTags);

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
   * Detect CSV format based on headers with confidence scoring
   * Now supports multiple CRM formats: vTiger, Salesforce, HubSpot, Zoho, Pipedrive
   */
  private detectFormat(rows: any[]): 'vtiger' | 'salesforce' | 'hubspot' | 'zoho' | 'pipedrive' | 'deals_with_vendors' | 'generic' {
    if (rows.length === 0) return 'generic';

    const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());
    const scores: Record<string, number> = {};

    // vTiger detection (CRM platform)
    const vtigerSignatures = ['account_no', 'accountname', 'cf_', 'potentialname', 'related_to'];
    scores.vtiger = this.calculateFormatScore(headers, vtigerSignatures);

    // Salesforce detection
    const salesforceSignatures = ['opportunity id', 'account id', 'opportunity name', 'stage', 'close date', 'amount', 'probability'];
    scores.salesforce = this.calculateFormatScore(headers, salesforceSignatures);

    // HubSpot detection
    const hubspotSignatures = ['deal name', 'deal stage', 'pipeline', 'close date', 'amount', 'deal owner', 'company name'];
    scores.hubspot = this.calculateFormatScore(headers, hubspotSignatures);

    // Zoho detection
    const zohoSignatures = ['deal name', 'account name', 'closing date', 'amount', 'stage', 'deal owner', 'contact name'];
    scores.zoho = this.calculateFormatScore(headers, zohoSignatures);

    // Pipedrive detection
    const pipedriveSignatures = ['deal title', 'organization name', 'person name', 'value', 'status', 'expected close date', 'pipeline'];
    scores.pipedrive = this.calculateFormatScore(headers, pipedriveSignatures);

    // Deals with Vendors format detection (custom format with "Vendors ...", "Deals ..." prefixes)
    const hasVendorsPrefix = headers.some(h => h.startsWith('vendors '));
    const hasDealsPrefix = headers.some(h => h.startsWith('deals '));
    scores.deals_with_vendors = (hasVendorsPrefix && hasDealsPrefix) ? 0.95 : 0.0;

    // Find best match (require minimum 0.5 confidence)
    let bestFormat: string = 'generic';
    let bestScore = 0.5;

    for (const [format, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestFormat = format;
      }
    }

    logger.info('CSV format detected', {
      format: bestFormat,
      confidence: bestScore.toFixed(2),
      scores: Object.fromEntries(
        Object.entries(scores)
          .filter(([_, score]) => score > 0.3)
          .map(([format, score]) => [format, score.toFixed(2)])
      ),
    });

    return bestFormat as any;
  }

  /**
   * Calculate confidence score for a format based on header matches
   */
  private calculateFormatScore(headers: string[], signatures: string[]): number {
    let matchCount = 0;
    let partialMatchCount = 0;

    for (const signature of signatures) {
      // Exact match
      if (headers.includes(signature)) {
        matchCount++;
      }
      // Partial match (header contains signature or vice versa)
      else if (headers.some(h => h.includes(signature) || signature.includes(h))) {
        partialMatchCount++;
      }
    }

    // Score: full points for exact matches, half points for partial matches
    const score = (matchCount + partialMatchCount * 0.5) / signatures.length;
    return Math.min(score, 1.0);
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
    const nameResult = NormalizationService.normalizeCompanyName(v.name, { removeSuffixes: true });
    const emailResult = v.email ? NormalizationService.normalizeEmail(v.email) : null;
    const phoneResult = v.phone ? NormalizationService.normalizePhone(v.phone) : null;
    const websiteNormalized = v.website ? v.website.toLowerCase().trim() : undefined;

    return {
      name: v.name, // Keep original name for display
      normalized_name: nameResult.value.toLowerCase().replace(/[^\w\s]/g, '').trim(),
      email_domains: v.email_domain ? [v.email_domain.toLowerCase().trim()] : undefined,
      industry: v.industry,
      website: websiteNormalized,
      notes: v.notes,
      contact_name: v.contact_name,
      contact_email: emailResult?.value,
      contact_phone: phoneResult?.value,
      origin: 'imported',
      confidence: 1.0, // CSV data is typically manually entered, so high confidence
      source_location: 'CSV import',
    };
  }

  /**
   * Normalize deal from CSV parser output
   */
  private normalizeDeal(d: any): NormalizedDeal {
    const dealValueResult = NormalizationService.normalizeCurrency(d.deal_value, d.currency);
    const customerNameResult = d.customer_name ?
      NormalizationService.normalizeCompanyName(d.customer_name, { removeSuffixes: false }) : null;
    const registrationDateResult = NormalizationService.normalizeDate(d.registration_date);
    const expectedCloseDateResult = NormalizationService.normalizeDate(d.expected_close_date);
    const statusResult = NormalizationService.normalizeStatus(d.status || 'registered', 'deal');

    return {
      deal_name: d.deal_name || 'Untitled Deal',
      vendor_name: d.vendor_name || 'Unknown Vendor',
      deal_value: dealValueResult.value,
      currency: dealValueResult.currency,
      customer_name: customerNameResult?.value,
      customer_industry: d.customer_industry,
      registration_date: registrationDateResult.value || undefined,
      expected_close_date: expectedCloseDateResult.value || undefined,
      status: statusResult.value,
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
    const emailResult = c.email ? NormalizationService.normalizeEmail(c.email) : null;
    const phoneResult = c.phone ? NormalizationService.normalizePhone(c.phone) : null;

    return {
      name: c.name?.trim() || '',
      vendor_name: c.vendor_name,
      email: emailResult?.value,
      phone: phoneResult?.value,
      role: c.role || 'contact',
      is_primary: c.is_primary,
      source_location: 'CSV import',
    };
  }
}
