/**
 * Parser Registry - Strategy Pattern for File Processing
 *
 * Provides a unified interface for selecting and executing the appropriate
 * parser based on file type and user intent.
 */

import logger from '../utils/logger';
import { parseVendorFile, type VendorImportResult, type ImportedVendor } from './vendorImporter';
import { parseDealFile, type DealImportResult, type ImportedDeal } from './dealImporter';
import { parseVendorSpreadsheet, extractVendorFromFilename, type VendorSpreadsheetDeal } from './vendorSpreadsheetParser';
import { parseStreamingMboxFile } from './streamingMboxParser';
import { parseEnhancedTranscript } from './enhancedTranscriptParser';
import { parsePDFTranscript } from './pdfParser';
import { parseDocxTranscript } from './docxParser';

// Intent types that users can specify
export type FileIntent = 'vendor' | 'deal' | 'email' | 'transcript' | 'vendor_spreadsheet' | 'auto';

// File metadata used for parser selection
export interface FileMetadata {
  filename: string;
  fileType: string;  // csv, xlsx, mbox, txt, pdf, docx
  filePath: string;
  fileSize?: number;
  // Aliases for compatibility
  name?: string;
  size?: number;
  type?: string;
}

// Unified parse result structure
export interface UnifiedParseResult {
  success: boolean;
  parserUsed: string;
  detectedIntent: FileIntent;

  // Entity counts
  vendors: Array<{
    name: string;
    normalized_name?: string;
    email_domains?: string[];
    website?: string;
    industry?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    notes?: string;
    status?: string;
    metadata?: Record<string, any>;
  }>;

  deals: Array<{
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
    vendor_name?: string;  // For linking to vendor
    metadata?: Record<string, any>;
  }>;

  contacts: Array<{
    name: string;
    email?: string;
    phone?: string;
    role?: string;
    vendor_name?: string;
    is_primary?: boolean;
  }>;

  // Statistics
  statistics: {
    totalRows: number;
    successCount: number;
    errorCount: number;
    duplicates: number;
  };

  errors: string[];
  warnings: string[];
}

// Parse options
export interface ParseOptions {
  vendorId?: string;          // For deal imports to specific vendor
  vendorName?: string;        // For deal imports with vendor name
  skipDuplicates?: boolean;
  confidenceThreshold?: number;
  onProgress?: (progress: number, message: string) => void;
  preview?: boolean;          // For validation preview mode
}

// Parser strategy interface
export interface ParserStrategy {
  name: string;
  description: string;
  priority: number;  // Higher = checked first
  supportedFileTypes: string[];
  supportedIntents: FileIntent[];

  canHandle(file: FileMetadata, intent: FileIntent): boolean;
  parse(file: FileMetadata, options: ParseOptions): Promise<UnifiedParseResult>;
}

/**
 * Vendor List Parser Strategy
 * Handles CSV/Excel files containing vendor lists
 */
class VendorListParserStrategy implements ParserStrategy {
  name = 'VendorListParser';
  description = 'Parses vendor list CSV/Excel files';
  priority = 90;
  supportedFileTypes = ['csv', 'xlsx', 'xls'];
  supportedIntents: FileIntent[] = ['vendor', 'auto'];

  canHandle(file: FileMetadata, intent: FileIntent): boolean {
    // Explicit vendor intent
    if (intent === 'vendor') {
      return this.supportedFileTypes.includes(file.fileType);
    }

    // Auto-detect based on filename
    if (intent === 'auto') {
      const lowerFilename = file.filename.toLowerCase();
      const hasVendorKeyword = lowerFilename.includes('vendor') ||
                               lowerFilename.includes('supplier') ||
                               lowerFilename.includes('manufacturer');
      return hasVendorKeyword && this.supportedFileTypes.includes(file.fileType);
    }

    return false;
  }

