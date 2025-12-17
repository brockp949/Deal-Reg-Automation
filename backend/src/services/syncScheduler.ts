/**
 * Sync Scheduler
 *
 * Cron job service that checks for due sync configurations
 * and queues them for processing.
 */

import * as cron from 'node-cron';
import { query } from '../db';
import logger from '../utils/logger';
import { addGmailSyncJob, addDriveSyncJob } from '../queues/syncProcessingQueue';

// Schedule frequencies and their cron expressions
const FREQUENCY_CRON: Record<string, string> = {
  hourly: '0 * * * *',      // Every hour at minute 0
  daily: '0 6 * * *',       // Every day at 6 AM
  weekly: '0 6 * * 1',      // Every Monday at 6 AM
};

// Frequency intervals in milliseconds for calculating next_sync_at
const FREQUENCY_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,           // 1 hour
  daily: 24 * 60 * 60 * 1000,       // 24 hours
  weekly: 7 * 24 * 60 * 60 * 1000,  // 7 days
};

let schedulerTask: cron.ScheduledTask | null = null;
let isRunning = false;

/**
 * Check for due syncs and queue them
 */
async function checkAndQueueDueSyncs(): Promise<void> {
  if (isRunning) {
    logger.debug('Scheduler already running, skipping this tick');
    return;
  }

  isRunning = true;

  try {
    // Find configurations that are due for sync
    const result = await query(
      `SELECT sc.*, got.account_email
       FROM sync_configurations sc
       JOIN google_oauth_tokens got ON sc.token_id = got.id
       WHERE sc.enabled = true
         AND sc.sync_frequency != 'manual'
         AND (sc.next_sync_at IS NULL OR sc.next_sync_at <= NOW())
         AND got.revoked_at IS NULL`,
      []
    );

    if (result.rows.length === 0) {
      logger.debug('No sync configurations due');
      return;
    }

    logger.info('Found due sync configurations', {
      count: result.rows.length,
    });

    for (const config of result.rows) {
      try {
        // Queue the sync job
        if (config.service_type === 'gmail') {
          await addGmailSyncJob(config.id, 'scheduled');
          logger.info('Queued scheduled Gmail sync', {
            configId: config.id,
            name: config.name,
            email: config.account_email,
          });
        } else if (config.service_type === 'drive') {
          await addDriveSyncJob(config.id, 'scheduled');
          logger.info('Queued scheduled Drive sync', {
            configId: config.id,
            name: config.name,
            email: config.account_email,
          });
        }

        // Calculate next sync time
        const intervalMs = FREQUENCY_MS[config.sync_frequency];
        if (intervalMs) {
          const nextSyncAt = new Date(Date.now() + intervalMs);
          await query(
            `UPDATE sync_configurations SET next_sync_at = $1 WHERE id = $2`,
            [nextSyncAt, config.id]
          );

          logger.debug('Updated next sync time', {
            configId: config.id,
            nextSyncAt: nextSyncAt.toISOString(),
          });
        }

      } catch (error: any) {
        logger.error('Failed to queue scheduled sync', {
          configId: config.id,
          error: error.message,
        });
      }
    }

  } catch (error: any) {
    logger.error('Error checking for due syncs', {
      error: error.message,
    });
  } finally {
    isRunning = false;
  }
}

/**
 * Start the sync scheduler
 */
export function startSyncScheduler(): void {
  if (schedulerTask) {
    logger.warn('Sync scheduler already started');
    return;
  }

  // Run every 5 minutes to check for due syncs
  // This is more granular than the sync frequencies to ensure timely execution
  schedulerTask = cron.schedule('*/5 * * * *', async () => {
    logger.debug('Scheduler tick - checking for due syncs');
    await checkAndQueueDueSyncs();
  });

  logger.info('Sync scheduler started (checking every 5 minutes)');

  // Run once immediately on startup
  checkAndQueueDueSyncs().catch((err) => {
    logger.error('Initial sync check failed', { error: err.message });
  });
}

/**
 * Stop the sync scheduler
 */
