import { query } from '../db';
import { withTransaction } from '../utils/database';
import logger from '../utils/logger';
import type { FileType } from '../types';
import { PoolClient } from 'pg';

interface ProcessingResult {
  vendorsCreated: number;
  dealsCreated: number;
  contactsCreated: number;
  errors: string[];
}

interface ProcessingMetrics {
  startTime: Date;
  parseTime?: number;
  vendorTime?: number;
  dealTime?: number;
  contactTime?: number;
}

/**
 * Enhanced file processor with better error handling and transactions
 */
export class FileProcessorV2 {
  private fileId: string;
  private metrics: ProcessingMetrics;

  constructor(fileId: string) {
    this.fileId = fileId;
    this.metrics = { startTime: new Date() };
  }

  /**
   * Main processing entry point with comprehensive error handling
   */
  async process(): Promise<ProcessingResult> {
    const result: ProcessingResult = {
      vendorsCreated: 0,
      dealsCreated: 0,
      contactsCreated: 0,
      errors: [],
    };

    try {
      // Update status to processing
      await this.updateStatus('processing', 0);

      // Get and validate file
      const file = await this.getFile();
      await this.validateFile(file);

      // Parse file based on type
      await this.updateProgress(10, 'Parsing file...');
      const parseStart = Date.now();
      const extractedData = await this.parseFile(file);
      this.metrics.parseTime = Date.now() - parseStart;

      // Process within a transaction for atomicity
      await withTransaction(async (client) => {
        await this.updateProgress(40, 'Processing vendors...');
        const vendorStart = Date.now();
        const vendorResults = await this.processVendors(client, extractedData.vendors);
        result.vendorsCreated = vendorResults.created;
        result.errors.push(...vendorResults.errors);
        this.metrics.vendorTime = Date.now() - vendorStart;

        await this.updateProgress(60, 'Processing deals...');
        const dealStart = Date.now();
        const dealResults = await this.processDeals(
          client,
          extractedData.deals,
          vendorResults.vendorMap
        );
        result.dealsCreated = dealResults.created;
        result.errors.push(...dealResults.errors);
        this.metrics.dealTime = Date.now() - dealStart;

        await this.updateProgress(80, 'Processing contacts...');
        const contactStart = Date.now();
        const contactResults = await this.processContacts(
          client,
          extractedData.contacts,
          vendorResults.vendorMap
        );
        result.contactsCreated = contactResults.created;
        result.errors.push(...contactResults.errors);
        this.metrics.contactTime = Date.now() - contactStart;
      });

      // Update to completed
      await this.updateProgress(100, 'Complete');
      await this.updateStatus('completed', 100, result);

      this.logMetrics(result);

      return result;
    } catch (error: any) {
      logger.error('File processing failed', {
        fileId: this.fileId,
        error: error.message,
        stack: error.stack,
      });

      await this.updateStatus('failed', 0, undefined, error.message);
      throw error;
    }
  }

  /**
   * Get file from database
   */
  private async getFile() {
    const fileResult = await query('SELECT * FROM source_files WHERE id = $1', [
      this.fileId,
    ]);

    if (fileResult.rows.length === 0) {
      throw new Error(`File not found: ${this.fileId}`);
    }

    return fileResult.rows[0];
  }

  /**
   * Validate file is ready for processing
   */
  private async validateFile(file: any) {
    // Check scan status
    if (file.scan_status && file.scan_status !== 'passed') {
      throw new Error(
        `File blocked by security scan (status: ${file.scan_status})`
      );
    }

    // Check file exists
    // TODO: Add file existence check

    logger.info(`Processing file: ${file.filename} (${file.file_type})`);
  }

  /**
   * Parse file based on type
   */
  private async parseFile(file: any): Promise<any> {
    // Import parsers dynamically to avoid circular dependencies
    const { processFile } = await import('./fileProcessor');

    // This would call the appropriate parser
    // For now, delegate to existing fileProcessor
    // In a full refactor, we'd split out the parsing logic
    throw new Error('Parse delegation not implemented - use existing fileProcessor');
  }

  /**
   * Process vendors with error handling
   */
  private async processVendors(
    client: PoolClient,
    vendors: any[]
  ): Promise<{ created: number; errors: string[]; vendorMap: Map<string, string> }> {
    const vendorMap = new Map<string, string>();
    let created = 0;
    const errors: string[] = [];

    for (const vendorData of vendors) {
      try {
        const vendorId = await this.createOrGetVendor(client, vendorData);
        vendorMap.set(vendorData.name, vendorId);
        created++;
      } catch (error: any) {
        errors.push(`Vendor error (${vendorData.name}): ${error.message}`);
        logger.warn('Failed to create vendor', {
          vendor: vendorData.name,
          error: error.message,
        });
      }
    }

    return { created, errors, vendorMap };
  }

