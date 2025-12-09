import { access, stat } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { PoolClient } from 'pg';
import { query } from '../db';
import { withTransaction } from '../utils/database';
import logger from '../utils/logger';
import { StandardizedCSVParser } from '../parsers/StandardizedCSVParser';
import { StandardizedTranscriptParser } from '../parsers/StandardizedTranscriptParser';
import { StandardizedMboxParser } from '../parsers/StandardizedMboxParser';
import {
  NormalizedContact,
  NormalizedDeal,
  NormalizedVendor,
  StandardizedParserOutput,
} from '../types/parsing';
import { ensureVendorApproved } from './vendorApprovalService';
import { VendorApprovalDeniedError, VendorApprovalPendingError } from '../errors/vendorApprovalErrors';
import { createJob, startJob, updateJobProgress, completeJob, failJob } from './jobTracker';
import { logParsingError } from './errorTrackingService';
import {
  trackContactProvenance,
  trackDealProvenance,
  trackVendorProvenance,
  SourceType as ProvenanceSourceType,
  ExtractionMethod as ProvenanceExtractionMethod,
} from './provenanceTracker';

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

type ParsedBundle = {
  vendors: NormalizedVendor[];
  deals: NormalizedDeal[];
  contacts: NormalizedContact[];
  output: StandardizedParserOutput;
  validationErrors: string[];
  validationWarnings: string[];
};

/**
 * Enhanced file processor with better error handling and transactions
 */
export class FileProcessorV2 {
  private fileId: string;
  private metrics: ProcessingMetrics;
  private parserIssues: string[];
  private jobId?: string;
  private parserSourceTags: string[];

  constructor(fileId: string) {
    this.fileId = fileId;
    this.metrics = { startTime: new Date() };
    this.parserIssues = [];
    this.parserSourceTags = [];
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
      this.jobId = createJob('file_processing', { fileId: this.fileId });
      startJob(this.jobId, 'Initializing file processing');

      // Update status to processing
      await this.updateStatus('processing', 0);

      // Get and validate file
      const file = await this.getFile();
      await this.validateFile(file);

      // Parse file based on type
      await this.updateProgress(10, 'Parsing file...');
      const parseStart = Date.now();
      const parsed = await this.parseFile(file);
      this.metrics.parseTime = Date.now() - parseStart;

      if (parsed.validationErrors.length > 0) {
        result.errors.push(
          ...parsed.validationErrors.map((err) => `Parser validation error: ${err}`)
        );
      }
      if (parsed.validationWarnings.length > 0) {
        this.parserIssues.push(
          ...parsed.validationWarnings.map((warn) => `Parser warning: ${warn}`)
        );
      }

      // Process within a transaction for atomicity
      await withTransaction(async (client) => {
        await this.updateProgress(40, 'Processing vendors...');
        const vendorStart = Date.now();
        const vendorResults = await this.processVendors(client, parsed.vendors, parsed.output);
        result.vendorsCreated = vendorResults.created;
        result.errors.push(...vendorResults.errors);
        this.metrics.vendorTime = Date.now() - vendorStart;

        await this.updateProgress(60, 'Processing deals...');
        const dealStart = Date.now();
        const dealResults = await this.processDeals(client, parsed.deals, vendorResults.vendorMap, parsed.output);
        result.dealsCreated = dealResults.created;
        result.errors.push(...dealResults.errors);
        this.metrics.dealTime = Date.now() - dealStart;

        await this.updateProgress(80, 'Processing contacts...');
        const contactStart = Date.now();
        const contactResults = await this.processContacts(
          client,
          parsed.contacts,
          vendorResults.vendorMap,
          parsed.output
        );
        result.contactsCreated = contactResults.created;
        result.errors.push(...contactResults.errors);
        this.metrics.contactTime = Date.now() - contactStart;
      });

      // Update to completed
      await this.updateProgress(100, 'Complete');
      await this.updateStatus('completed', 100, result, undefined, {
        parserWarnings: this.parserIssues,
        parserSourceTags: this.parserSourceTags,
      });

      if (this.jobId) {
        completeJob(this.jobId, result);
      }

      this.logMetrics(result);

      return result;
    } catch (error: any) {
      logger.error('File processing failed', {
        fileId: this.fileId,
        error: error.message,
        stack: error.stack,
      });

      await this.updateStatus('failed', 0, undefined, error.message);
      if (this.jobId) {
        failJob(this.jobId, error.message);
      }
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

    if (!file.storage_path) {
      throw new Error('File has no storage_path recorded');
    }

    // Check file exists and is readable
    try {
      await access(file.storage_path, fsConstants.R_OK);
    } catch (error: any) {
      throw new Error(`File is missing or unreadable at ${file.storage_path}`);
    }

    // Log size for context if available
    try {
      const stats = await stat(file.storage_path);
      logger.info('Validated source file', {
        fileId: this.fileId,
        filePath: file.storage_path,
        sizeBytes: stats.size,
      });
    } catch (err: any) {
      logger.warn('Unable to read file size', { filePath: file.storage_path, error: err.message });
    }

    logger.info(`Processing file: ${file.filename} (${file.file_type})`);
  }