  async parse(file: FileMetadata, options: ParseOptions): Promise<UnifiedParseResult> {
    logger.info('VendorListParser processing file', { filename: file.filename });

    const result = await parseVendorFile(file.filePath);

    return {
      success: result.success,
      parserUsed: this.name,
      detectedIntent: 'vendor',
      vendors: result.vendors.map(v => ({
        name: v.name,
        normalized_name: v.normalized_name,
        email_domains: v.email_domains,
        website: v.website,
        industry: v.industry,
        contact_name: v.contact_name,
        contact_email: v.contact_email,
        contact_phone: v.contact_phone,
        notes: v.notes,
        status: v.status,
        metadata: v.metadata,
      })),
      deals: [],
      contacts: result.vendors
        .filter(v => v.contact_name && v.contact_email)
        .map(v => ({
          name: v.contact_name!,
          email: v.contact_email,
          phone: v.contact_phone,
          role: 'Primary Contact',
          vendor_name: v.name,
          is_primary: true,
        })),
      statistics: {
        totalRows: result.totalRows,
        successCount: result.successCount,
        errorCount: result.errorCount,
        duplicates: result.duplicates,
      },
      errors: result.errors,
      warnings: [],
    };
  }
}

/**
 * Deal List Parser Strategy
 * Handles CSV/Excel files containing deal lists
 */
class DealListParserStrategy implements ParserStrategy {
  name = 'DealListParser';
  description = 'Parses deal list CSV/Excel files';
  priority = 80;
  supportedFileTypes = ['csv', 'xlsx', 'xls'];
  supportedIntents: FileIntent[] = ['deal', 'auto'];

  canHandle(file: FileMetadata, intent: FileIntent): boolean {
    // Explicit deal intent
    if (intent === 'deal') {
      return this.supportedFileTypes.includes(file.fileType);
    }

    // Auto-detect based on filename
    if (intent === 'auto') {
      const lowerFilename = file.filename.toLowerCase();
      const hasDealKeyword = lowerFilename.includes('deal') ||
                             lowerFilename.includes('opportunity') ||
                             lowerFilename.includes('registration');
      return hasDealKeyword && this.supportedFileTypes.includes(file.fileType);
    }

    return false;
  }

  async parse(file: FileMetadata, options: ParseOptions): Promise<UnifiedParseResult> {
    logger.info('DealListParser processing file', { filename: file.filename });

    const result = await parseDealFile(file.filePath);

    return {
      success: result.success,
      parserUsed: this.name,
      detectedIntent: 'deal',
      vendors: [],
      deals: result.deals.map(d => ({
        deal_name: d.deal_name,
        deal_value: d.deal_value,
        currency: d.currency,
        customer_name: d.customer_name,
        customer_industry: d.customer_industry,
        registration_date: d.registration_date,
        expected_close_date: d.expected_close_date,
        status: d.status,
        deal_stage: d.deal_stage,
        probability: d.probability,
        notes: d.notes,
        vendor_name: options.vendorName,
        metadata: d.metadata as Record<string, any>,
      })),
      contacts: [],
      statistics: {
        totalRows: result.totalRows,
        successCount: result.successCount,
        errorCount: result.errorCount,
        duplicates: result.duplicates,
      },
      errors: result.errors,
      warnings: [],
    };
  }
}

/**
 * Vendor Spreadsheet Parser Strategy
 * Handles "Vendor - Deals.xlsx" format files
 */
class VendorSpreadsheetParserStrategy implements ParserStrategy {
  name = 'VendorSpreadsheetParser';
  description = 'Parses vendor-specific deal spreadsheets (Vendor - Deals.xlsx format)';
  priority = 100;  // Highest priority for this specific format
  supportedFileTypes = ['xlsx', 'xls', 'csv'];
  supportedIntents: FileIntent[] = ['vendor_spreadsheet', 'auto'];

  canHandle(file: FileMetadata, intent: FileIntent): boolean {
    // Explicit vendor_spreadsheet intent
    if (intent === 'vendor_spreadsheet') {
      return this.supportedFileTypes.includes(file.fileType);
    }

    // Auto-detect based on filename pattern: "Vendor - Deals.xlsx"
    if (intent === 'auto') {
      const vendorInfo = extractVendorFromFilename(file.filename);
      return vendorInfo !== null && this.supportedFileTypes.includes(file.fileType);
    }

    return false;
  }

