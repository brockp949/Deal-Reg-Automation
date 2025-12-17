import Bull from 'bull';
import { config } from '../config';
import logger from '../utils/logger';
import { startJob, updateJobProgress, completeJob, failJob, createJob } from '../services/jobTracker';

// Job data types
export interface GmailSyncJobData {
  type: 'gmail_sync';
  configId: string;
  triggerType: 'manual' | 'scheduled';
  triggeredBy?: string;
}

export interface DriveSyncJobData {
  type: 'drive_sync';
  configId: string;
  triggerType: 'manual' | 'scheduled';
  triggeredBy?: string;
}

export type SyncJobData = GmailSyncJobData | DriveSyncJobData;

export interface SyncJobResult {
  configId: string;
  syncRunId: string;
  itemsFound: number;
  itemsProcessed: number;
  dealsCreated: number;
  errorsCount: number;
  duration: number;
}

// Create the sync queue
export const syncProcessingQueue = new Bull<SyncJobData>('sync-processing', config.redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000, // Start with 10 seconds, then 20s, 40s
    },
    removeOnComplete: 200, // Keep last 200 completed jobs
    removeOnFail: 500, // Keep last 500 failed jobs
    timeout: 30 * 60 * 1000, // 30 minute timeout for sync jobs
  },
});

// Process jobs - actual processing delegated to sync service
// The service will be imported dynamically to avoid circular dependencies
syncProcessingQueue.process(async (job) => {
  const { type, configId, triggerType, triggeredBy } = job.data;

  logger.info('Processing sync job', {
    jobId: job.id,
    type,
    configId,
    triggerType
  });

  const trackerId = startSyncJob(job.id.toString(), type, configId);

  // Update progress - starting
  await job.progress(5);
  updateJobProgress(trackerId, 5, 'starting');

  try {
    // Dynamic import to avoid circular dependencies
    const { syncGmailConfig, syncDriveConfig } = await import('../services/googleSyncService');

    let result: SyncJobResult;

    if (type === 'gmail_sync') {
      await job.progress(10);
      updateJobProgress(trackerId, 10, 'fetching_emails');

      result = await syncGmailConfig(configId, triggerType, triggeredBy, (progress, status) => {
        job.progress(progress);
        updateJobProgress(trackerId, progress, status);
      });
    } else if (type === 'drive_sync') {
      await job.progress(10);
      updateJobProgress(trackerId, 10, 'fetching_files');

      result = await syncDriveConfig(configId, triggerType, triggeredBy, (progress, status) => {
        job.progress(progress);
        updateJobProgress(trackerId, progress, status);
      });
    } else {
      throw new Error(`Unknown sync job type: ${type}`);
    }

    // Update progress to 100%
    await job.progress(100);
    updateJobProgress(trackerId, 100, 'completed');

    logger.info('Sync job completed', {
      jobId: job.id,
      type,
      configId,
      itemsProcessed: result.itemsProcessed,
      dealsCreated: result.dealsCreated,
    });

    completeJob(trackerId, result);
    return result;
  } catch (error: any) {
    logger.error('Sync job failed', {
      jobId: job.id,
      type,
      configId,
      error: error.message,
      stack: error.stack,
    });
    failJob(trackerId, error.message);
    throw error;
  }
});

// Event listeners
syncProcessingQueue.on('completed', (job, result: SyncJobResult) => {
  logger.info('Sync job completed', {
    jobId: job.id,
    type: job.data.type,
    configId: job.data.configId,
    itemsFound: result.itemsFound,
    itemsProcessed: result.itemsProcessed,
    dealsCreated: result.dealsCreated,
    duration: result.duration,
  });
});

syncProcessingQueue.on('failed', (job, error) => {
  logger.error('Sync job failed', {
    jobId: job.id,
    type: job.data.type,
    configId: job.data.configId,
    error: error.message,
    attemptsMade: job.attemptsMade,
  });
});

syncProcessingQueue.on('stalled', (job) => {
  logger.warn('Sync job stalled', {
    jobId: job.id,
    type: job.data.type,
    configId: job.data.configId,
  });
});

syncProcessingQueue.on('progress', (job, progress) => {
  logger.debug('Sync job progress', {
    jobId: job.id,
    type: job.data.type,
    configId: job.data.configId,
    progress,
  });
});

/**
 * Add a Gmail sync job to the queue
 */