  /**
   * Parse file based on type
   */
  private async parseFile(file: any): Promise<ParsedBundle> {
    const parser = this.getParser(file.file_type);

    if (!parser) {
      throw new Error(`No standardized parser available for type: ${file.file_type}`);
    }

    const output = await parser.parse(file.storage_path);
    const validation = parser.validate(output);

    this.parserSourceTags = output.metadata?.sourceTags || [];

    const parserErrors = (output.errors || []).map((err) =>
      typeof err === 'string' ? err : err.message || 'Unknown parser error'
    );
    const parserWarnings = (output.warnings || []).map((warn) =>
      typeof warn === 'string' ? warn : warn.message || 'Parser warning'
    );

    // Capture stats and warning details but continue if recoverable
    const validationErrors = [...(validation.errors || []), ...parserErrors];
    const validationWarnings = [...(validation.warnings || []), ...parserWarnings];

    // Normalize entity arrays
    const vendors = output.entities?.vendors || [];
    const deals = output.entities?.deals || [];
    const contacts = output.entities?.contacts || [];

    logger.info('Standardized parse complete', {
      fileId: this.fileId,
      parser: output.metadata.parsingMethod,
      fileType: output.metadata.fileType,
      vendors: vendors.length,
      deals: deals.length,
      contacts: contacts.length,
      errors: output.errors?.length || 0,
      warnings: output.warnings?.length || 0,
    });

    await this.recordParserIssues(
      {
        id: this.fileId,
        filename: file.filename,
        fileType: file.file_type,
      },
      validationErrors,
      validationWarnings
    );

    return {
      vendors,
      deals,
      contacts,
      output,
      validationErrors,
      validationWarnings,
    };
  }

  private async recordParserIssues(
    file: { id: string; filename: string; fileType: string },
    errors: string[],
    warnings: string[]
  ) {
    for (const err of errors) {
      await logParsingError({
        sourceFileId: file.id,
        fileName: file.filename,
        fileType: file.fileType,
        errorMessage: err,
        errorSeverity: 'error',
      }).catch((e) =>
        logger.warn('Failed to log parser error', { sourceFileId: file.id, error: e.message })
      );
    }

    for (const warn of warnings) {
      await logParsingError({
        sourceFileId: file.id,
        fileName: file.filename,
        fileType: file.fileType,
        errorMessage: warn,
        errorSeverity: 'warning',
      }).catch((e) =>
        logger.warn('Failed to log parser warning', { sourceFileId: file.id, error: e.message })
      );
    }
  }

  private getParser(fileType: string) {
    switch (fileType) {
      case 'csv':
      case 'vtiger_csv':
        return new StandardizedCSVParser();
      case 'txt':
      case 'pdf':
      case 'docx':
      case 'transcript':
        return new StandardizedTranscriptParser();
      case 'mbox':
        return new StandardizedMboxParser();
      default:
        return null;
    }
  }

  private mapSourceType(fileType: string): ProvenanceSourceType {
    switch (fileType) {
      case 'mbox':
        return 'email';
      case 'csv':
      case 'vtiger_csv':
        return 'csv';
      case 'txt':
      case 'pdf':
      case 'docx':
      case 'transcript':
        return 'transcript';
      default:
        return 'manual';
    }
  }

  private mapExtractionMethod(dealData?: NormalizedDeal, parserOutput?: StandardizedParserOutput): ProvenanceExtractionMethod {
    const fromDeal = (dealData?.extraction_method || '').toString();
    if (fromDeal === 'ai') return 'ai';
    if (fromDeal === 'keyword') return 'keyword';
    if (fromDeal === 'fuzzy_match') return 'fuzzy_match';
    if (fromDeal === 'domain_match') return 'domain_match';
    if (fromDeal === 'manual') return 'manual';
    if (fromDeal === 'inference') return 'inference';
    if (fromDeal === 'normalization') return 'normalization';
    // Default based on parser/source
    const sourceType = parserOutput?.metadata.fileType;
    if (sourceType === 'mbox') return 'keyword';
    if (sourceType === 'csv' || sourceType === 'vtiger_csv') return 'manual';
    return 'regex';
  }

