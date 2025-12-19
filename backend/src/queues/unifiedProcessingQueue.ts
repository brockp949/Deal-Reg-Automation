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
import { getParallelProcessingService } from '../services/ParallelProcessingService';
import { emitProcessingProgress, emitProcessingCompleted, emitProcessingFailed, emitProcessingStarted } from '../services/processingEvents';
import { getDuplicateDetector } from '../skills/SemanticDuplicateDetector';
import { getLearningAgent } from '../agents/ContinuousLearningAgent';
import { getErrorGuidanceService, type ActionableError } from '../services/ErrorGuidanceService';
import { isSkillEnabled } from '../config/claude';

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
  errorGuidance?: ActionableError;  // Smart error guidance when available
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
 * Update progress in database for polling clients
 */
async function updateProgressInDB(fileId: string, progress: number) {
  try {
    await query(
      `UPDATE source_files
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{progress}', $1::text::jsonb)
       WHERE id = $2`,
      [progress.toString(), fileId]
    );
  } catch (error) {
    logger.warn('Failed to update progress in DB', { fileId, progress, error });
  }
}

/**
 * Emit progress event for SSE subscribers and update database
 */
async function emitProgress(fileId: string, progress: number, stage: string, message?: string, result?: Partial<UnifiedJobResult>) {
  const eventName = `progress:${fileId}`;
  const listenerCount = progressEmitter.listenerCount(eventName);

  logger.debug('Emitting progress event', { fileId, progress, stage, message, listenerCount });

  // Emit to local progressEmitter (for subscribeToProgress() function)
  progressEmitter.emit(eventName, {
    fileId,
    progress,
    stage,
    message,
    result,
    timestamp: new Date().toISOString(),
  });

  // Also emit to processingEvents for SSE clients connected via /api/events/processing/:fileId
  if (stage === 'starting') {
    emitProcessingStarted(fileId, message || 'Processing started');
  } else if (stage === 'completed') {
    emitProcessingCompleted(
      fileId,
      result?.dealsCreated || 0,
      result?.vendorsCreated || 0,
      result?.contactsCreated || 0
    );
  } else if (stage === 'failed') {
    emitProcessingFailed(fileId, message || 'Processing failed');
  } else {
    emitProcessingProgress(fileId, progress, message || '', stage);
  }

  // Update progress in database for polling clients
  await updateProgressInDB(fileId, progress);
}

async function applyDealLearnings(
  deal: any,
  context: { vendorName?: string; fileName?: string }
): Promise<any> {
  try {
    const learningAgent = getLearningAgent();
    const { correctedData, appliedInsights } = await learningAgent.applyLearnings('deal', deal, context);
    const resolvedDeal = { ...deal, ...correctedData };

    if (appliedInsights.length > 0) {
      resolvedDeal.metadata = {
        ...(deal.metadata || {}),
        applied_learning_insights: appliedInsights,
      };
    }

    return resolvedDeal;
  } catch (error: any) {
    logger.warn('Failed to apply deal learnings', {
      dealName: deal?.deal_name,
      error: error.message,
    });
    return deal;
  }
}

/**
 * Check for semantic duplicates using AI-powered similarity detection
 * Falls back to exact string matching when skill is disabled
 */
