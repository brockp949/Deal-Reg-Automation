/**
 * Unified Processing Queue
 *
 * Consolidates file processing, deal import, and vendor import queues
 * into a single queue with intent-based routing through ParserRegistry.
 */

import Bull from 'bull';
import { config } from '../config';
import { query } from '../db';
import logger from '../utils/logger';
import { createJob, startJob, updateJobProgress, completeJob, failJob } from '../services/jobTracker';
import { getParserRegistry, type FileIntent, type FileMetadata, type UnifiedParseResult, type ParseOptions } from '../parsers/ParserRegistry';
import { ensureVendorApproved } from '../services/vendorApprovalService';
import { VendorApprovalPendingError, VendorApprovalDeniedError } from '../errors/vendorApprovalErrors';
import { trackDealProvenance, trackVendorProvenance, trackContactProvenance } from '../services/provenanceTracker';
import { EventEmitter } from 'events';

// Job data structure
export interface UnifiedJobData {
  fileId: string;
  intent: FileIntent;
  vendorId?: string;
  vendorName?: string;
  options?: {
    skipDuplicates?: boolean;
    createMissingVendors?: boolean;
  };
}

// Job result structure
export interface UnifiedJobResult {
  success: boolean;
  fileId: string;
  parserUsed: string;
  detectedIntent: FileIntent;
  vendorsCreated: number;
  dealsCreated: number;
  contactsCreated: number;
  errors: string[];
  warnings: string[];
  statistics: {
    totalRows: number;
    successCount: number;
    errorCount: number;
    duplicates: number;
  };
}

// Progress event emitter for SSE
export const progressEmitter = new EventEmitter();
progressEmitter.setMaxListeners(100);  // Allow many SSE connections

/**
 * Emit progress event for SSE subscribers
 */
function emitProgress(fileId: string, progress: number, stage: string, message?: string, result?: Partial<UnifiedJobResult>) {
  progressEmitter.emit(`progress:${fileId}`, {
    fileId,
    progress,
    stage,
    message,
    result,
    timestamp: new Date().toISOString(),
  });
}