  /**
   * Process vendors with error handling
   */
  private async processVendors(
    client: PoolClient,
    vendors: NormalizedVendor[],
    parserOutput: StandardizedParserOutput
  ): Promise<{ created: number; errors: string[]; vendorMap: Map<string, string> }> {
    const vendorMap = new Map<string, string>();
    let created = 0;
    const errors: string[] = [];

    for (const vendorData of vendors) {
      try {
        const vendorId = await this.createOrGetVendor(client, vendorData, parserOutput);
        const vendorKey = vendorData.name || vendorData.normalized_name;
        if (vendorKey) {
          vendorMap.set(vendorKey, vendorId);
          vendorMap.set(vendorKey.toLowerCase(), vendorId);
        }
        created++;
      } catch (error: any) {
        if (error instanceof VendorApprovalPendingError) {
          const message = `Vendor "${vendorData.name}" pending approval (review ${error.aliasId})`;
          errors.push(message);
          logger.warn(message, { vendor: vendorData.name, reviewId: error.aliasId });
        } else if (error instanceof VendorApprovalDeniedError) {
          const message = `Vendor "${vendorData.name}" denied by policy`;
          errors.push(message);
          logger.warn(message, { vendor: vendorData.name });
        } else {
          errors.push(`Vendor error (${vendorData.name}): ${error.message}`);
          logger.warn('Failed to create vendor', {
            vendor: vendorData.name,
            error: error.message,
          });
        }
      }
    }

    return { created, errors, vendorMap };
  }