  async parse(file: FileMetadata, options: ParseOptions): Promise<UnifiedParseResult> {
    logger.info('VendorSpreadsheetParser processing file', { filename: file.filename });

    // Extract vendor name from filename
    const vendorName = options.vendorName || extractVendorFromFilename(file.filename) || 'Unknown Vendor';

    const result = await parseVendorSpreadsheet(file.filePath);

    return {
      success: result.success,
      parserUsed: this.name,
      detectedIntent: 'vendor_spreadsheet',
      vendors: [{
        name: vendorName,
        normalized_name: vendorName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim(),
      }],
      deals: result.deals.map(d => ({
        deal_name: d.opportunity,
        deal_value: d.parsedDealValue || undefined,
        currency: d.parsedCurrency,
        deal_stage: d.stage,
        notes: d.nextSteps,
        vendor_name: vendorName,
        metadata: {
          lastUpdate: d.lastUpdate,
          yearlyUnitOpportunity: d.yearlyUnitOpportunity,
          costUpside: d.costUpside,
          rowNumber: d.rowNumber,
        },
      })),
      contacts: [],
      statistics: {
        totalRows: result.totalRows,
        successCount: result.successCount,
        errorCount: result.errorCount,
        duplicates: 0,
      },
      errors: result.errors,
      warnings: result.warnings || [],
    };
  }
}

/**
 * MBOX Email Parser Strategy
 * Handles email archive files
 */
class MboxParserStrategy implements ParserStrategy {
  name = 'MboxParser';
  description = 'Parses MBOX email archive files';
  priority = 100;
  supportedFileTypes = ['mbox'];
  supportedIntents: FileIntent[] = ['email', 'auto'];

  canHandle(file: FileMetadata, intent: FileIntent): boolean {
    if (intent === 'email' || intent === 'auto') {
      return file.fileType === 'mbox';
    }
    return false;
  }

  async parse(file: FileMetadata, options: ParseOptions): Promise<UnifiedParseResult> {
    logger.info('MboxParser processing file', { filename: file.filename });

    const result = await parseStreamingMboxFile(file.filePath, {
      confidenceThreshold: options.confidenceThreshold || 0.15,
      onProgress: options.onProgress ?
        (processed, total) => options.onProgress!(
          total ? Math.round((processed / total) * 100) : 0,
          `Processed ${processed} emails`
        ) : undefined,
    });

    // Extract unique vendors from deals
    const vendorSet = new Map<string, any>();
    const deals: UnifiedParseResult['deals'] = [];
    const contacts: UnifiedParseResult['contacts'] = [];

    for (const extracted of result.extractedDeals) {
      // Extract vendor from email domain
      const domain = extracted.source_email_domain;
      if (domain && !vendorSet.has(domain)) {
        vendorSet.set(domain, {
          name: extracted.end_user_name || domain.split('.')[0],
          email_domains: [domain],
        });
      }

      deals.push({
        deal_name: extracted.deal_name || extracted.project_name || 'Untitled Deal',
        deal_value: extracted.deal_value,
        currency: extracted.currency || 'USD',
        customer_name: extracted.end_user_name,
        expected_close_date: extracted.expected_close_date instanceof Date
          ? extracted.expected_close_date.toISOString()
          : extracted.expected_close_date,
        notes: extracted.pre_sales_efforts,
        vendor_name: extracted.end_user_name,
        metadata: {
          confidence_score: extracted.confidence_score,
          extraction_method: 'mbox_email_thread',
          source_email_subject: extracted.source_email_subject,
          source_email_from: extracted.source_email_from,
        },
      });

      // Extract contacts
      if (extracted.decision_maker_contact && extracted.decision_maker_email) {
        contacts.push({
          name: extracted.decision_maker_contact,
          email: extracted.decision_maker_email,
          phone: extracted.decision_maker_phone,
          vendor_name: extracted.end_user_name,
        });
      }
    }

    return {
      success: result.extractedDeals.length > 0,
      parserUsed: this.name,
      detectedIntent: 'email',
      vendors: Array.from(vendorSet.values()),
      deals,
      contacts,
      statistics: {
        totalRows: result.totalMessages,
        successCount: result.extractedDeals.length,
        errorCount: 0,
        duplicates: 0,
      },
      errors: [],
      warnings: [],
    };
  }
}

