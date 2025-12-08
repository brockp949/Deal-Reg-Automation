/**
 * File Processing Orchestrator
 * Coordinates file processing workflow with proper error handling.
 *
 * This service:
 * - Determines file type and routes to appropriate processor
 * - Manages progress updates
 * - Handles errors with proper domain error types
 * - Coordinates entity persistence
 */

import { query } from '../../db';
import logger from '../../utils/logger';
import { ParsingError, VendorError, PersistenceError, wrapError, isDomainError } from '../../errors';
import {
  EntityPersistenceService,
  getEntityPersistenceService,
  VendorData,
  DealData,
  ContactData,
  PersistenceContext,
} from '../persistence';

// Import existing parsers (will be refactored later)
import { parseMboxFile, extractInfoFromEmails } from '../../parsers/mboxParser';
import { parseStreamingMboxFile } from '../../parsers/streamingMboxParser';
import { parseCSVFile, normalizeVTigerData, parseGenericCSV } from '../../parsers/csvParser';
import { parseTextTranscript, extractInfoFromTranscript } from '../../parsers/transcriptParser';
import { parseEnhancedTranscript } from '../../parsers/enhancedTranscriptParser';
import { parsePDFTranscript } from '../../parsers/pdfParser';
import { StandardizedCSVParser } from '../../parsers/StandardizedCSVParser';
import { StandardizedTranscriptParser } from '../../parsers/StandardizedTranscriptParser';
import { matchVendor } from '../VendorMatchingEngine';
import { queuePendingDeal } from '../pendingDealService';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type { FileType } from '../../types';

// ============================================================================
// Types
// ============================================================================

export interface ProcessingResult {
  vendorsCreated: number;
  dealsCreated: number;
  contactsCreated: number;
  errors: ProcessingErrorInfo[];
  /** Whether processing completed (even with some errors) */
  completed: boolean;
  /** Summary of what was processed */
  summary?: {
    emailsProcessed?: number;
    recordsProcessed?: number;
    dealsExtracted?: number;
  };
}

export interface ProcessingErrorInfo {
  code: string;
  message: string;
  isRetryable: boolean;
  context?: Record<string, unknown>;
}

export interface FileInfo {
  id: string;
  filename: string;
  fileType: FileType;
  storagePath: string;
  scanStatus?: string;
}

export type ProgressCallback = (progress: number) => Promise<void>;

// ============================================================================
// File Processing Orchestrator
// ============================================================================

export class FileProcessingOrchestrator {
  private readonly persistenceService: EntityPersistenceService;

  constructor(persistenceService?: EntityPersistenceService) {
    this.persistenceService = persistenceService || getEntityPersistenceService();
  }

  /**
   * Main entry point for file processing.
   */
  async processFile(fileId: string): Promise<ProcessingResult> {
    const result: ProcessingResult = {
      vendorsCreated: 0,
      dealsCreated: 0,
      contactsCreated: 0,
      errors: [],
      completed: false,
    };

    try {
      // Get file details
      const file = await this.getFileInfo(fileId);

      // Security check
      if (file.scanStatus && file.scanStatus !== 'passed') {
        await this.updateFileStatus(fileId, 'blocked', `File blocked pending security review (scan status: ${file.scanStatus})`);
        throw ParsingError.invalidFormat(file.fileType, 'File blocked by security scan');
      }

      // Update status to processing
      await this.updateFileStatus(fileId, 'processing');
      await this.updateProgress(fileId, 0);

      logger.info('Processing file', {
        fileId,
        filename: file.filename,
        fileType: file.fileType,
      });

      // Route to appropriate processor
      const extractedData = await this.routeToProcessor(file, fileId);

      // Process extracted data
      await this.updateProgress(fileId, 50);

      if (extractedData) {
        await this.persistExtractedData(extractedData, fileId, file.fileType, result);
      }

      // Mark as completed
      await this.updateProgress(fileId, 100);
      await this.updateFileStatus(fileId, 'completed');
      result.completed = true;

      logger.info('File processing completed', {
        fileId,
        vendorsCreated: result.vendorsCreated,
        dealsCreated: result.dealsCreated,
        contactsCreated: result.contactsCreated,
        errors: result.errors.length,
      });

      return result;

    } catch (error) {
      const errorInfo = this.convertToErrorInfo(error);
      result.errors.push(errorInfo);

      await this.updateFileStatus(
        fileId,
        'failed',
        errorInfo.message
      );

      // Re-throw domain errors, wrap others
      if (isDomainError(error)) {
        throw error;
      }
      throw wrapError(error, 'File processing failed');
    }
  }

  // ============================================================================
  // Processor Routing
  // ============================================================================

  private async routeToProcessor(file: FileInfo, fileId: string): Promise<ExtractedData | null> {
    switch (file.fileType) {
      case 'mbox':
        return this.processMbox(file.storagePath, fileId);

      case 'csv':
      case 'vtiger_csv':
        return this.processCSV(file.storagePath, file.fileType);

      case 'transcript':
      case 'txt':
        return this.processTranscript(file.storagePath, fileId);

      case 'pdf':
        return this.processPDF(file.storagePath, fileId);

      default:
        throw ParsingError.unsupportedType(file.fileType);
    }
  }