  /**
   * Process deals with error handling
   */
  private async processDeals(
    client: PoolClient,
    deals: NormalizedDeal[],
    vendorMap: Map<string, string>,
    parserOutput: StandardizedParserOutput
  ): Promise<{ created: number; errors: string[] }> {
    let created = 0;
    const errors: string[] = [];

    for (const dealData of deals) {
      try {
        const vendorId =
          vendorMap.get(dealData.vendor_name) || vendorMap.get(dealData.vendor_name?.toLowerCase() || '');
        if (!vendorId) {
          errors.push(`No vendor found for deal: ${dealData.deal_name}`);
          continue;
        }

        await this.createDeal(client, dealData, vendorId, parserOutput);
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
    contacts: NormalizedContact[],
    vendorMap: Map<string, string>,
    parserOutput: StandardizedParserOutput
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

        await this.createContact(client, contactData, vendorId, parserOutput);
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
    _client: PoolClient,
    vendorData: NormalizedVendor,
    parserOutput: StandardizedParserOutput
  ): Promise<string> {
    const name = vendorData.name || vendorData.normalized_name;
    if (!name) {
      throw new Error('Vendor name is required');
    }

    const context = {
      source_file_id: this.fileId,
      detection_source: 'file_processor_v2',
      metadata: {
        normalized_name: vendorData.normalized_name,
        source_tags: parserOutput.metadata.sourceTags || [],
        parser: parserOutput.metadata.parsingMethod,
      },
    };

    const vendorId = await ensureVendorApproved(name, context);

    // Tag vendor with source file for correlation if not already present
    await query(
      `UPDATE vendors
       SET source_file_ids = (
         CASE
           WHEN source_file_ids IS NULL THEN ARRAY[$1]::text[]
           WHEN NOT ($1 = ANY(source_file_ids)) THEN array_append(source_file_ids, $1)
           ELSE source_file_ids
         END
       )
       WHERE id = $2`,
      [this.fileId, vendorId]
    ).catch((err: any) =>
      logger.warn('Failed to tag vendor with source file', { vendorId, fileId: this.fileId, error: err.message })
    );

    // Provenance tracking is best-effort; do not fail the flow
    trackVendorProvenance(vendorId, vendorData, {
      sourceFileId: this.fileId,
      sourceType: this.mapSourceType(parserOutput.metadata.fileType),
      sourceLocation: parserOutput.metadata.fileName,
      extractionMethod: this.mapExtractionMethod(undefined, parserOutput),
      confidence: vendorData.confidence,
      extractionContext: {
        parser: parserOutput.metadata.parsingMethod,
        sourceTags: parserOutput.metadata.sourceTags || [],
      },
    }).catch((err) =>
      logger.warn('Failed to track vendor provenance', { vendorId, error: err.message })
    );

    return vendorId;
  }

  /**
   * Create deal
   */
  private async createDeal(
    client: PoolClient,
    dealData: NormalizedDeal,
    vendorId: string,
    parserOutput: StandardizedParserOutput
  ): Promise<void> {
    const metadata = {
      source_file_id: this.fileId,
      parser: {
        name: parserOutput.metadata.parsingMethod,
        version: parserOutput.metadata.parsingVersion,
        fileType: parserOutput.metadata.fileType,
        sourceTags: parserOutput.metadata.sourceTags || [],
      },
      source_tags: dealData.source_tags || [],
      rfq_signals: dealData.rfq_signals,
      stage_hints: dealData.stage_hints,
      deal_name_features: dealData.deal_name_features,
      deal_name_candidates: dealData.deal_name_candidates,
      parser_errors: parserOutput.errors || [],
      parser_warnings: parserOutput.warnings || [],
    };

    const result = await client.query(
      `INSERT INTO deal_registrations (
        vendor_id, deal_name, deal_value, currency, customer_name,
        registration_date, expected_close_date, status, deal_stage, probability,
        notes, metadata, source_file_ids
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        vendorId,
        dealData.deal_name || 'Untitled Deal',
        dealData.deal_value || 0,
        dealData.currency || 'USD',
        dealData.customer_name || null,
        dealData.registration_date ? new Date(dealData.registration_date) : new Date(),
        dealData.expected_close_date ? new Date(dealData.expected_close_date) : null,
        dealData.status || 'registered',
        dealData.deal_stage || null,
        dealData.probability ?? null,
        dealData.notes || null,
        JSON.stringify(metadata),
        [this.fileId],
      ]
    );

    const dealId = result.rows[0]?.id;

    if (dealId) {
      trackDealProvenance(
        dealId,
        dealData,
        {
          sourceFileId: this.fileId,
          sourceType: this.mapSourceType(parserOutput.metadata.fileType),
          sourceLocation: parserOutput.metadata.fileName,
          extractionMethod: this.mapExtractionMethod(dealData, parserOutput),
          confidence: dealData.confidence_score,
          extractionContext: {
            parser: parserOutput.metadata.parsingMethod,
            sourceTags: parserOutput.metadata.sourceTags || [],
            rfq: dealData.rfq_signals,
            stage_hints: dealData.stage_hints,
          },
        }
      ).catch((err) =>
        logger.warn('Failed to track deal provenance', { dealId, error: err.message })
      );
    }
  }

  /**
   * Create contact
   */
  private async createContact(
    client: PoolClient,
    contactData: NormalizedContact,
    vendorId: string,
    parserOutput: StandardizedParserOutput
  ): Promise<void> {
    const result = await client.query(
      `INSERT INTO contacts (vendor_id, name, email, phone, role, is_primary, source_file_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        vendorId,
        contactData.name,
        contactData.email || null,
        contactData.phone || null,
        contactData.role || null,
        contactData.is_primary || false,
        [this.fileId],
      ]
    );

    const contactId = result.rows[0]?.id;
    if (contactId) {
      trackContactProvenance(
        contactId,
        contactData,
        {
          sourceFileId: this.fileId,
          sourceType: this.mapSourceType(parserOutput.metadata.fileType),
          sourceLocation: parserOutput.metadata.fileName,
          extractionMethod: 'regex',
          confidence: undefined,
          extractionContext: {
            vendorId,
            parser: parserOutput.metadata.parsingMethod,
          },
        }
      ).catch((err) =>
        logger.warn('Failed to track contact provenance', { contactId, error: err.message })
      );
    }
  }

  /**
   * Update file processing status
   */
  private async updateStatus(
    status: string,
    progress: number,
    result?: ProcessingResult,
    errorMessage?: string,
    extraMetadata?: Record<string, any>
  ) {
    const updates: any = {
      processing_status: status,
      metadata: JSON.stringify({
        progress,
        ...result,
        parserWarnings: this.parserIssues,
        parserSourceTags: this.parserSourceTags,
        ...(extraMetadata || {}),
      }),
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

    await query(`UPDATE source_files SET ${setClauses} WHERE id = $1`, [
      this.fileId,
      ...Object.values(updates),
    ]);
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

    if (this.jobId) {
      updateJobProgress(this.jobId, progress, message);
    }

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
      parserWarnings: this.parserIssues,
    });
  }
}