/**
 * Transcript Parser Strategy
 * Handles text, PDF, and DOCX transcript files
 */
class TranscriptParserStrategy implements ParserStrategy {
  name = 'TranscriptParser';
  description = 'Parses meeting transcript files (txt, pdf, docx)';
  priority = 100;
  supportedFileTypes = ['txt', 'pdf', 'docx', 'transcript'];
  supportedIntents: FileIntent[] = ['transcript', 'auto'];

  canHandle(file: FileMetadata, intent: FileIntent): boolean {
    if (intent === 'transcript') {
      return this.supportedFileTypes.includes(file.fileType);
    }
    if (intent === 'auto') {
      return this.supportedFileTypes.includes(file.fileType);
    }
    return false;
  }

  async parse(file: FileMetadata, options: ParseOptions): Promise<UnifiedParseResult> {
    logger.info('TranscriptParser processing file', { filename: file.filename, fileType: file.fileType });

    let textContent: string;

    // Extract text based on file type
    if (file.fileType === 'pdf') {
      textContent = await parsePDFTranscript(file.filePath);
    } else if (file.fileType === 'docx') {
      textContent = await parseDocxTranscript(file.filePath);
    } else {
      // For txt files, the enhanced parser handles reading
      textContent = '';  // Will be read by parseEnhancedTranscript
    }

    // Use enhanced NLP parser
    const result = await parseEnhancedTranscript(
      file.filePath,
      {
        buyingSignalThreshold: 0.5,
        confidenceThreshold: options.confidenceThreshold || 0.6,
      }
    );

    const vendors: UnifiedParseResult['vendors'] = [];
    const deals: UnifiedParseResult['deals'] = [];
    const contacts: UnifiedParseResult['contacts'] = [];

    if (result.deal && result.isRegisterable) {
      // Extract vendor
      if (result.deal.partner_company_name) {
        vendors.push({
          name: result.deal.partner_company_name,
        });
      }

      // Create deal record
      deals.push({
        deal_name: result.deal.deal_name || result.deal.deal_description?.substring(0, 100) || 'Transcript Deal',
        deal_value: result.deal.estimated_deal_value,
        currency: result.deal.currency || 'USD',
        customer_name: result.deal.prospect_company_name,
        expected_close_date: result.deal.expected_close_date instanceof Date
          ? result.deal.expected_close_date.toISOString()
          : result.deal.expected_close_date,
        status: 'registered',
        notes: result.deal.deal_description,
        vendor_name: result.deal.partner_company_name,
        metadata: {
          confidence_score: result.deal.confidence_score,
          buying_signal_score: result.buyingSignalScore,
          extraction_method: 'transcript_nlp',
          turn_count: result.turns.length,
        },
      });

      // Extract contacts
      if (result.deal.partner_contact_name && result.deal.partner_email) {
        contacts.push({
          name: result.deal.partner_contact_name,
          email: result.deal.partner_email,
          phone: result.deal.partner_phone,
          role: result.deal.partner_role || 'Partner',
          vendor_name: result.deal.partner_company_name,
          is_primary: true,
        });
      }

      if (result.deal.prospect_contact_name && result.deal.prospect_contact_email) {
        contacts.push({
          name: result.deal.prospect_contact_name,
          email: result.deal.prospect_contact_email,
          phone: result.deal.prospect_contact_phone,
          role: result.deal.prospect_job_title || 'Prospect',
          vendor_name: result.deal.prospect_company_name,
        });
      }
    }

    return {
      success: result.isRegisterable,
      parserUsed: this.name,
      detectedIntent: 'transcript',
      vendors,
      deals,
      contacts,
      statistics: {
        totalRows: 1,
        successCount: result.isRegisterable ? 1 : 0,
        errorCount: result.isRegisterable ? 0 : 1,
        duplicates: 0,
      },
      errors: result.isRegisterable ? [] : ['Transcript does not contain registerable deal information'],
      warnings: result.buyingSignalScore < 0.5 ? ['Low buying signal score'] : [],
    };
  }
}