// Create the unified queue
export const unifiedProcessingQueue = new Bull('unified-processing', config.redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

// Process jobs
unifiedProcessingQueue.process(async (job) => {
  const { fileId, intent, vendorId, vendorName, options = {} } = job.data as UnifiedJobData;

  logger.info('Processing unified job', { jobId: job.id, fileId, intent });

  const trackerId = createJob('unified_processing', { bullJobId: job.id?.toString(), fileId, intent });
  startJob(trackerId, 'Starting unified processing');

  const result: UnifiedJobResult = {
    success: false,
    fileId,
    parserUsed: 'none',
    detectedIntent: intent,
    vendorsCreated: 0,
    dealsCreated: 0,
    contactsCreated: 0,
    errors: [],
    warnings: [],
    statistics: {
      totalRows: 0,
      successCount: 0,
      errorCount: 0,
      duplicates: 0,
    },
  };

  try {
    // Update progress: 5% - Starting
    await job.progress(5);
    updateJobProgress(trackerId, 5, 'Starting');
    emitProgress(fileId, 5, 'starting', 'Initializing file processing');

    // Get file details
    const fileResult = await query('SELECT * FROM source_files WHERE id = $1', [fileId]);
    if (fileResult.rows.length === 0) {
      throw new Error('File not found');
    }

    const file = fileResult.rows[0];

    // Check scan status
    if (file.scan_status && file.scan_status !== 'passed') {
      await query(
        'UPDATE source_files SET processing_status = $1, error_message = $2 WHERE id = $3',
        ['blocked', `File blocked pending security review (scan status: ${file.scan_status})`, fileId]
      );
      throw new Error(`File blocked pending security review`);
    }

    // Update status to processing
    await query(
      `UPDATE source_files
       SET processing_status = 'processing',
           processing_started_at = CURRENT_TIMESTAMP,
           upload_intent = $1,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{progress}', '10')
       WHERE id = $2`,
      [intent, fileId]
    );

    // Update progress: 10% - Parsing file
    await job.progress(10);
    updateJobProgress(trackerId, 10, 'Parsing file');
    emitProgress(fileId, 10, 'parsing', `Parsing ${file.filename}`);

    // Build file metadata for parser
    const fileMetadata: FileMetadata = {
      filename: file.filename,
      fileType: file.file_type,
      filePath: file.storage_path,
      fileSize: file.file_size,
    };

    // Parse file using ParserRegistry
    const parseOptions: ParseOptions = {
      vendorId,
      vendorName,
      onProgress: async (progress, message) => {
        const scaledProgress = 10 + Math.round(progress * 0.3);  // Scale to 10-40%
        await job.progress(scaledProgress);
        emitProgress(fileId, scaledProgress, 'parsing', message);
      },
    };

    const registry = getParserRegistry();
    const parseResult = await registry.parse(fileMetadata, intent, parseOptions);

    result.parserUsed = parseResult.parserUsed;
    result.detectedIntent = parseResult.detectedIntent;
    result.statistics = parseResult.statistics;
    result.warnings = parseResult.warnings;

    // Update file with detected intent and parser
    await query(
      `UPDATE source_files
       SET detected_intent = $1,
           parser_used = $2,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{progress}', '40')
       WHERE id = $3`,
      [parseResult.detectedIntent, parseResult.parserUsed, fileId]
    );

    // Update progress: 40% - Parsing complete
    await job.progress(40);
    updateJobProgress(trackerId, 40, 'Parsing complete');
    emitProgress(fileId, 40, 'parsed', `Parsed ${parseResult.statistics.successCount} items`);

    if (!parseResult.success && parseResult.errors.length > 0) {
      result.errors = parseResult.errors;
      throw new Error(parseResult.errors[0]);
    }

    // Update progress: 50% - Creating records
    await job.progress(50);
    updateJobProgress(trackerId, 50, 'Creating records');
    emitProgress(fileId, 50, 'persisting', 'Creating database records');

    // Persist vendors
    const vendorMap = new Map<string, string>();  // vendor name -> vendor ID
    const totalItems = parseResult.vendors.length + parseResult.deals.length + parseResult.contacts.length;
    let processedItems = 0;

    for (const vendor of parseResult.vendors) {
      try {
        const vendorIdResult = await ensureVendorApproved(vendor.name, {
          source_file_id: fileId,
          detection_source: 'unified_processor',
          metadata: { vendor },
        });
        vendorMap.set(vendor.name, vendorIdResult);
        result.vendorsCreated++;
        processedItems++;

        const progress = 50 + Math.round((processedItems / totalItems) * 15);
        await job.progress(progress);
        emitProgress(fileId, progress, 'persisting', `Created vendor: ${vendor.name}`);

      } catch (error: any) {
        if (error instanceof VendorApprovalPendingError) {
          result.warnings.push(`Vendor "${vendor.name}" pending approval`);
        } else if (error instanceof VendorApprovalDeniedError) {
          result.warnings.push(`Vendor "${vendor.name}" denied`);
        } else {
          result.errors.push(`Vendor error (${vendor.name}): ${error.message}`);
        }
      }
    }

    // Update progress: 65% - Vendors created
    await job.progress(65);
    emitProgress(fileId, 65, 'persisting', 'Vendors created, processing deals');

    // Persist deals
    for (const deal of parseResult.deals) {
      try {
        let dealVendorId = vendorId;

        // Try to find vendor ID from vendor name
        if (!dealVendorId && deal.vendor_name) {
          dealVendorId = vendorMap.get(deal.vendor_name);

          if (!dealVendorId) {
            // Try to create/find vendor
            try {
              dealVendorId = await ensureVendorApproved(deal.vendor_name, {
                source_file_id: fileId,
                detection_source: 'unified_processor',
                metadata: { fromDeal: deal.deal_name },
              });
              vendorMap.set(deal.vendor_name, dealVendorId);
            } catch (error: any) {
              if (error instanceof VendorApprovalPendingError || error instanceof VendorApprovalDeniedError) {
                result.warnings.push(`Deal "${deal.deal_name}" skipped: vendor pending/denied`);
                continue;
              }
              throw error;
            }
          }
        }

        if (!dealVendorId) {
          result.warnings.push(`Deal "${deal.deal_name}" skipped: no vendor`);
          continue;
        }

        // Check for duplicate deals
        const existingDeal = await query(
          `SELECT id FROM deal_registrations
           WHERE vendor_id = $1 AND LOWER(deal_name) = LOWER($2)`,
          [dealVendorId, deal.deal_name]
        );

        if (existingDeal.rows.length > 0) {
          if (options.skipDuplicates) {
            result.statistics.duplicates++;
            continue;
          }
          // Update existing deal
          await query(
            `UPDATE deal_registrations
             SET deal_value = COALESCE($2, deal_value),
                 currency = COALESCE($3, currency),
                 customer_name = COALESCE($4, customer_name),
                 deal_stage = COALESCE($5, deal_stage),
                 notes = COALESCE($6, notes),
                 updated_at = CURRENT_TIMESTAMP,
                 metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{updated_by_import}', 'true'::jsonb)
             WHERE id = $1`,
            [existingDeal.rows[0].id, deal.deal_value, deal.currency, deal.customer_name, deal.deal_stage, deal.notes]
          );
        } else {
          // Insert new deal
          await query(
            `INSERT INTO deal_registrations (
               vendor_id, deal_name, deal_value, currency, customer_name,
               customer_industry, registration_date, expected_close_date,
               status, deal_stage, probability, notes, metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              dealVendorId,
              deal.deal_name,
              deal.deal_value || 0,
              deal.currency || 'USD',
              deal.customer_name,
              deal.customer_industry,
              deal.registration_date || new Date().toISOString().split('T')[0],
              deal.expected_close_date,
              deal.status || 'imported',
              deal.deal_stage,
              deal.probability,
              deal.notes,
              JSON.stringify({ source_file_id: fileId, ...deal.metadata }),
            ]
          );
          result.dealsCreated++;
        }

        processedItems++;
        const progress = 65 + Math.round((processedItems / totalItems) * 20);
        await job.progress(progress);
        emitProgress(fileId, progress, 'persisting', `Processed deal: ${deal.deal_name}`);

      } catch (error: any) {
        result.errors.push(`Deal error (${deal.deal_name}): ${error.message}`);
        logger.error('Error creating deal', { deal: deal.deal_name, error: error.message });
      }
    }

    // Update progress: 85% - Deals created
    await job.progress(85);
    emitProgress(fileId, 85, 'persisting', 'Deals created, processing contacts');

    // Persist contacts
    for (const contact of parseResult.contacts) {
      try {
        let contactVendorId = vendorId;

        if (!contactVendorId && contact.vendor_name) {
          contactVendorId = vendorMap.get(contact.vendor_name);
        }

        if (!contactVendorId) {
          continue;  // Skip contacts without vendor
        }

        // Check for existing contact
        const existingContact = await query(
          `SELECT id FROM contacts WHERE vendor_id = $1 AND email = $2`,
          [contactVendorId, contact.email]
        );

        if (existingContact.rows.length === 0 && contact.email) {
          await query(
            `INSERT INTO contacts (vendor_id, name, email, phone, role, is_primary)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [contactVendorId, contact.name, contact.email, contact.phone, contact.role, contact.is_primary || false]
          );
          result.contactsCreated++;
        }

        processedItems++;

      } catch (error: any) {
        result.errors.push(`Contact error (${contact.name}): ${error.message}`);
      }
    }

    // Update progress: 95% - All records created
    await job.progress(95);
    emitProgress(fileId, 95, 'finalizing', 'Finalizing import');

    // Update file status to completed
    await query(
      `UPDATE source_files
       SET processing_status = 'completed',
           processing_completed_at = CURRENT_TIMESTAMP,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{result}', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(result), fileId]
    );

    result.success = true;

    // Update progress: 100% - Complete
    await job.progress(100);
    updateJobProgress(trackerId, 100, 'Complete');
    emitProgress(fileId, 100, 'completed', 'Import completed successfully', result);

    completeJob(trackerId, result);

    logger.info('Unified processing job completed', {
      jobId: job.id,
      fileId,
      result: {
        vendors: result.vendorsCreated,
        deals: result.dealsCreated,
        contacts: result.contactsCreated,
        errors: result.errors.length,
      },
    });

    return result;

  } catch (error: any) {
    logger.error('Unified processing job failed', {
      jobId: job.id,
      fileId,
      error: error.message,
    });

    result.errors.push(error.message);
    emitProgress(fileId, 0, 'failed', error.message, result);

    // Update file status to failed
    await query(
      'UPDATE source_files SET processing_status = $1, error_message = $2 WHERE id = $3',
      ['failed', error.message, fileId]
    );

    failJob(trackerId, error.message);
    throw error;
  }
});

// Event listeners
unifiedProcessingQueue.on('completed', (job, result: UnifiedJobResult) => {
  logger.info('Unified job completed', {
    jobId: job.id,
    fileId: job.data.fileId,
    vendors: result.vendorsCreated,
    deals: result.dealsCreated,
    contacts: result.contactsCreated,
  });
});

unifiedProcessingQueue.on('failed', (job, error) => {
  logger.error('Unified job failed', {
    jobId: job.id,
    fileId: job.data.fileId,
    error: error.message,
    attemptsMade: job.attemptsMade,
  });
});

unifiedProcessingQueue.on('stalled', (job) => {
  logger.warn('Unified job stalled', {
    jobId: job.id,
    fileId: job.data.fileId,
  });
});

unifiedProcessingQueue.on('progress', (job, progress) => {
  logger.debug('Unified job progress', {
    jobId: job.id,
    fileId: job.data.fileId,
    progress,
  });
});

/**
 * Add a file to the unified processing queue
 */
export async function addUnifiedJob(data: UnifiedJobData): Promise<Bull.Job> {
  const { fileId, intent } = data;

  // Remove existing job if present
  const existing = await unifiedProcessingQueue.getJob(`unified-${fileId}`);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed' || state === 'delayed') {
      await existing.remove();
      logger.info('Removed existing unified job to allow reprocessing', { fileId, state });
    }
  }

  const job = await unifiedProcessingQueue.add(data, {
    jobId: `unified-${fileId}-${Date.now()}`,
    priority: 1,
  });

  logger.info('Unified processing job added', {
    jobId: job.id,
    fileId,
    intent,
  });

  return job;
}

/**
 * Get job status
 */
export async function getUnifiedJobStatus(jobId: string) {
  const job = await unifiedProcessingQueue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress();
  const result = job.returnvalue;
  const failedReason = job.failedReason;

  return {
    id: job.id,
    state,
    progress,
    result,
    failedReason,
    attemptsMade: job.attemptsMade,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    data: job.data,
  };
}

/**
 * Find job by file ID
 */
export async function findJobByFileId(fileId: string) {
  const jobs = await unifiedProcessingQueue.getJobs(['waiting', 'active', 'completed', 'failed']);

  for (const job of jobs) {
    if (job.data.fileId === fileId) {
      return getUnifiedJobStatus(job.id?.toString() || '');
    }
  }

  return null;
}

/**
 * Get queue statistics
 */
export async function getUnifiedQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    unifiedProcessingQueue.getWaitingCount(),
    unifiedProcessingQueue.getActiveCount(),
    unifiedProcessingQueue.getCompletedCount(),
    unifiedProcessingQueue.getFailedCount(),
    unifiedProcessingQueue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed,
  };
}

/**
 * Subscribe to progress events for a file
 */
export function subscribeToProgress(fileId: string, callback: (event: any) => void): () => void {
  const eventName = `progress:${fileId}`;
  progressEmitter.on(eventName, callback);

  return () => {
    progressEmitter.off(eventName, callback);
  };
}

/**
 * Clean up old jobs
 */
export async function cleanOldUnifiedJobs() {
  await unifiedProcessingQueue.clean(7 * 24 * 60 * 60 * 1000, 'completed');
  await unifiedProcessingQueue.clean(30 * 24 * 60 * 60 * 1000, 'failed');
  logger.info('Old unified jobs cleaned up');
}

/**
 * Graceful shutdown
 */
export async function closeUnifiedQueue() {
  await unifiedProcessingQueue.close();
  logger.info('Unified processing queue closed');
}

export default {
  unifiedProcessingQueue,
  addUnifiedJob,
  getUnifiedJobStatus,
  findJobByFileId,
  getUnifiedQueueStats,
  subscribeToProgress,
  progressEmitter,
  cleanOldUnifiedJobs,
  closeUnifiedQueue,
};
