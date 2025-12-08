/**
 * OpportunityStore - High-level API for opportunity persistence
 *
 * This class provides a simplified interface for storing opportunities,
 * using the repository pattern under the hood for thread-safe operations.
 *
 * The repository implementation can be configured via:
 * - Constructor options (repositoryType)
 * - Environment variable (OPPORTUNITY_STORE_TYPE)
 *
 * Available repository types:
 * - 'filesystem': JSON file with file locking (default)
 * - 'postgres': PostgreSQL database with transactions
 * - 'memory': In-memory storage for testing
 */

import path from 'path';
import { OpportunityRecord } from './types';
import logger from '../utils/logger';
import {
  IOpportunityRepository,
  createOpportunityRepository,
  FileSystemRepository,
  OpportunityFilter,
  PaginationOptions,
  PaginatedResult,
} from '../repositories';

export interface OpportunityStoreOptions {
  baseDir: string;
  fileName?: string;
  /** Repository type: 'filesystem' | 'postgres' | 'memory' */
  repositoryType?: 'filesystem' | 'postgres' | 'memory';
  /** Lock timeout in ms (filesystem only) */
  lockTimeout?: number;
  /** Lock stale threshold in ms (filesystem only) */
  lockStale?: number;
}

export interface OpportunityStoreResult {
  storedRecords: OpportunityRecord[];
  filePath: string;
  /** Number of new records created */
  created?: number;
  /** Number of existing records updated */
  updated?: number;
}

export class OpportunityStore {
  private readonly fileName: string;
  private readonly repository: IOpportunityRepository;
  private readonly baseDir: string;

  constructor(private readonly options: OpportunityStoreOptions) {
    if (!options.baseDir) {
      throw new Error('OpportunityStore requires a baseDir option');
    }

    this.baseDir = options.baseDir;
    this.fileName = options.fileName ?? 'opportunities.json';

    // Determine repository type from options or environment
    const repoType = options.repositoryType || process.env.OPPORTUNITY_STORE_TYPE || 'filesystem';

    switch (repoType) {
      case 'postgres':
        this.repository = createOpportunityRepository({
          type: 'postgres',
          tableName: 'opportunities',
        });
        break;

      case 'memory':
        this.repository = createOpportunityRepository({
          type: 'memory',
        });
        break;

      case 'filesystem':
      default:
        this.repository = createOpportunityRepository({
          type: 'filesystem',
          baseDir: options.baseDir,
          fileName: this.fileName,
          lockTimeout: options.lockTimeout || 10000,
          lockStale: options.lockStale || 30000,
        });
        break;
    }

    logger.info('OpportunityStore initialized', {
      repositoryType: repoType,
      baseDir: options.baseDir,
    });
  }

  /**
   * Upsert opportunity records atomically.
   * Uses file locking (filesystem) or transactions (postgres) to prevent race conditions.
   */
  async upsert(records: OpportunityRecord[]): Promise<OpportunityStoreResult> {
    const result = await this.repository.upsert(records);

    if (result.errors.length > 0) {
      logger.warn('OpportunityStore upsert had errors', {
        errors: result.errors,
        successCount: result.upserted.length,
      });
    }

    const filePath = path.join(this.baseDir, 'opportunities', this.fileName);

    logger.info('OpportunityStore persisted records', {
      stored: result.upserted.length,
      created: result.created,
      updated: result.updated,
      filePath,
    });

    return {
      storedRecords: result.upserted,
      filePath,
      created: result.created,
      updated: result.updated,
    };
  }

  /**
   * Find a single opportunity by ID.
   */
  async findById(id: string): Promise<OpportunityRecord | null> {
    return this.repository.findById(id);
  }

  /**
   * Find multiple opportunities by IDs.
   */
  async findByIds(ids: string[]): Promise<OpportunityRecord[]> {
    return this.repository.findByIds(ids);
  }

  /**
   * Find opportunities matching filter criteria with pagination.
   */
  async find(
    filter?: OpportunityFilter,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<OpportunityRecord>> {
    return this.repository.findByFilter(filter, pagination);
  }

  /**
   * Get all opportunities (with optional pagination).
   */
  async getAll(pagination?: PaginationOptions): Promise<OpportunityRecord[]> {
    const result = await this.repository.findByFilter(undefined, {
      ...pagination,
      limit: pagination?.limit || 10000,
    });
    return result.data;
  }

  /**
   * Delete an opportunity by ID.
   */
  async delete(id: string): Promise<boolean> {
    return this.repository.delete(id);
  }

  /**
   * Delete multiple opportunities by IDs.
   */
  async deleteMany(ids: string[]): Promise<number> {
    return this.repository.deleteMany(ids);
  }

  /**
   * Count opportunities matching filter criteria.
   */
  async count(filter?: OpportunityFilter): Promise<number> {
    return this.repository.count(filter);
  }

  /**
   * Check if an opportunity exists by ID.
   */
  async exists(id: string): Promise<boolean> {
    return this.repository.exists(id);
  }

  /**
   * Get all unique vendor names across opportunities.
   */
  async getDistinctVendors(): Promise<string[]> {
    return this.repository.getDistinctVendors();
  }

  /**
   * Get all unique customer names across opportunities.
   */
  async getDistinctCustomers(): Promise<string[]> {
    return this.repository.getDistinctCustomers();
  }

  /**
   * Clear all opportunities (use with caution).
   */
  async clear(): Promise<void> {
    return this.repository.clear();
  }

  /**
   * Get the underlying repository instance.
   * Useful for advanced operations or testing.
   */
  getRepository(): IOpportunityRepository {
    return this.repository;
  }
}

export default OpportunityStore;
