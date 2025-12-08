/**
 * File System Opportunity Repository
 * Provides thread-safe file-based persistence with:
 * - File locking to prevent race conditions
 * - Atomic writes via temp file + rename
 * - Index file for faster queries
 */

import { promises as fs } from 'fs';
import path from 'path';
import { OpportunityRecord } from '../opportunities/types';
import {
  IOpportunityRepository,
  OpportunityFilter,
  PaginationOptions,
  PaginatedResult,
  UpsertResult,
  FileSystemRepositoryConfig,
} from './IOpportunityRepository';
import logger from '../utils/logger';

// ============================================================================
// File Lock Implementation
// ============================================================================

interface FileLock {
  lockFile: string;
  acquired: boolean;
  timestamp: number;
}

class FileLockManager {
  private locks: Map<string, FileLock> = new Map();
  private readonly lockTimeout: number;
  private readonly staleThreshold: number;

  constructor(lockTimeout = 10000, staleThreshold = 30000) {
    this.lockTimeout = lockTimeout;
    this.staleThreshold = staleThreshold;
  }

  async acquire(filePath: string): Promise<boolean> {
    const lockFile = `${filePath}.lock`;
    const startTime = Date.now();

    while (Date.now() - startTime < this.lockTimeout) {
      try {
        // Check for stale lock
        await this.checkAndRemoveStaleLock(lockFile);

        // Try to create lock file exclusively
        const lockData = JSON.stringify({
          pid: process.pid,
          timestamp: Date.now(),
          hostname: require('os').hostname(),
        });

        await fs.writeFile(lockFile, lockData, { flag: 'wx' });

        this.locks.set(filePath, {
          lockFile,
          acquired: true,
          timestamp: Date.now(),
        });

        return true;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          // Lock exists, wait and retry
          await this.sleep(50);
          continue;
        }
        // Directory doesn't exist or other error
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Create parent directory and retry
          await fs.mkdir(path.dirname(lockFile), { recursive: true });
          continue;
        }
        throw error;
      }
    }

    logger.warn('Failed to acquire file lock', { filePath, timeout: this.lockTimeout });
    return false;
  }

  async release(filePath: string): Promise<void> {
    const lock = this.locks.get(filePath);
    if (!lock) return;

    try {
      await fs.unlink(lock.lockFile);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to release file lock', { filePath, error });
      }
    }

    this.locks.delete(filePath);
  }

  private async checkAndRemoveStaleLock(lockFile: string): Promise<void> {
    try {
      const content = await fs.readFile(lockFile, 'utf-8');
      const lockData = JSON.parse(content);

      if (Date.now() - lockData.timestamp > this.staleThreshold) {
        logger.warn('Removing stale lock file', { lockFile, age: Date.now() - lockData.timestamp });
        await fs.unlink(lockFile);
      }
    } catch {
      // Lock file doesn't exist or can't be read - that's fine
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// File System Repository Implementation
// ============================================================================

export class FileSystemRepository implements IOpportunityRepository {
  private readonly baseDir: string;
  private readonly fileName: string;
  private readonly lockManager: FileLockManager;
  private readonly dataFilePath: string;
  private readonly indexFilePath: string;

  constructor(config: FileSystemRepositoryConfig) {
    if (!config.baseDir) {
      throw new Error('FileSystemRepository requires baseDir');
    }

    this.baseDir = config.baseDir;
    this.fileName = config.fileName || 'opportunities.json';
    this.lockManager = new FileLockManager(config.lockTimeout, config.lockStale);
    this.dataFilePath = path.join(this.baseDir, 'opportunities', this.fileName);
    this.indexFilePath = path.join(this.baseDir, 'opportunities', 'index.json');
  }

  async upsert(records: OpportunityRecord[]): Promise<UpsertResult> {
    const result: UpsertResult = {
      upserted: [],
      created: 0,
      updated: 0,
      errors: [],
    };

    if (records.length === 0) {
      return result;
    }

    // Acquire lock
    const lockAcquired = await this.lockManager.acquire(this.dataFilePath);
    if (!lockAcquired) {
      result.errors.push({
        recordId: '*',
        message: 'Failed to acquire file lock',
        code: 'LOCK_TIMEOUT',
      });
      return result;
    }

    try {
      // Ensure directory exists
      await this.ensureDirectory();

      // Read existing data
      const existingData = await this.readDataFile();
      const dataMap = new Map(existingData.map((r) => [r.id, r]));

      // Process upserts
      const now = new Date().toISOString();
      for (const record of records) {
        try {
          const existing = dataMap.get(record.id);
          const updatedRecord: OpportunityRecord = {
            ...record,
            createdAt: existing?.createdAt || record.createdAt || now,
            updatedAt: now,
          };

          dataMap.set(record.id, updatedRecord);
          result.upserted.push(updatedRecord);

          if (existing) {
            result.updated++;
          } else {
            result.created++;
          }
        } catch (error: unknown) {
          result.errors.push({
            recordId: record.id,
            message: error instanceof Error ? error.message : 'Unknown error',
            code: 'UPSERT_FAILED',
          });
        }
      }

      // Write atomically
      const allRecords = Array.from(dataMap.values()).sort((a, b) =>
        a.id.localeCompare(b.id)
      );
      await this.atomicWrite(this.dataFilePath, allRecords);

      // Update index
      await this.updateIndex(allRecords);

      logger.info('FileSystemRepository upserted records', {
        created: result.created,
        updated: result.updated,
        total: allRecords.length,
      });
    } finally {
      await this.lockManager.release(this.dataFilePath);
    }

    return result;
  }

  async findById(id: string): Promise<OpportunityRecord | null> {
    const data = await this.readDataFile();
    return data.find((r) => r.id === id) || null;
  }

  async findByIds(ids: string[]): Promise<OpportunityRecord[]> {
    const idSet = new Set(ids);
    const data = await this.readDataFile();
    return data.filter((r) => idSet.has(r.id));
  }

  async findByFilter(
    filter?: OpportunityFilter,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<OpportunityRecord>> {
    let records = await this.readDataFile();

    // Apply filters
    if (filter) {
      records = records.filter((record) => this.matchesFilter(record, filter));
    }

    // Apply sorting
    const sortBy = pagination?.sortBy || 'createdAt';
    const sortOrder = pagination?.sortOrder || 'desc';
    records.sort((a, b) => {
      const aVal = this.getSortValue(a, sortBy) ?? '';
      const bVal = this.getSortValue(b, sortBy) ?? '';
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    // Apply pagination
    const total = records.length;
    const limit = Math.min(pagination?.limit || 50, 1000);
    const offset = pagination?.offset || 0;
    const paginatedRecords = records.slice(offset, offset + limit);

    return {
      data: paginatedRecords,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async delete(id: string): Promise<boolean> {
    const lockAcquired = await this.lockManager.acquire(this.dataFilePath);
    if (!lockAcquired) {
      throw new Error('Failed to acquire file lock for delete');
    }

    try {
      const data = await this.readDataFile();
      const initialLength = data.length;
      const filtered = data.filter((r) => r.id !== id);

      if (filtered.length === initialLength) {
        return false;
      }

      await this.atomicWrite(this.dataFilePath, filtered);
      await this.updateIndex(filtered);
      return true;
    } finally {
      await this.lockManager.release(this.dataFilePath);
    }
  }

  async deleteMany(ids: string[]): Promise<number> {
    const lockAcquired = await this.lockManager.acquire(this.dataFilePath);
    if (!lockAcquired) {
      throw new Error('Failed to acquire file lock for deleteMany');
    }

    try {
      const idSet = new Set(ids);
      const data = await this.readDataFile();
      const filtered = data.filter((r) => !idSet.has(r.id));
      const deleted = data.length - filtered.length;

      if (deleted > 0) {
        await this.atomicWrite(this.dataFilePath, filtered);
        await this.updateIndex(filtered);
      }

      return deleted;
    } finally {
      await this.lockManager.release(this.dataFilePath);
    }
  }

  async count(filter?: OpportunityFilter): Promise<number> {
    const data = await this.readDataFile();
    if (!filter) {
      return data.length;
    }
    return data.filter((record) => this.matchesFilter(record, filter)).length;
  }

  async exists(id: string): Promise<boolean> {
    const data = await this.readDataFile();
    return data.some((r) => r.id === id);
  }

  async getDistinctVendors(): Promise<string[]> {
    const data = await this.readDataFile();
    const vendors = new Set<string>();
    for (const record of data) {
      if (record.metadata?.vendor) {
        vendors.add(record.metadata.vendor);
      }
    }
    return Array.from(vendors).sort();
  }

  async getDistinctCustomers(): Promise<string[]> {
    const data = await this.readDataFile();
    const customers = new Set<string>();
    for (const record of data) {
      if (record.metadata?.customer) {
        customers.add(record.metadata.customer);
      }
    }
    return Array.from(customers).sort();
  }

  async clear(): Promise<void> {
    const lockAcquired = await this.lockManager.acquire(this.dataFilePath);
    if (!lockAcquired) {
      throw new Error('Failed to acquire file lock for clear');
    }

    try {
      await this.atomicWrite(this.dataFilePath, []);
      await this.atomicWrite(this.indexFilePath, { vendors: [], customers: [], count: 0 });
    } finally {
      await this.lockManager.release(this.dataFilePath);
    }
  }

  async close(): Promise<void> {
    // Ensure any pending locks are released
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async ensureDirectory(): Promise<void> {
    const dir = path.dirname(this.dataFilePath);
    await fs.mkdir(dir, { recursive: true });
  }

  private async readDataFile(): Promise<OpportunityRecord[]> {
    try {
      const content = await fs.readFile(this.dataFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      logger.warn('Data file contains non-array, returning empty', { path: this.dataFilePath });
      return [];
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async atomicWrite(filePath: string, data: unknown): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write to temp file
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  private async updateIndex(records: OpportunityRecord[]): Promise<void> {
    const vendors = new Set<string>();
    const customers = new Set<string>();

    for (const record of records) {
      if (record.metadata?.vendor) {
        vendors.add(record.metadata.vendor);
      }
      if (record.metadata?.customer) {
        customers.add(record.metadata.customer);
      }
    }

    const index = {
      vendors: Array.from(vendors).sort(),
      customers: Array.from(customers).sort(),
      count: records.length,
      lastUpdated: new Date().toISOString(),
    };

    await this.atomicWrite(this.indexFilePath, index);
  }

  private matchesFilter(record: OpportunityRecord, filter: OpportunityFilter): boolean {
    if (filter.vendor && record.metadata?.vendor) {
      if (!record.metadata.vendor.toLowerCase().includes(filter.vendor.toLowerCase())) {
        return false;
      }
    }

    if (filter.customer && record.metadata?.customer) {
      if (!record.metadata.customer.toLowerCase().includes(filter.customer.toLowerCase())) {
        return false;
      }
    }

    if (filter.stage && record.stage !== filter.stage) {
      return false;
    }

    if (filter.priority && record.priority !== filter.priority) {
      return false;
    }

    if (filter.minConfidence !== undefined && record.metadata?.confidence !== undefined) {
      if (record.metadata.confidence < filter.minConfidence) {
        return false;
      }
    }

    if (filter.createdAfter && record.createdAt) {
      if (new Date(record.createdAt) < filter.createdAfter) {
        return false;
      }
    }

    if (filter.createdBefore && record.createdAt) {
      if (new Date(record.createdAt) > filter.createdBefore) {
        return false;
      }
    }

    if (filter.updatedAfter && record.updatedAt) {
      if (new Date(record.updatedAt) < filter.updatedAfter) {
        return false;
      }
    }

    if (filter.searchText) {
      const searchLower = filter.searchText.toLowerCase();
      const searchFields = [
        record.name,
        ...record.actors,
        ...record.nextSteps,
        record.metadata?.vendor,
        record.metadata?.customer,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (!searchFields.includes(searchLower)) {
        return false;
      }
    }

    return true;
  }

  private getSortValue(
    record: OpportunityRecord,
    sortBy: string
  ): string | number | undefined {
    switch (sortBy) {
      case 'createdAt':
        return record.createdAt || '';
      case 'updatedAt':
        return record.updatedAt || '';
      case 'name':
        return record.name;
      case 'stage':
        return record.stage;
      case 'priority':
        return record.priority;
      default:
        return record.createdAt || '';
    }
  }
}
