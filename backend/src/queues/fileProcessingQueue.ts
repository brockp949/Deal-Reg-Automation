import Bull from 'bull';
import { config } from '../config';
import { processFile } from '../services/fileProcessor';
import logger from '../utils/logger';

// Create the job queue
export const fileProcessingQueue = new Bull('file-processing', config.redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 500, // Keep last 500 failed jobs
  },
});

// Process jobs
fileProcessingQueue.process(async (job) => {
  const { fileId } = job.data;

  logger.info('Processing file job', { jobId: job.id, fileId });

  // Update progress
  await job.progress(10);

  try {
    // Process the file
    const result = await processFile(fileId);

    // Update progress to 100%
    await job.progress(100);

    logger.info('File processing job completed', {
      jobId: job.id,
      fileId,
      result,
    });

    return result;
  } catch (error: any) {
    logger.error('File processing job failed', {
      jobId: job.id,
      fileId,
      error: error.message,
    });
    throw error;
  }
});

// Event listeners
fileProcessingQueue.on('completed', (job, result) => {
  logger.info('Job completed', {
    jobId: job.id,
    fileId: job.data.fileId,
    vendorsCreated: result.vendorsCreated,
    dealsCreated: result.dealsCreated,
    contactsCreated: result.contactsCreated,
  });
});

fileProcessingQueue.on('failed', (job, error) => {
  logger.error('Job failed', {
    jobId: job.id,
    fileId: job.data.fileId,
    error: error.message,
    attemptsMade: job.attemptsMade,
  });
});

fileProcessingQueue.on('stalled', (job) => {
  logger.warn('Job stalled', {
    jobId: job.id,
    fileId: job.data.fileId,
  });
});

// Add a job to the queue
export async function addFileProcessingJob(fileId: string): Promise<Bull.Job> {
  const job = await fileProcessingQueue.add(
    { fileId },
    {
      jobId: `file-${fileId}`,
      priority: 1,
    }
  );

  logger.info('File processing job added to queue', {
    jobId: job.id,
    fileId,
  });

  return job;
}

// Get job status
export async function getJobStatus(jobId: string) {
  const job = await fileProcessingQueue.getJob(jobId);

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
  };
}

// Retry a failed job
export async function retryJob(jobId: string) {
  const job = await fileProcessingQueue.getJob(jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  await job.retry();
  logger.info('Job retry initiated', { jobId });
}

// Get queue statistics
export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    fileProcessingQueue.getWaitingCount(),
    fileProcessingQueue.getActiveCount(),
    fileProcessingQueue.getCompletedCount(),
    fileProcessingQueue.getFailedCount(),
    fileProcessingQueue.getDelayedCount(),
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

// Clean up old jobs
export async function cleanOldJobs() {
  await fileProcessingQueue.clean(7 * 24 * 60 * 60 * 1000, 'completed'); // 7 days
  await fileProcessingQueue.clean(30 * 24 * 60 * 60 * 1000, 'failed'); // 30 days
  logger.info('Old jobs cleaned up');
}

// Graceful shutdown
export async function closeQueue() {
  await fileProcessingQueue.close();
  logger.info('File processing queue closed');
}