  // ============================================================================
  // Format-Specific Processors
  // ============================================================================

  private async processMbox(filePath: string, fileId: string): Promise<ExtractedData> {
    logger.info('Processing MBOX file', { filePath });

    try {
      const emails = await parseStreamingMboxFile(filePath);
      const extractedInfo = await extractInfoFromEmails(emails);

      return {
        vendors: extractedInfo.vendors || [],
        deals: extractedInfo.deals || [],
        contacts: extractedInfo.contacts || [],
        summary: {
          emailsProcessed: emails.length,
          dealsExtracted: extractedInfo.deals?.length || 0,
        },
      };
    } catch (error) {
      throw new ParsingError(
        `Failed to parse MBOX file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'mbox',
        { cause: error instanceof Error ? error : undefined, filePath }
      );
    }
  }

  private async processCSV(filePath: string, fileType: string): Promise<ExtractedData> {
    logger.info('Processing CSV file', { filePath, fileType });

    try {
      const parser = new StandardizedCSVParser();
      const result = await parser.parseFile(filePath);

      // Transform to common format
      const vendors: VendorData[] = [];
      const deals: DealData[] = [];
      const contacts: ContactData[] = [];

      for (const record of result.records) {
        if (record.vendor_name) {
          vendors.push({
            name: record.vendor_name,
            email: record.vendor_email,
          });
        }

        deals.push({
          deal_name: record.deal_name || record.opportunity_name,
          deal_value: record.deal_value || record.amount,
          customer_name: record.customer_name || record.account_name,
          expected_close_date: record.close_date,
          deal_stage: record.stage,
          probability: record.probability,
        });

        if (record.contact_name || record.contact_email) {
          contacts.push({
            name: record.contact_name || 'Unknown',
            email: record.contact_email,
            phone: record.contact_phone,
            role: record.contact_role,
          });
        }
      }

      return {
        vendors,
        deals,
        contacts,
        summary: {
          recordsProcessed: result.records.length,
        },
      };
    } catch (error) {
      throw new ParsingError(
        `Failed to parse CSV file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'csv',
        { cause: error instanceof Error ? error : undefined, filePath }
      );
    }
  }