async function checkSemanticDuplicate(
  dealName: string,
  vendorId: string,
  dealValue?: number
): Promise<{ isDuplicate: boolean; matchedId?: string; similarity?: number }> {
  // Check if skill is enabled
  if (!isSkillEnabled('semanticDuplicateDetector')) {
    logger.debug('SemanticDuplicateDetector skill disabled, using exact string matching');
    // Fallback to exact string matching
    const existingDeal = await query(
      `SELECT id FROM deal_registrations
       WHERE vendor_id = $1 AND LOWER(deal_name) = LOWER($2)`,
      [vendorId, dealName]
    );
    return {
      isDuplicate: existingDeal.rows.length > 0,
      matchedId: existingDeal.rows[0]?.id,
    };
  }

  try {
    logger.info('Using SemanticDuplicateDetector skill for deal duplicate check');
    const detector = getDuplicateDetector();

    // Fetch potential duplicates from database (same vendor, recent deals)
    const candidates = await query(
      `SELECT id, deal_name, deal_value, currency, customer_name
       FROM deal_registrations
       WHERE vendor_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [vendorId]
    );

    if (candidates.rows.length === 0) {
      return { isDuplicate: false };
    }

    // Use semantic duplicate detection
    const result = await detector.checkDuplicate({
      entity: {
        type: 'deal',
        data: {
          deal_name: dealName,
          deal_value: dealValue,
        },
      },
      candidates: candidates.rows.map(row => ({
        id: row.id,
        data: {
          deal_name: row.deal_name,
          deal_value: row.deal_value,
          currency: row.currency,
          customer_name: row.customer_name,
        },
      })),
      threshold: 0.85, // High threshold for deals (85% similarity)
    });

    if (result.isDuplicate && result.matches.length > 0) {
      const bestMatch = result.matches[0];
      logger.info('Semantic duplicate detected', {
        newDeal: dealName,
        matchedDeal: bestMatch.candidateId,
        similarity: bestMatch.similarity,
        reason: bestMatch.matchReason,
      });

      return {
        isDuplicate: true,
        matchedId: bestMatch.candidateId,
        similarity: bestMatch.similarity,
      };
    }

    return { isDuplicate: false };
  } catch (error: any) {
    logger.error('Semantic duplicate detection failed, falling back to exact match', {
      error: error.message,
      dealName,
    });

    // Fallback to exact string matching on error
    const existingDeal = await query(
      `SELECT id FROM deal_registrations
       WHERE vendor_id = $1 AND LOWER(deal_name) = LOWER($2)`,
      [vendorId, dealName]
    );
    return {
      isDuplicate: existingDeal.rows.length > 0,
      matchedId: existingDeal.rows[0]?.id,
    };
  }
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
  settings: {
    lockDuration: 300000,      // 5 min lock for long processing
    lockRenewTime: 150000,     // Renew lock every 2.5 min
    stalledInterval: 60000,    // Check for stalled jobs every minute
    maxStalledCount: 2,        // Fail after 2 stalls
  },
});

// Queue event logging for debugging
unifiedProcessingQueue.on('ready', () => {
  logger.info('Unified processing queue connected to Redis and ready');
});

unifiedProcessingQueue.on('error', (error) => {
  logger.error('Unified processing queue error', { error: error.message });
});

unifiedProcessingQueue.on('active', (job) => {
  logger.info('Job started processing', { jobId: job.id, fileId: job.data.fileId });
});

unifiedProcessingQueue.on('completed', (job) => {
  logger.info('Job completed', { jobId: job.id, fileId: job.data.fileId });
});

unifiedProcessingQueue.on('failed', (job, error) => {
  logger.error('Job failed', { jobId: job?.id, fileId: job?.data.fileId, error: error.message });
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
    await emitProgress(fileId, 5, 'starting', 'Initializing file processing');

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
    await emitProgress(fileId, 10, 'parsing', `Parsing ${file.filename}`);

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
        await emitProgress(fileId, scaledProgress, 'parsing', message);
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
    await emitProgress(fileId, 40, 'parsed', `Parsed ${parseResult.statistics.successCount} items`);

    if (!parseResult.success && parseResult.errors.length > 0) {
      result.errors = parseResult.errors;
      throw new Error(parseResult.errors[0]);
    }

    // Update progress: 50% - Creating records
    await job.progress(50);
    updateJobProgress(trackerId, 50, 'Creating records');
    await emitProgress(fileId, 50, 'persisting', 'Creating database records');

    // Persist vendors (parallel processing for large batches)
    const vendorMap = new Map<string, string>();  // vendor name -> vendor ID
    const totalItems = parseResult.vendors.length + parseResult.deals.length + parseResult.contacts.length;
    let processedItems = 0;

    const USE_PARALLEL_PROCESSING = parseResult.vendors.length > 100;

    if (USE_PARALLEL_PROCESSING && config.performance?.parallelChunkSize) {
      // Use parallel processing for large vendor batches
      const parallelService = getParallelProcessingService();

      const vendorResult = await parallelService.processInParallel(
        parseResult.vendors,
        async (vendorChunk, metadata) => {
          const results: Array<{ name: string; id?: string; error?: string }> = [];

          for (const vendor of vendorChunk) {
            try {
              const vendorIdResult = await ensureVendorApproved(vendor.name, {
                source_file_id: fileId,
                detection_source: 'unified_processor',
                metadata: { vendor },
              });
              results.push({ name: vendor.name, id: vendorIdResult });
            } catch (error: any) {
              if (error instanceof VendorApprovalPendingError) {
                results.push({ name: vendor.name, error: 'pending' });
              } else if (error instanceof VendorApprovalDeniedError) {
                results.push({ name: vendor.name, error: 'denied' });
              } else {
                results.push({ name: vendor.name, error: error.message });
              }
            }
          }

          return results;
        },
        {
          onProgress: async (progress) => {
            const overallProgress = 50 + Math.round(progress.overallProgress * 0.15);
            await emitProgress(fileId, overallProgress, 'persisting', progress.currentOperation);
          },
        }
      );

      // Process results
      for (const vendorData of vendorResult.records) {
        if (vendorData.id) {
          vendorMap.set(vendorData.name, vendorData.id);
          result.vendorsCreated++;
        } else if (vendorData.error) {
          if (vendorData.error === 'pending') {
            result.warnings.push(`Vendor "${vendorData.name}" pending approval`);
          } else if (vendorData.error === 'denied') {
            result.warnings.push(`Vendor "${vendorData.name}" denied`);
          } else {
            result.errors.push(`Vendor error (${vendorData.name}): ${vendorData.error}`);
          }
        }
      }

      processedItems += parseResult.vendors.length;
      logger.info('Parallel vendor processing completed', {
        totalVendors: parseResult.vendors.length,
        created: result.vendorsCreated,
        processingTimeMs: vendorResult.processingTimeMs,
        speedup: `${Math.round(vendorResult.processingTimeMs / vendorResult.averageChunkTimeMs)}x`,
      });
    } else {
      // Use sequential processing for small batches
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
          await emitProgress(fileId, progress, 'persisting', `Created vendor: ${vendor.name}`);

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
    }

    // Update progress: 65% - Vendors created
    await job.progress(65);
    await emitProgress(fileId, 65, 'persisting', 'Vendors created, processing deals');

    // Persist deals (parallel processing for large batches)
    const USE_PARALLEL_DEALS = parseResult.deals.length > 100;

    if (USE_PARALLEL_DEALS && config.performance?.parallelChunkSize) {
      // Use parallel processing for large deal batches
      const parallelService = getParallelProcessingService();

      const dealResult = await parallelService.processInParallel(
        parseResult.deals,
        async (dealChunk, metadata) => {
          const results: Array<{ name: string; created?: boolean; updated?: boolean; skipped?: boolean; duplicate?: boolean; error?: string }> = [];

          for (const deal of dealChunk) {
            try {
              const resolvedDeal = await applyDealLearnings(deal, {
                vendorName: deal.vendor_name || vendorName,
                fileName: file.filename,
              });
              const dealName = resolvedDeal.deal_name || deal.deal_name;

              let dealVendorId = vendorId;

              // Try to find vendor ID from vendor name
              if (!dealVendorId && resolvedDeal.vendor_name) {
                dealVendorId = vendorMap.get(resolvedDeal.vendor_name);

                if (!dealVendorId) {
                  // Try to create/find vendor
                  try {
                    dealVendorId = await ensureVendorApproved(resolvedDeal.vendor_name, {
                      source_file_id: fileId,
                      detection_source: 'unified_processor',
                      metadata: { fromDeal: dealName },
                    });
                    vendorMap.set(resolvedDeal.vendor_name, dealVendorId);
                  } catch (error: any) {
                    if (error instanceof VendorApprovalPendingError || error instanceof VendorApprovalDeniedError) {
                      results.push({ name: dealName, skipped: true, error: 'vendor pending/denied' });
                      continue;
                    }
                    throw error;
                  }
                }
              }

              if (!dealVendorId) {
                results.push({ name: dealName, skipped: true, error: 'no vendor' });
                continue;
              }

              // Check for duplicate deals using semantic detection
              const duplicateCheck = await checkSemanticDuplicate(
                dealName,
                dealVendorId,
                resolvedDeal.deal_value
              );

              if (duplicateCheck.isDuplicate) {
                if (options.skipDuplicates) {
                  results.push({ name: dealName, duplicate: true });
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
                       source_file_ids = (
                         CASE
                           WHEN source_file_ids IS NULL THEN ARRAY[$7]::text[]
                           WHEN NOT ($7 = ANY(source_file_ids)) THEN array_append(source_file_ids, $7)
                           ELSE source_file_ids
                         END
                       ),
                       metadata = jsonb_set(
                         COALESCE(metadata, '{}'::jsonb) || COALESCE($8::jsonb, '{}'::jsonb),
                         '{updated_by_import}',
                         'true'::jsonb
                       )
                   WHERE id = $1`,
                  [
                    duplicateCheck.matchedId,
                    resolvedDeal.deal_value,
                    resolvedDeal.currency,
                    resolvedDeal.customer_name,
                    resolvedDeal.deal_stage,
                    resolvedDeal.notes,
                    fileId,
                    JSON.stringify(resolvedDeal.metadata || {}),
                  ]
                );
                results.push({ name: dealName, updated: true });
              } else {
                // Insert new deal
                await query(
                  `INSERT INTO deal_registrations (
                     vendor_id, deal_name, deal_value, currency, customer_name,
                     customer_industry, registration_date, expected_close_date,
                     status, deal_stage, probability, notes, metadata, source_file_ids
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                  [
                    dealVendorId,
                    resolvedDeal.deal_name,
                    resolvedDeal.deal_value || 0,
                    resolvedDeal.currency || 'USD',
                    resolvedDeal.customer_name,
                    resolvedDeal.customer_industry,
                    resolvedDeal.registration_date || new Date().toISOString().split('T')[0],
                    resolvedDeal.expected_close_date,
                    resolvedDeal.status || 'imported',
                    resolvedDeal.deal_stage,
                    resolvedDeal.probability,
                    resolvedDeal.notes,
                    JSON.stringify({ source_file_id: fileId, ...(resolvedDeal.metadata || {}) }),
                    [fileId],
                  ]
                );
                results.push({ name: dealName, created: true });
              }
            } catch (error: any) {
              results.push({ name: deal?.deal_name || 'Unknown Deal', error: error.message });
            }
          }

          return results;
        },
        {
          onProgress: async (progress) => {
            const overallProgress = 65 + Math.round(progress.overallProgress * 0.20);
            await emitProgress(fileId, overallProgress, 'persisting', progress.currentOperation);
          },
        }
      );

      // Process results
      for (const dealData of dealResult.records) {
        if (dealData.created) {
          result.dealsCreated++;
        } else if (dealData.duplicate) {
          result.statistics.duplicates++;
        } else if (dealData.skipped) {
          result.warnings.push(`Deal "${dealData.name}" skipped: ${dealData.error}`);
        } else if (dealData.error) {
          result.errors.push(`Deal error (${dealData.name}): ${dealData.error}`);
        }
      }

      processedItems += parseResult.deals.length;
      logger.info('Parallel deal processing completed', {
        totalDeals: parseResult.deals.length,
        created: result.dealsCreated,
        processingTimeMs: dealResult.processingTimeMs,
        speedup: `${Math.round(dealResult.processingTimeMs / dealResult.averageChunkTimeMs)}x`,
      });
    } else {
      // Use sequential processing for small batches
      for (const deal of parseResult.deals) {
        try {
          const resolvedDeal = await applyDealLearnings(deal, {
            vendorName: deal.vendor_name || vendorName,
            fileName: file.filename,
          });
          const dealName = resolvedDeal.deal_name || deal.deal_name;

          let dealVendorId = vendorId;

          // Try to find vendor ID from vendor name
          if (!dealVendorId && resolvedDeal.vendor_name) {
            dealVendorId = vendorMap.get(resolvedDeal.vendor_name);

            if (!dealVendorId) {
              // Try to create/find vendor
              try {
                dealVendorId = await ensureVendorApproved(resolvedDeal.vendor_name, {
                  source_file_id: fileId,
                  detection_source: 'unified_processor',
                  metadata: { fromDeal: dealName },
                });
                vendorMap.set(resolvedDeal.vendor_name, dealVendorId);
              } catch (error: any) {
                if (error instanceof VendorApprovalPendingError || error instanceof VendorApprovalDeniedError) {
                  result.warnings.push(`Deal "${dealName}" skipped: vendor pending/denied`);
                  continue;
                }
                throw error;
              }
            }
          }

          if (!dealVendorId) {
            result.warnings.push(`Deal "${dealName}" skipped: no vendor`);
            continue;
          }

          // Check for duplicate deals using semantic detection
          const duplicateCheck = await checkSemanticDuplicate(
            dealName,
            dealVendorId,
            resolvedDeal.deal_value
          );

          if (duplicateCheck.isDuplicate) {
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
                   source_file_ids = (
                     CASE
                       WHEN source_file_ids IS NULL THEN ARRAY[$7]::text[]
                       WHEN NOT ($7 = ANY(source_file_ids)) THEN array_append(source_file_ids, $7)
                       ELSE source_file_ids
                     END
                   ),
                   metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb) || COALESCE($8::jsonb, '{}'::jsonb),
                     '{updated_by_import}',
                     'true'::jsonb
                   )
               WHERE id = $1`,
              [
                duplicateCheck.matchedId,
                resolvedDeal.deal_value,
                resolvedDeal.currency,
                resolvedDeal.customer_name,
                resolvedDeal.deal_stage,
                resolvedDeal.notes,
                fileId,
                JSON.stringify(resolvedDeal.metadata || {}),
              ]
            );
          } else {
            // Insert new deal
            await query(
              `INSERT INTO deal_registrations (
                 vendor_id, deal_name, deal_value, currency, customer_name,
                 customer_industry, registration_date, expected_close_date,
                 status, deal_stage, probability, notes, metadata, source_file_ids
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [
                dealVendorId,
                resolvedDeal.deal_name,
                resolvedDeal.deal_value || 0,
                resolvedDeal.currency || 'USD',
                resolvedDeal.customer_name,
                resolvedDeal.customer_industry,
                resolvedDeal.registration_date || new Date().toISOString().split('T')[0],
                resolvedDeal.expected_close_date,
                resolvedDeal.status || 'imported',
                resolvedDeal.deal_stage,
                resolvedDeal.probability,
                resolvedDeal.notes,
                JSON.stringify({ source_file_id: fileId, ...(resolvedDeal.metadata || {}) }),
                [fileId],
              ]
            );
            result.dealsCreated++;
          }

          processedItems++;
          const progress = 65 + Math.round((processedItems / totalItems) * 20);
          await job.progress(progress);
          await emitProgress(fileId, progress, 'persisting', `Processed deal: ${dealName}`);

        } catch (error: any) {
          const fallbackName = deal?.deal_name || 'Unknown Deal';
          result.errors.push(`Deal error (${fallbackName}): ${error.message}`);
          logger.error('Error creating deal', { deal: fallbackName, error: error.message });
        }
      }
    }

    // Update progress: 85% - Deals created
    await job.progress(85);
    await emitProgress(fileId, 85, 'persisting', 'Deals created, processing contacts');

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
    await emitProgress(fileId, 95, 'finalizing', 'Finalizing import');

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
    await emitProgress(fileId, 100, 'completed', 'Import completed successfully', result);

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

    // Generate actionable error guidance
    try {
      const errorGuidanceService = getErrorGuidanceService();
      const errorGuidance = await errorGuidanceService.generateActionableError({
        message: error.message,
        code: error.code,
        context: {
          fileName: job.data.fileId || 'unknown',
          fileType: intent || 'unknown',
          stage: result.errors.length > 0 ? 'parsing' : 'processing',
        },
      });

      result.errorGuidance = errorGuidance;
      logger.info('Generated actionable error guidance', {
        fileId,
        guidanceTitle: errorGuidance.title,
      });
    } catch (guidanceError: any) {
      logger.warn('Failed to generate error guidance', {
        error: guidanceError.message,
      });
      // Continue without guidance - not critical
    }

    await emitProgress(fileId, 0, 'failed', error.message, result);

    // Update file status to failed with error guidance if available
    const errorMetadata = result.errorGuidance
      ? JSON.stringify({ guidance: result.errorGuidance })
      : null;

    await query(
      'UPDATE source_files SET processing_status = $1, error_message = $2, metadata = COALESCE(metadata, \'{}\'::jsonb) || COALESCE($3::jsonb, \'{}\'::jsonb) WHERE id = $4',
      ['failed', error.message, errorMetadata, fileId]
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

  logger.info('Adding unified job', { fileId, intent, vendorId: data.vendorId, vendorName: data.vendorName });

  // Remove existing job if present
  const existing = await unifiedProcessingQueue.getJob(`unified-${fileId}`);
  if (existing) {
    const state = await existing.getState();
    logger.debug('Found existing job', { fileId, existingJobId: existing.id, state });
    if (state === 'completed' || state === 'failed' || state === 'delayed') {
      await existing.remove();
      logger.info('Removed existing unified job to allow reprocessing', { fileId, state });
    }
  }

  const jobId = `unified-${fileId}-${Date.now()}`;
  logger.debug('Creating job with ID', { jobId, fileId });

  const job = await unifiedProcessingQueue.add(data, {
    jobId,
    priority: 1,
  });

  // Get queue stats immediately after adding
  const stats = await getUnifiedQueueStats();
  logger.info('Unified processing job added successfully', {
    jobId: job.id,
    fileId,
    intent,
    queueStats: stats,
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
  logger.debug('SSE: Subscribing to progress events', { fileId, eventName, listenerCount: progressEmitter.listenerCount(eventName) });
  progressEmitter.on(eventName, callback);

  return () => {
    logger.debug('SSE: Unsubscribing from progress events', { fileId, eventName });
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