export function stopSyncScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('Sync scheduler stopped');
  }
}

/**
 * Calculate next sync time based on frequency
 */
export function calculateNextSyncTime(
  frequency: string,
  fromDate: Date = new Date()
): Date | null {
  const intervalMs = FREQUENCY_MS[frequency];
  if (!intervalMs) {
    return null; // Manual or unknown frequency
  }

  return new Date(fromDate.getTime() + intervalMs);
}

/**
 * Update sync configuration schedule
 */
export async function updateSyncSchedule(
  configId: string,
  frequency: string
): Promise<void> {
  let nextSyncAt: Date | null = null;

  if (frequency !== 'manual') {
    nextSyncAt = calculateNextSyncTime(frequency);
  }

  await query(
    `UPDATE sync_configurations
     SET sync_frequency = $1, next_sync_at = $2, updated_at = NOW()
     WHERE id = $3`,
    [frequency, nextSyncAt, configId]
  );

  logger.info('Updated sync schedule', {
    configId,
    frequency,
    nextSyncAt: nextSyncAt?.toISOString() || 'manual',
  });
}

/**
 * Pause a sync configuration (disable without deleting)
 */
export async function pauseSync(configId: string): Promise<void> {
  await query(
    `UPDATE sync_configurations SET enabled = false, updated_at = NOW() WHERE id = $1`,
    [configId]
  );

  logger.info('Paused sync configuration', { configId });
}

/**
 * Resume a paused sync configuration
 */
export async function resumeSync(configId: string): Promise<void> {
  // Get current frequency
  const result = await query(
    `SELECT sync_frequency FROM sync_configurations WHERE id = $1`,
    [configId]
  );

  if (result.rows.length === 0) {
    throw new Error('Sync configuration not found');
  }

  const { sync_frequency } = result.rows[0];
  let nextSyncAt: Date | null = null;

  if (sync_frequency !== 'manual') {
    nextSyncAt = calculateNextSyncTime(sync_frequency);
  }

  await query(
    `UPDATE sync_configurations
     SET enabled = true, next_sync_at = $1, updated_at = NOW()
     WHERE id = $2`,
    [nextSyncAt, configId]
  );

  logger.info('Resumed sync configuration', {
    configId,
    nextSyncAt: nextSyncAt?.toISOString() || 'manual',
  });
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  running: boolean;
  isProcessing: boolean;
} {
  return {
    running: schedulerTask !== null,
    isProcessing: isRunning,
  };
}

/**
 * Get statistics about scheduled syncs
 */
export async function getScheduleStats(): Promise<{
  totalConfigs: number;
  enabledConfigs: number;
  dueNow: number;
  byFrequency: Record<string, number>;
}> {
  const totalResult = await query(
    `SELECT COUNT(*) as count FROM sync_configurations`,
    []
  );

  const enabledResult = await query(
    `SELECT COUNT(*) as count FROM sync_configurations WHERE enabled = true`,
    []
  );

  const dueResult = await query(
    `SELECT COUNT(*) as count FROM sync_configurations
     WHERE enabled = true
       AND sync_frequency != 'manual'
       AND (next_sync_at IS NULL OR next_sync_at <= NOW())`,
    []
  );

  const frequencyResult = await query(
    `SELECT sync_frequency, COUNT(*) as count
     FROM sync_configurations
     WHERE enabled = true
     GROUP BY sync_frequency`,
    []
  );

  const byFrequency: Record<string, number> = {};
  for (const row of frequencyResult.rows) {
    byFrequency[row.sync_frequency] = parseInt(row.count, 10);
  }

  return {
    totalConfigs: parseInt(totalResult.rows[0].count, 10),
    enabledConfigs: parseInt(enabledResult.rows[0].count, 10),
    dueNow: parseInt(dueResult.rows[0].count, 10),
    byFrequency,
  };
}

export default {
  startSyncScheduler,
  stopSyncScheduler,
  calculateNextSyncTime,
  updateSyncSchedule,
  pauseSync,
  resumeSync,
  getSchedulerStatus,
  getScheduleStats,
};
