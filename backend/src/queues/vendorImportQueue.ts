import Bull from 'bull';
import { config } from '../config';
import { parseVendorFile } from '../parsers/vendorImporter';
import { importAndMergeVendors } from '../services/vendorIntelligence';
import { unlink } from 'fs/promises';
import logger from '../utils/logger';

// Create the vendor import queue
export const vendorImportQueue = new Bull('vendor-import', config.redisUrl, {
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

// Process vendor import jobs
vendorImportQueue.process(async (job) => {
  const { filePath, originalFilename } = job.data;

  logger.info('Processing vendor import job', { jobId: job.id, filename: originalFilename });

  // Progress: 0% - Starting
  await job.progress(0);

  try {
    // Progress: 10% - Parsing file
    await job.progress(10);
    logger.info('Parsing vendor file', { filename: originalFilename });

    const parseResult = await parseVendorFile(filePath);

    if (!parseResult.success) {
      // Clean up file
      await unlink(filePath).catch(() => {});

      throw new Error(`Failed to parse vendor file: ${parseResult.errors.join(', ')}`);
    }

    // Progress: 40% - File parsed
    await job.progress(40);
    logger.info('Vendor file parsed', {
      vendors: parseResult.successCount,
      errors: parseResult.errorCount,
      duplicates: parseResult.duplicates,
    });

    // Progress: 50% - Starting import
    await job.progress(50);
    logger.info('Importing vendors to database', { count: parseResult.vendors.length });

    // Import with progress updates
    const totalVendors = parseResult.vendors.length;
    let processedVendors = 0;

    // Split vendors into batches for progress tracking
    const batchSize = Math.max(Math.floor(totalVendors / 10), 1);
    const batches: any[][] = [];

    for (let i = 0; i < totalVendors; i += batchSize) {
      batches.push(parseResult.vendors.slice(i, i + batchSize));
    }

    const importResults = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchResult = await importAndMergeVendors(batch);

      // Merge results
      importResults.imported += batchResult.imported;
      importResults.updated += batchResult.updated;
      importResults.skipped += batchResult.skipped;
      importResults.errors.push(...batchResult.errors);

      processedVendors += batch.length;

      // Update progress: 50% to 90%
      const progress = 50 + Math.floor((processedVendors / totalVendors) * 40);
      await job.progress(progress);

      logger.info('Vendor import batch completed', {
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
      parsed: {
        total: parseResult.totalRows,
        success: parseResult.successCount,
        errors: parseResult.errorCount,
        duplicates: parseResult.duplicates,
      },
      imported: importResults,
      errors: [...parseResult.errors, ...importResults.errors],
    };

    logger.info('Vendor import job completed', {
      jobId: job.id,
      filename: originalFilename,
      result,
    });

    return result;

  } catch (error: any) {
    logger.error('Vendor import job failed', {
      jobId: job.id,
      filename: originalFilename,
      error: error.message,
    });

    // Clean up file on error
    await unlink(filePath).catch(() => {});

    throw error;
  }
});

// Event listeners
vendorImportQueue.on('completed', (job, result) => {
  logger.info('Vendor import completed', {
    jobId: job.id,
    filename: job.data.originalFilename,
    imported: result.imported.imported,
    updated: result.imported.updated,
    skipped: result.imported.skipped,
  });
});

vendorImportQueue.on('failed', (job, error) => {
  logger.error('Vendor import failed', {
    jobId: job.id,
    filename: job.data.originalFilename,
    error: error.message,
    attemptsMade: job.attemptsMade,
  });
});

vendorImportQueue.on('stalled', (job) => {
  logger.warn('Vendor import job stalled', {
    jobId: job.id,
    filename: job.data.originalFilename,
  });
});

vendorImportQueue.on('progress', (job, progress) => {
  logger.info('Vendor import progress', {
    jobId: job.id,
    filename: job.data.originalFilename,
    progress: `${progress}%`,
  });
});

// Add a vendor import job to the queue
export async function addVendorImportJob(
  filePath: string,
  originalFilename: string
): Promise<Bull.Job> {
  const job = await vendorImportQueue.add(
    { filePath, originalFilename },
    {
      jobId: `vendor-import-${Date.now()}`,
      priority: 2, // Higher priority than file processing
    }
  );

  logger.info('Vendor import job added to queue', {
    jobId: job.id,
    filename: originalFilename,
  });

  return job;
}

// Get job status
export async function getVendorImportJobStatus(jobId: string) {
  const job = await vendorImportQueue.getJob(jobId);

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
export async function getVendorImportQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    vendorImportQueue.getWaitingCount(),
    vendorImportQueue.getActiveCount(),
    vendorImportQueue.getCompletedCount(),
    vendorImportQueue.getFailedCount(),
    vendorImportQueue.getDelayedCount(),
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
export async function retryVendorImportJob(jobId: string) {
  const job = await vendorImportQueue.getJob(jobId);

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
  vendorImportQueue,
  addVendorImportJob,
  getVendorImportJobStatus,
  getVendorImportQueueStats,
  retryVendorImportJob,
};
