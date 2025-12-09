import Bull from 'bull';
import { config } from '../config';
import { parseDealFile, ImportedDeal } from '../parsers/dealImporter';
import { query } from '../db';
import { unlink } from 'fs/promises';
import logger from '../utils/logger';

// Create the deal import queue
export const dealImportQueue = new Bull('deal-import', config.redisUrl, {
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: 50,
    removeOnFail: 200,
  },
});

interface DealImportJobData {
  filePath: string;
  originalFilename: string;
  vendorId: string;
}

interface DealImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Import a single deal to the database
 */
async function importDeal(
  deal: ImportedDeal,
  vendorId: string
): Promise<{ created: boolean; updated: boolean; error?: string }> {
  try {
    // Check if deal already exists for this vendor with same name
    const existingResult = await query(
      `SELECT id FROM deal_registrations
       WHERE vendor_id = $1 AND LOWER(deal_name) = LOWER($2)`,
      [vendorId, deal.deal_name]
    );

    if (existingResult.rows.length > 0) {
      // Update existing deal
      await query(
        `UPDATE deal_registrations SET
          deal_value = COALESCE($1, deal_value),
          currency = COALESCE($2, currency),
          customer_name = COALESCE($3, customer_name),
          customer_industry = COALESCE($4, customer_industry),
          registration_date = COALESCE($5, registration_date),
          expected_close_date = COALESCE($6, expected_close_date),
          status = COALESCE($7, status),
          deal_stage = COALESCE($8, deal_stage),
          probability = COALESCE($9, probability),
          notes = COALESCE($10, notes),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $11`,
        [
          deal.deal_value,
          deal.currency,
          deal.customer_name,
          deal.customer_industry,
          deal.registration_date,
          deal.expected_close_date,
          deal.status,
          deal.deal_stage,
          deal.probability,
          deal.notes,
          existingResult.rows[0].id,
        ]
      );
      return { created: false, updated: true };
    }

    // Create new deal
    await query(
      `INSERT INTO deal_registrations (
        vendor_id, deal_name, deal_value, currency, customer_name,
        customer_industry, registration_date, expected_close_date,
        status, deal_stage, probability, notes, source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        vendorId,
        deal.deal_name,
        deal.deal_value,
        deal.currency || 'USD',
        deal.customer_name,
        deal.customer_industry,
        deal.registration_date,
        deal.expected_close_date,
        deal.status || 'registered',
        deal.deal_stage,
        deal.probability,
        deal.notes,
        'import',
      ]
    );

    return { created: true, updated: false };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { created: false, updated: false, error: message };
  }
}

/**
 * Import multiple deals for a vendor
 */
async function importDealsForVendor(
  deals: ImportedDeal[],
  vendorId: string
): Promise<DealImportResult> {
  const result: DealImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const deal of deals) {
    const importResult = await importDeal(deal, vendorId);

    if (importResult.error) {
      result.errors.push(`${deal.deal_name}: ${importResult.error}`);
      result.skipped++;
    } else if (importResult.created) {
      result.created++;
    } else if (importResult.updated) {
      result.updated++;
    }
  }

  return result;
}

// Process deal import jobs
dealImportQueue.process(async (job) => {
  const { filePath, originalFilename, vendorId } = job.data as DealImportJobData;

  logger.info('Processing deal import job', { jobId: job.id, filename: originalFilename, vendorId });

  // Progress: 0% - Starting
  await job.progress(0);

  try {
    // Verify vendor exists
    const vendorResult = await query('SELECT id, name FROM vendors WHERE id = $1', [vendorId]);
    if (vendorResult.rows.length === 0) {
      await unlink(filePath).catch(() => {});
      throw new Error('Vendor not found');
    }

    const vendorName = vendorResult.rows[0].name;

    // Progress: 10% - Parsing file
    await job.progress(10);
    logger.info('Parsing deal file', { filename: originalFilename, vendor: vendorName });

    const parseResult = await parseDealFile(filePath);

    if (!parseResult.success) {
      await unlink(filePath).catch(() => {});
      throw new Error(`Failed to parse deal file: ${parseResult.errors.join(', ')}`);
    }

    // Progress: 40% - File parsed
    await job.progress(40);
    logger.info('Deal file parsed', {
      deals: parseResult.successCount,
      errors: parseResult.errorCount,
      duplicates: parseResult.duplicates,
    });

    // Progress: 50% - Starting import
    await job.progress(50);
    logger.info('Importing deals to database', { count: parseResult.deals.length, vendor: vendorName });

    // Split deals into batches for progress tracking
    const totalDeals = parseResult.deals.length;
    const batchSize = Math.max(Math.floor(totalDeals / 10), 1);
    const batches: ImportedDeal[][] = [];

    for (let i = 0; i < totalDeals; i += batchSize) {
      batches.push(parseResult.deals.slice(i, i + batchSize));
    }

    const importResults: DealImportResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    let processedDeals = 0;

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchResult = await importDealsForVendor(batch, vendorId);

      // Merge results
      importResults.created += batchResult.created;
      importResults.updated += batchResult.updated;
      importResults.skipped += batchResult.skipped;
      importResults.errors.push(...batchResult.errors);

      processedDeals += batch.length;

      // Update progress: 50% to 90%
      const progress = 50 + Math.floor((processedDeals / totalDeals) * 40);
      await job.progress(progress);

      logger.info('Deal import batch completed', {
        batch: i + 1,
        totalBatches: batches.length,
        progress: `${progress}%`,
      });
    }

    // Progress: 95% - Cleaning up
    await job.progress(95);

    // Clean up file
    await unlink(filePath).catch((err) => {
      logger.warn('Failed to delete temp file', { path: filePath, error: err.message });
    });

    // Progress: 100% - Complete
    await job.progress(100);

    const result = {
      vendorId,
      vendorName,
      parsed: {
        total: parseResult.totalRows,
        success: parseResult.successCount,
        errors: parseResult.errorCount,
        duplicates: parseResult.duplicates,
      },
      imported: importResults,
      errors: [...parseResult.errors, ...importResults.errors],
    };

    logger.info('Deal import job completed', {
      jobId: job.id,
      filename: originalFilename,
      result,
    });

    return result;

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Deal import job failed', {
      jobId: job.id,
      filename: originalFilename,
      error: message,
    });

    // Clean up file on error
    await unlink(filePath).catch(() => {});

    throw error;
  }
});

// Event listeners
dealImportQueue.on('completed', (job, result) => {
  logger.info('Deal import completed', {
    jobId: job.id,
    filename: job.data.originalFilename,
    vendorId: job.data.vendorId,
    created: result.imported.created,
    updated: result.imported.updated,
    skipped: result.imported.skipped,
  });
});

dealImportQueue.on('failed', (job, error) => {
  logger.error('Deal import failed', {
    jobId: job.id,
    filename: job.data.originalFilename,
    vendorId: job.data.vendorId,
    error: error.message,
    attemptsMade: job.attemptsMade,
  });
});

dealImportQueue.on('stalled', (job) => {
  logger.warn('Deal import job stalled', {
    jobId: job.id,
    filename: job.data.originalFilename,
    vendorId: job.data.vendorId,
  });
});

dealImportQueue.on('progress', (job, progress) => {
  logger.info('Deal import progress', {
    jobId: job.id,
    filename: job.data.originalFilename,
    vendorId: job.data.vendorId,
    progress: `${progress}%`,
  });
});

// Add a deal import job to the queue
export async function addDealImportJob(
  filePath: string,
  originalFilename: string,
  vendorId: string
): Promise<Bull.Job> {
  const job = await dealImportQueue.add(
    { filePath, originalFilename, vendorId },
    {
      jobId: `deal-import-${Date.now()}`,
      priority: 2,
    }
  );

  logger.info('Deal import job added to queue', {
    jobId: job.id,
    filename: originalFilename,
    vendorId,
  });

  return job;
}

// Get job status
export async function getDealImportJobStatus(jobId: string) {
  const job = await dealImportQueue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress();
  const failedReason = job.failedReason;

  return {
    id: job.id,
    state,
    progress,
    data: job.data,
    result: await job.finished().catch(() => null),
    failedReason,
    attemptsMade: job.attemptsMade,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
  };
}

// Get queue statistics
export async function getDealImportQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    dealImportQueue.getWaitingCount(),
    dealImportQueue.getActiveCount(),
    dealImportQueue.getCompletedCount(),
    dealImportQueue.getFailedCount(),
    dealImportQueue.getDelayedCount(),
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

// Retry a failed job
export async function retryDealImportJob(jobId: string) {
  const job = await dealImportQueue.getJob(jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  const state = await job.getState();
  if (state !== 'failed') {
    throw new Error(`Job is not in failed state (current state: ${state})`);
  }

  return job.retry();
}

export default {
  dealImportQueue,
  addDealImportJob,
  getDealImportJobStatus,
  getDealImportQueueStats,
  retryDealImportJob,
};