/**
 * Parser Registry
 * Manages parser strategies and selects the appropriate one based on file and intent
 */
export class ParserRegistry {
  private strategies: ParserStrategy[] = [];

  constructor() {
    // Register default strategies in priority order
    this.register(new VendorSpreadsheetParserStrategy());  // Highest priority for specific format
    this.register(new MboxParserStrategy());
    this.register(new TranscriptParserStrategy());
    this.register(new VendorListParserStrategy());
    this.register(new DealListParserStrategy());
  }

  /**
   * Register a new parser strategy
   */
  register(strategy: ParserStrategy): void {
    this.strategies.push(strategy);
    // Sort by priority (descending)
    this.strategies.sort((a, b) => b.priority - a.priority);
    logger.debug('Parser strategy registered', {
      name: strategy.name,
      priority: strategy.priority
    });
  }

  /**
   * Get all registered strategies
   */
  getStrategies(): ParserStrategy[] {
    return [...this.strategies];
  }

  /**
   * Select the appropriate parser for a file and intent
   */
  selectParser(file: FileMetadata, intent: FileIntent): ParserStrategy | null {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(file, intent)) {
        logger.info('Parser selected', {
          filename: file.filename,
          intent,
          parser: strategy.name,
        });
        return strategy;
      }
    }

    logger.warn('No parser found for file', { filename: file.filename, intent });
    return null;
  }

  /**
   * Detect the intent based on file metadata
   */
  detectIntent(file: FileMetadata): FileIntent {
    // Check file type first
    if (file.fileType === 'mbox') return 'email';
    if (['txt', 'pdf', 'docx', 'transcript'].includes(file.fileType)) return 'transcript';

    // Check filename patterns
    const lowerFilename = file.filename.toLowerCase();

    // Check for vendor spreadsheet pattern
    const vendorSpreadsheetPattern = /^(.+?)\s*[-_]\s*deals?\.(xlsx?|csv)$/i;
    if (vendorSpreadsheetPattern.test(file.filename)) {
      return 'vendor_spreadsheet';
    }

    // Check for vendor keywords
    if (lowerFilename.includes('vendor') ||
        lowerFilename.includes('supplier') ||
        lowerFilename.includes('manufacturer')) {
      return 'vendor';
    }

    // Check for deal keywords
    if (lowerFilename.includes('deal') ||
        lowerFilename.includes('opportunity') ||
        lowerFilename.includes('registration')) {
      return 'deal';
    }

    // Default to auto (will use content analysis)
    return 'auto';
  }

  /**
   * Parse a file using the appropriate strategy
   */
  async parse(file: FileMetadata, intent: FileIntent, options: ParseOptions = {}): Promise<UnifiedParseResult> {
    // If intent is auto, try to detect it
    const effectiveIntent = intent === 'auto' ? this.detectIntent(file) : intent;

    // Find a parser
    const parser = this.selectParser(file, effectiveIntent);

    if (!parser) {
      // Try with auto intent as fallback
      const fallbackParser = this.selectParser(file, 'auto');
      if (!fallbackParser) {
        return {
          success: false,
          parserUsed: 'none',
          detectedIntent: effectiveIntent,
          vendors: [],
          deals: [],
          contacts: [],
          statistics: {
            totalRows: 0,
            successCount: 0,
            errorCount: 1,
            duplicates: 0,
          },
          errors: [`No parser available for file type: ${file.fileType} with intent: ${intent}`],
          warnings: [],
        };
      }
      return fallbackParser.parse(file, options);
    }

    return parser.parse(file, options);
  }
}

// Singleton instance
let registryInstance: ParserRegistry | null = null;

/**
 * Get the singleton parser registry instance
 */
export function getParserRegistry(): ParserRegistry {
  if (!registryInstance) {
    registryInstance = new ParserRegistry();
  }
  return registryInstance;
}

/**
 * Convenience function to parse a file
 */
export async function parseFile(
  file: FileMetadata,
  intent: FileIntent = 'auto',
  options: ParseOptions = {}
): Promise<UnifiedParseResult> {
  return getParserRegistry().parse(file, intent, options);
}

export default {
  ParserRegistry,
  getParserRegistry,
  parseFile,
};
