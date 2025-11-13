/**
 * File Locking Utilities - Phase 1 Implementation
 * Cross-platform file locking for concurrent access safety
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

export interface LockOptions {
  timeout_ms?: number;
  retry_interval_ms?: number;
  stale_lock_timeout_ms?: number;
}

export interface LockInfo {
  file_path: string;
  lock_path: string;
  acquired_at: Date;
  process_id: number;
}

const DEFAULT_OPTIONS: Required<LockOptions> = {
  timeout_ms: 30000, // 30 seconds
  retry_interval_ms: 100, // 100ms
  stale_lock_timeout_ms: 300000, // 5 minutes
};

export class FileLock {
  private filePath: string;
  private lockPath: string;
  private options: Required<LockOptions>;
  private lockInfo: LockInfo | null = null;

  constructor(filePath: string, options: LockOptions = {}) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Acquire lock on file
   */
  async acquire(): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.options.timeout_ms) {
      try {
        // Check if lock file exists
        if (fs.existsSync(this.lockPath)) {
          // Check if lock is stale
          const isStale = await this.isLockStale();

          if (isStale) {
            logger.warn('Removing stale lock', { lockPath: this.lockPath });
            await this.forceRelease();
          } else {
            // Lock exists and is not stale, wait and retry
            await this.sleep(this.options.retry_interval_ms);
            continue;
          }
        }

        // Try to create lock file
        const lockInfo: LockInfo = {
          file_path: this.filePath,
          lock_path: this.lockPath,
          acquired_at: new Date(),
          process_id: process.pid,
        };

        // Write lock file atomically using exclusive flag
        fs.writeFileSync(
          this.lockPath,
          JSON.stringify(lockInfo, null, 2),
          { flag: 'wx' } // Write exclusive - fails if file exists
        );

        this.lockInfo = lockInfo;

        logger.debug('Lock acquired', {
          filePath: this.filePath,
          processId: process.pid,
        });

        return true;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          // Lock file was created by another process, retry
          await this.sleep(this.options.retry_interval_ms);
          continue;
        } else {
          logger.error('Error acquiring lock', { error, filePath: this.filePath });
          throw error;
        }
      }
    }

    logger.warn('Lock acquisition timeout', {
      filePath: this.filePath,
      timeoutMs: this.options.timeout_ms,
    });

    return false;
  }

  /**
   * Release lock
   */
  async release(): Promise<void> {
    if (!this.lockInfo) {
      logger.warn('Attempted to release lock that was not acquired', {
        filePath: this.filePath,
      });
      return;
    }

    try {
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
        logger.debug('Lock released', { filePath: this.filePath });
      }

      this.lockInfo = null;
    } catch (error) {
      logger.error('Error releasing lock', { error, filePath: this.filePath });
      throw error;
    }
  }

  /**
   * Force release lock (for cleaning up stale locks)
   */
  async forceRelease(): Promise<void> {
    try {
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
        logger.info('Lock force released', { filePath: this.filePath });
      }
    } catch (error) {
      logger.error('Error force releasing lock', {
        error,
        filePath: this.filePath,
      });
      throw error;
    }
  }

  /**
   * Check if current lock is stale
   */
  private async isLockStale(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.lockPath)) {
        return false;
      }

      const lockContent = fs.readFileSync(this.lockPath, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(lockContent);

      const lockAge = Date.now() - new Date(lockInfo.acquired_at).getTime();

      if (lockAge > this.options.stale_lock_timeout_ms) {
        logger.warn('Stale lock detected', {
          lockPath: this.lockPath,
          lockAgeMs: lockAge,
          threshold: this.options.stale_lock_timeout_ms,
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking lock staleness', {
        error,
        lockPath: this.lockPath,
      });
      // If we can't read the lock, consider it stale
      return true;
    }
  }

  /**
   * Check if lock is currently held
   */
  is_locked(): boolean {
    return this.lockInfo !== null;
  }

  /**
   * Get current lock info
   */
  get_lock_info(): LockInfo | null {
    return this.lockInfo;
  }

  /**
   * Execute callback with lock
   */
  async with_lock<T>(
    callback: () => Promise<T>
  ): Promise<T> {
    const acquired = await this.acquire();

    if (!acquired) {
      throw new Error(`Failed to acquire lock for ${this.filePath}`);
    }

    try {
      const result = await callback();
      return result;
    } finally {
      await this.release();
    }
  }

  /**
   * Helper to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Helper function for simple lock operations
 */
export async function with_file_lock<T>(
  filePath: string,
  callback: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const lock = new FileLock(filePath, options);
  return lock.with_lock(callback);
}

/**
 * Clean up all stale locks in a directory
 */
export async function cleanup_stale_locks(
  directory: string,
  stale_timeout_ms: number = 300000
): Promise<number> {
  let cleaned = 0;

  try {
    const files = fs.readdirSync(directory);

    for (const file of files) {
      if (file.endsWith('.lock')) {
        const lockPath = path.join(directory, file);
        const originalPath = lockPath.replace(/\.lock$/, '');

        const lock = new FileLock(originalPath, {
          stale_lock_timeout_ms: stale_timeout_ms,
        });

        const isStale = await (lock as any).isLockStale();

        if (isStale) {
          await lock.forceRelease();
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      logger.info('Stale locks cleaned up', {
        directory,
        cleaned,
      });
    }

    return cleaned;
  } catch (error) {
    logger.error('Error cleaning up stale locks', { error, directory });
    return cleaned;
  }
}
