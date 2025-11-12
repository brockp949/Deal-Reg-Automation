/**
 * Standardized MBOX Parser
 *
 * Wraps the existing enhanced MBOX parser and returns standardized output.
 * This provides a consistent interface while preserving the advanced
 * 3-layer extraction, thread correlation, and confidence scoring.
 */

import { BaseParser } from './BaseParser';
import { parseEnhancedMboxFile } from './enhancedMboxMain';
import { normalizeCompanyName, domainToCompanyName, generateDealName } from '../utils/fileHelpers';
import {
  StandardizedParserOutput,
  MboxParserOptions,
  NormalizedVendor,
  NormalizedDeal,
  NormalizedContact,
  ParsingErrorSeverity,
} from '../types/parsing';
import { stat } from 'fs/promises';
import logger from '../utils/logger';

export class StandardizedMboxParser extends BaseParser {
  constructor() {
    super('StandardizedMboxParser', '2.0.0', ['mbox']);
  }

  protected getCapabilities(): string[] {
    return [
      'email_parsing',
      'thread_correlation',
      'tiered_keywords',
      '3_layer_extraction',
      'confidence_scoring',
      'deal_identification',
      'vendor_extraction',
      'contact_extraction',
    ];
  }

  /**
   * Parse MBOX file and return standardized output
   */
  async parse(filePath: string, options?: MboxParserOptions): Promise<StandardizedParserOutput> {
    const startTime = Date.now();
    const fileName = filePath.split('/').pop() || 'unknown.mbox';

    // Get file size
    let fileSize: number | undefined;
    try {
      const stats = await stat(filePath);
      fileSize = stats.size;
    } catch (error) {
      // File size is optional, continue without it
    }

    // Create output skeleton
    const output = this.createOutputSkeleton(fileName, 'email', 'mbox', fileSize);

    try {
      logger.info('Starting MBOX parsing', { fileName, fileSize });

      // Call existing enhanced parser
      const enhancedResult = await parseEnhancedMboxFile(filePath, {
        vendorDomains: options?.vendorDomains || [],
        confidenceThreshold: options?.confidenceThreshold || 0.15,
      });

      // Convert extracted deals to standardized format
      const vendorMap = new Map<string, NormalizedVendor>();
      const vendors: NormalizedVendor[] = [];
      const deals: NormalizedDeal[] = [];
      const contacts: NormalizedContact[] = [];

      // Get existing vendors for matching (this would need to be passed in or fetched)
      // For now, we'll create new vendors from domains

      // Process each extracted deal
      for (const deal of enhancedResult.extractedDeals) {
        // Extract vendor from email domain
        let vendorName: string = 'Unknown Vendor';
        let emailDomain: string | undefined;

        if (deal.source_email_domain) {
          emailDomain = deal.source_email_domain;
          vendorName = domainToCompanyName(emailDomain);
        } else if (deal.end_user_name) {
          vendorName = deal.end_user_name;
        }

        // Create or get vendor
        if (vendorName !== 'Unknown Vendor' && !vendorMap.has(vendorName)) {
          const vendor: NormalizedVendor = {
            name: vendorName,
            normalized_name: vendorName.toLowerCase().replace(/[^\w\s]/g, '').trim(),
            email_domains: emailDomain ? [emailDomain] : undefined,
            origin: 'extracted',
            confidence: deal.confidence_score || 0.5,
            source_location: `Email thread`,
          };
          vendorMap.set(vendorName, vendor);
          vendors.push(vendor);
        }

        // Normalize customer name
        const normalizedCustomerName = deal.end_user_name
          ? normalizeCompanyName(deal.end_user_name)
          : undefined;

        // Generate descriptive deal name
        const dealName = generateDealName({
          customer_name: normalizedCustomerName,
          vendor_name: vendorName,
          project_name: deal.project_name,
          deal_name: deal.deal_name,
          deal_value: deal.deal_value,
          registration_date: deal.registration_date,
          notes: deal.pre_sales_efforts,
          product_name: deal.product_name,
          product_service_requirements: deal.product_service_requirements,
        });

        // Create normalized deal
        const normalizedDeal: NormalizedDeal = {
          deal_name: dealName,
          vendor_name: vendorName,
          deal_value: deal.deal_value || 0,
          currency: deal.currency || 'USD',
          customer_name: normalizedCustomerName,
          end_user_address: deal.end_user_address,
          decision_maker_contact: deal.decision_maker_contact,
          decision_maker_email: deal.decision_maker_email,
          decision_maker_phone: deal.decision_maker_phone,
          registration_date: deal.registration_date,
          expected_close_date: deal.expected_close_date,
          contract_start_date: deal.contract_start_date,
          contract_end_date: deal.contract_end_date,
          status: 'registered',
          probability: deal.confidence_score ? Math.round(deal.confidence_score * 100) : undefined,
          deal_type: deal.deal_type,
          deployment_environment: deal.deployment_environment,
          solution_category: deal.solution_category,
          pricing_model: deal.pricing_model,
          project_name: deal.project_name,
          pre_sales_efforts: deal.pre_sales_efforts,
          product_service_requirements: deal.product_service_requirements,
          notes: deal.pre_sales_efforts,
          confidence_score: deal.confidence_score || 0.5,
          extraction_method: 'keyword',
          source_email_id: deal.source_email_id,
          source_location: `Email from ${deal.source_email_from || 'unknown'}`,
        };

        deals.push(normalizedDeal);

        // Extract contact if decision maker info is present
        if (deal.decision_maker_contact && deal.decision_maker_email) {
          const contact: NormalizedContact = {
            name: deal.decision_maker_contact,
            email: deal.decision_maker_email,
            phone: deal.decision_maker_phone,
            vendor_name: vendorName,
            role: 'decision_maker',
            source_location: `Email from ${deal.source_email_from || 'unknown'}`,
          };
          contacts.push(contact);
        }
      }

      // Add entities to output
      output.entities.vendors = vendors;
      output.entities.deals = deals;
      output.entities.contacts = contacts;

      // Add statistics
      output.statistics.emailsProcessed = enhancedResult.totalMessages;

      // Add normalized text if requested
      if (options?.includeNormalizedText) {
        // Could extract combined text from all emails
        // For now, leave undefined
      }

      // Add raw data if requested
      if (options?.includeRawData) {
        output.rawData = {
          enhancedResult,
          emailThreads: enhancedResult.emailThreads,
          keywordMatches: enhancedResult.keywordMatches,
        };
      }

      // Filter by confidence threshold
      if (options?.confidenceThreshold) {
        this.filterByConfidence(output, options.confidenceThreshold);
      }

      // Finalize output (calculates stats, validates, etc.)
      const finalOutput = this.finalizeOutput(output, startTime);

      // Log summary
      this.logParsingSummary(finalOutput);

      return finalOutput;
    } catch (error: any) {
      this.addError(
        output,
        `Failed to parse MBOX file: ${error.message}`,
        ParsingErrorSeverity.CRITICAL,
        undefined,
        { error: error.stack },
        false
      );

      // Return partial output with error
      return this.finalizeOutput(output, startTime);
    }
  }
}