export async function addGmailSyncJob(
  configId: string,
  triggerType: 'manual' | 'scheduled',
  triggeredBy?: string
): Promise<Bull.Job<SyncJobData>> {
  // Check for existing active job
  const existingJobs = await syncProcessingQueue.getJobs(['active', 'waiting']);
  const hasActiveJob = existingJobs.some(
    job => job.data.type === 'gmail_sync' && job.data.configId === configId
  );

  if (hasActiveJob) {
    throw new Error('A sync job for this configuration is already in progress');
  }

  const job = await syncProcessingQueue.add(
    {
      type: 'gmail_sync',
      configId,
      triggerType,
      triggeredBy,
    },
    {
      jobId: `gmail-sync-${configId}-${Date.now()}`,
      priority: triggerType === 'manual' ? 1 : 2, // Manual jobs get higher priority
    }
  );

  logger.info('Gmail sync job added to queue', {
    jobId: job.id,
    configId,
    triggerType,
  });

  return job;
}

/**
 * Add a Drive sync job to the queue
 */
export async function addDriveSyncJob(
  configId: string,
  triggerType: 'manual' | 'scheduled',
  triggeredBy?: string
): Promise<Bull.Job<SyncJobData>> {
  // Check for existing active job
  const existingJobs = await syncProcessingQueue.getJobs(['active', 'waiting']);
  const hasActiveJob = existingJobs.some(
    job => job.data.type === 'drive_sync' && job.data.configId === configId
  );

  if (hasActiveJob) {
    throw new Error('A sync job for this configuration is already in progress');
  }

  const job = await syncProcessingQueue.add(
    {
      type: 'drive_sync',
      configId,
      triggerType,
      triggeredBy,
    },
    {
      jobId: `drive-sync-${configId}-${Date.now()}`,
      priority: triggerType === 'manual' ? 1 : 2,
    }
  );

  logger.info('Drive sync job added to queue', {
    jobId: job.id,
    configId,
    triggerType,
  });

  return job;
}

/**
 * Get sync job status by job ID
 */
export async function getSyncJobStatus(jobId: string) {
  const job = await syncProcessingQueue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress();
  const result = job.returnvalue as SyncJobResult | undefined;
  const failedReason = job.failedReason;

  return {
    id: job.id,
    type: job.data.type,
    configId: job.data.configId,
    triggerType: job.data.triggerType,
    state,
    progress,
    result,
    failedReason,
    attemptsMade: job.attemptsMade,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
  };
}

/**
 * Get all jobs for a specific config
 */
export async function getJobsForConfig(configId: string): Promise<Bull.Job<SyncJobData>[]> {
  const allJobs = await syncProcessingQueue.getJobs(['active', 'waiting', 'completed', 'failed']);
  return allJobs.filter(job => job.data.configId === configId);
}

/**
 * Cancel a pending sync job
 */
export async function cancelSyncJob(jobId: string): Promise<boolean> {
  const job = await syncProcessingQueue.getJob(jobId);

  if (!job) {
    return false;
  }

  const state = await job.getState();
  if (state === 'waiting' || state === 'delayed') {
    await job.remove();
    logger.info('Sync job cancelled', { jobId });
    return true;
  }

  return false;
}

/**
 * Retry a failed sync job
 */
export async function retrySyncJob(jobId: string): Promise<void> {
  const job = await syncProcessingQueue.getJob(jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  await job.retry();
  logger.info('Sync job retry initiated', { jobId });
}

/**
 * Get queue statistics
 */
export async function getSyncQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    syncProcessingQueue.getWaitingCount(),
    syncProcessingQueue.getActiveCount(),
    syncProcessingQueue.getCompletedCount(),
    syncProcessingQueue.getFailedCount(),
    syncProcessingQueue.getDelayedCount(),
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
 * Clean up old jobs
 */
export async function cleanOldSyncJobs(): Promise<void> {
  await syncProcessingQueue.clean(7 * 24 * 60 * 60 * 1000, 'completed'); // 7 days
  await syncProcessingQueue.clean(30 * 24 * 60 * 60 * 1000, 'failed'); // 30 days
  logger.info('Old sync jobs cleaned up');
}

/**
 * Graceful shutdown
 */
export async function closeSyncQueue(): Promise<void> {
  await syncProcessingQueue.close();
  logger.info('Sync processing queue closed');
}

/**
 * Start tracking a sync job
 */
function startSyncJob(bullJobId: string, type: string, configId: string): string {
  const trackerId = createJob('sync_processing', { bullJobId, type, configId });
  startJob(trackerId, 'queued');
  updateJobProgress(trackerId, 0, 'queued');
  return trackerId;
}

export default syncProcessingQueue;