  private async processTranscript(filePath: string, fileId: string): Promise<ExtractedData> {
    logger.info('Processing transcript file', { filePath });

    try {
      const parser = new StandardizedTranscriptParser();
      const result = await parser.parseFile(filePath);

      const vendors: VendorData[] = [];
      const deals: DealData[] = [];
      const contacts: ContactData[] = [];

      for (const item of result.items) {
        if (item.vendor) {
          vendors.push({ name: item.vendor });
        }

        if (item.deal_name || item.customer) {
          deals.push({
            deal_name: item.deal_name,
            customer_name: item.customer,
            deal_value: item.deal_value,
            notes: item.notes,
            extraction_method: 'transcript',
          });
        }

        if (item.contacts) {
          for (const contact of item.contacts) {
            contacts.push({
              name: contact.name,
              email: contact.email,
              role: contact.role,
            });
          }
        }
      }

      return {
        vendors,
        deals,
        contacts,
        summary: {
          recordsProcessed: result.items.length,
        },
      };
    } catch (error) {
      throw new ParsingError(
        `Failed to parse transcript: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'transcript',
        { cause: error instanceof Error ? error : undefined, filePath }
      );
    }
  }

  private async processPDF(filePath: string, fileId: string): Promise<ExtractedData> {
    logger.info('Processing PDF file', { filePath });

    try {
      const pdfText = await parsePDFTranscript(filePath);
      const tempFilePath = join(filePath + '.txt');

      try {
        await writeFile(tempFilePath, pdfText, 'utf-8');
        return this.processTranscript(tempFilePath, fileId);
      } finally {
        try {
          await unlink(tempFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      throw new ParsingError(
        `Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'pdf',
        { cause: error instanceof Error ? error : undefined, filePath }
      );
    }
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private async persistExtractedData(
    data: ExtractedData,
    fileId: string,
    fileType: string,
    result: ProcessingResult
  ): Promise<void> {
    const context: PersistenceContext = {
      sourceFileId: fileId,
      fileType,
    };

    // Get filename for provenance
    const fileResult = await query('SELECT filename FROM source_files WHERE id = $1', [fileId]);
    context.sourceFilename = fileResult.rows[0]?.filename;

    // Process each vendor and their associated deals/contacts
    const processedVendors = new Map<string, string>(); // vendorName -> vendorId

    for (const vendor of data.vendors) {
      try {
        const vendorResult = await this.persistenceService.findOrCreateVendor(vendor, context);
        processedVendors.set(vendor.name.toLowerCase(), vendorResult.id);
        if (vendorResult.created) {
          result.vendorsCreated++;
        }
      } catch (error) {
        if (error instanceof VendorError && error.code === 'VENDOR_002') {
          // Vendor pending approval - queue the deals
          logger.info('Vendor pending approval, queuing deals', { vendorName: vendor.name });
          await this.queueDealsForPendingVendor(vendor.name, data.deals, fileId);
        } else {
          result.errors.push(this.convertToErrorInfo(error));
        }
      }
    }

    // Create deals
    for (const deal of data.deals) {
      try {
        // Match deal to vendor
        const vendorMatch = await this.matchDealToVendor(deal, processedVendors);

        if (vendorMatch) {
          const dealResult = await this.persistenceService.createDeal(deal, vendorMatch, context);
          result.dealsCreated++;
        } else {
          logger.warn('Could not match deal to vendor', { dealName: deal.deal_name });
        }
      } catch (error) {
        result.errors.push(this.convertToErrorInfo(error));
      }
    }

    // Create contacts
    for (const contact of data.contacts) {
      try {
        // Match contact to vendor (use first vendor if no specific match)
        const vendorId = processedVendors.values().next().value;

        if (vendorId) {
          const contactResult = await this.persistenceService.createContact(contact, vendorId, context);
          if (contactResult.created) {
            result.contactsCreated++;
          }
        }
      } catch (error) {
        result.errors.push(this.convertToErrorInfo(error));
      }
    }

    result.summary = data.summary;
  }

  private async matchDealToVendor(
    deal: DealData,
    processedVendors: Map<string, string>
  ): Promise<string | null> {
    // Try to match by customer name or other fields
    if (deal.customer_name) {
      const vendorId = processedVendors.get(deal.customer_name.toLowerCase());
      if (vendorId) return vendorId;
    }

    // Use vendor matching engine
    const matchResult = await matchVendor({
      extractedName: deal.customer_name,
    });

    if (matchResult.matched && matchResult.vendor) {
      return matchResult.vendor.id;
    }

    // Default to first vendor if only one
    if (processedVendors.size === 1) {
      return processedVendors.values().next().value;
    }

    return null;
  }

  private async queueDealsForPendingVendor(
    vendorName: string,
    deals: DealData[],
    fileId: string
  ): Promise<void> {
    for (const deal of deals) {
      try {
        await queuePendingDeal({
          vendorName,
          dealData: deal,
          sourceFileId: fileId,
        });
      } catch (error) {
        logger.error('Failed to queue pending deal', {
          vendorName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async getFileInfo(fileId: string): Promise<FileInfo> {
    const result = await query(
      'SELECT id, filename, file_type, storage_path, scan_status FROM source_files WHERE id = $1',
      [fileId]
    );

    if (result.rows.length === 0) {
      throw PersistenceError.foreignKeyViolation('source_file', fileId);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      filename: row.filename,
      fileType: row.file_type as FileType,
      storagePath: row.storage_path,
      scanStatus: row.scan_status,
    };
  }

  private async updateFileStatus(fileId: string, status: string, errorMessage?: string): Promise<void> {
    if (errorMessage) {
      await query(
        `UPDATE source_files
         SET processing_status = $1, error_message = $2,
             processing_completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE processing_completed_at END
         WHERE id = $3`,
        [status, errorMessage, fileId]
      );
    } else {
      await query(
        `UPDATE source_files
         SET processing_status = $1,
             processing_started_at = CASE WHEN $1 = 'processing' THEN CURRENT_TIMESTAMP ELSE processing_started_at END,
             processing_completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE processing_completed_at END
         WHERE id = $2`,
        [status, fileId]
      );
    }
  }

  private async updateProgress(fileId: string, progress: number): Promise<void> {
    await query(
      `UPDATE source_files
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{progress}', $1::text::jsonb)
       WHERE id = $2`,
      [progress.toString(), fileId]
    );
  }

  private convertToErrorInfo(error: unknown): ProcessingErrorInfo {
    if (isDomainError(error)) {
      return {
        code: error.code,
        message: error.message,
        isRetryable: error.isRetryable,
        context: error.context,
      };
    }

    if (error instanceof Error) {
      return {
        code: 'UNKNOWN',
        message: error.message,
        isRetryable: false,
      };
    }

    return {
      code: 'UNKNOWN',
      message: 'An unexpected error occurred',
      isRetryable: false,
    };
  }
}

// ============================================================================
// Types for Internal Use
// ============================================================================

interface ExtractedData {
  vendors: VendorData[];
  deals: DealData[];
  contacts: ContactData[];
  summary?: {
    emailsProcessed?: number;
    recordsProcessed?: number;
    dealsExtracted?: number;
  };
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultOrchestrator: FileProcessingOrchestrator | null = null;

export function getFileProcessingOrchestrator(): FileProcessingOrchestrator {
  if (!defaultOrchestrator) {
    defaultOrchestrator = new FileProcessingOrchestrator();
  }
  return defaultOrchestrator;
}

export function resetFileProcessingOrchestrator(): void {
  defaultOrchestrator = null;
}

export default FileProcessingOrchestrator;