  /**
   * Process deals with error handling
   */
  private async processDeals(
    client: PoolClient,
    deals: any[],
    vendorMap: Map<string, string>
  ): Promise<{ created: number; errors: string[] }> {
    let created = 0;
    const errors: string[] = [];

    for (const dealData of deals) {
      try {
        const vendorId = vendorMap.get(dealData.vendor_name);
        if (!vendorId) {
          errors.push(`No vendor found for deal: ${dealData.deal_name}`);
          continue;
        }

        await this.createDeal(client, dealData, vendorId);
        created++;
      } catch (error: any) {
        errors.push(`Deal error (${dealData.deal_name}): ${error.message}`);
        logger.warn('Failed to create deal', {
          deal: dealData.deal_name,
          error: error.message,
        });
      }
    }

    return { created, errors };
  }

  /**
   * Process contacts with error handling
   */
  private async processContacts(
    client: PoolClient,
    contacts: any[],
    vendorMap: Map<string, string>
  ): Promise<{ created: number; errors: string[] }> {
    let created = 0;
    const errors: string[] = [];

    for (const contactData of contacts) {
      try {
        const vendorId = vendorMap.get(contactData.vendor_name);
        if (!vendorId) {
          errors.push(`No vendor found for contact: ${contactData.name}`);
          continue;
        }

        await this.createContact(client, contactData, vendorId);
        created++;
      } catch (error: any) {
        errors.push(`Contact error (${contactData.name}): ${error.message}`);
        logger.warn('Failed to create contact', {
          contact: contactData.name,
          error: error.message,
        });
      }
    }

    return { created, errors };
  }

  /**
   * Create or get existing vendor
   */
  private async createOrGetVendor(
    client: PoolClient,
    vendorData: any
  ): Promise<string> {
    // TODO: Implement vendor creation with approval workflow
    throw new Error('Not implemented');
  }

  /**
   * Create deal
   */
  private async createDeal(
    client: PoolClient,
    dealData: any,
    vendorId: string
  ): Promise<void> {
    // TODO: Implement deal creation
    throw new Error('Not implemented');
  }

  /**
   * Create contact
   */
  private async createContact(
    client: PoolClient,
    contactData: any,
    vendorId: string
  ): Promise<void> {
    // TODO: Implement contact creation
    throw new Error('Not implemented');
  }

  /**
   * Update file processing status
   */
  private async updateStatus(
    status: string,
    progress: number,
    result?: ProcessingResult,
    errorMessage?: string
  ) {
    const updates: any = {
      processing_status: status,
      metadata: JSON.stringify({ progress, ...result }),
    };

    if (status === 'processing') {
      updates.processing_started_at = new Date();
    } else if (status === 'completed') {
      updates.processing_completed_at = new Date();
    }

    if (errorMessage) {
      updates.error_message = errorMessage;
    }

    const setClauses = Object.keys(updates)
      .map((key, i) => `${key} = $${i + 2}`)
      .join(', ');

    await query(
      `UPDATE source_files SET ${setClauses} WHERE id = $1`,
      [this.fileId, ...Object.values(updates)]
    );
  }

  /**
   * Update progress
   */
  private async updateProgress(progress: number, message?: string) {
    await query(
      `UPDATE source_files
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{progress}', $1::text::jsonb)
       WHERE id = $2`,
      [progress.toString(), this.fileId]
    );

    if (message) {
      logger.info(`File processing progress: ${progress}%`, {
        fileId: this.fileId,
        message,
      });
    }
  }

  /**
   * Log performance metrics
   */
  private logMetrics(result: ProcessingResult) {
    const totalTime = Date.now() - this.metrics.startTime.getTime();

    logger.info('File processing metrics', {
      fileId: this.fileId,
      totalTime: `${totalTime}ms`,
      parseTime: this.metrics.parseTime ? `${this.metrics.parseTime}ms` : 'N/A',
      vendorTime: this.metrics.vendorTime ? `${this.metrics.vendorTime}ms` : 'N/A',
      dealTime: this.metrics.dealTime ? `${this.metrics.dealTime}ms` : 'N/A',
      contactTime: this.metrics.contactTime ? `${this.metrics.contactTime}ms` : 'N/A',
      vendorsCreated: result.vendorsCreated,
      dealsCreated: result.dealsCreated,
      contactsCreated: result.contactsCreated,
      errorCount: result.errors.length,
    });
  }
}
