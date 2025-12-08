/**
 * Opportunity Repository Interface
 * Provides abstraction over storage backends for OpportunityRecord persistence.
 *
 * Implementations:
 * - FileSystemRepository: JSON file with proper locking
 * - PostgresRepository: Database-backed with transactions
 * - MemoryRepository: In-memory for testing
 */

import { OpportunityRecord, OpportunityStage, OpportunityPriority } from '../opportunities/types';

// ============================================================================
// Filter and Pagination Types
// ============================================================================

export interface OpportunityFilter {
  /** Filter by vendor name (partial match) */
  vendor?: string;
  /** Filter by customer name (partial match) */
  customer?: string;
  /** Filter by opportunity stage */
  stage?: OpportunityStage;
  /** Filter by priority */
  priority?: OpportunityPriority;
  /** Filter by minimum confidence score */
  minConfidence?: number;
  /** Filter by source file ID */
  sourceFileId?: string;
  /** Filter by creation date (after) */
  createdAfter?: Date;
  /** Filter by creation date (before) */
  createdBefore?: Date;
  /** Filter by last updated date (after) */
  updatedAfter?: Date;
  /** Search across name, actors, next steps */
  searchText?: string;
}

export interface PaginationOptions {
  /** Number of records to return (default: 50, max: 1000) */
  limit?: number;
  /** Number of records to skip */
  offset?: number;
  /** Field to sort by */
  sortBy?: keyof OpportunityRecord | 'createdAt' | 'updatedAt';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ============================================================================
// Upsert Types
// ============================================================================

export interface UpsertResult {
  /** Records that were successfully upserted */
  upserted: OpportunityRecord[];
  /** Number of new records created */
  created: number;
  /** Number of existing records updated */
  updated: number;
  /** Any errors that occurred */
  errors: UpsertError[];
}

export interface UpsertError {
  recordId: string;
  message: string;
  code: string;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface IOpportunityRepository {
  /**
   * Insert or update multiple opportunity records atomically.
   * Uses record ID to determine if insert or update.
   */
  upsert(records: OpportunityRecord[]): Promise<UpsertResult>;

  /**
   * Find a single opportunity by ID.
   * Returns null if not found.
   */
  findById(id: string): Promise<OpportunityRecord | null>;

  /**
   * Find multiple opportunities by IDs.
   * Returns only found records (missing IDs are omitted).
   */
  findByIds(ids: string[]): Promise<OpportunityRecord[]>;

  /**
   * Find opportunities matching filter criteria with pagination.
   */
  findByFilter(
    filter?: OpportunityFilter,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<OpportunityRecord>>;

  /**
   * Delete an opportunity by ID.
   * Returns true if deleted, false if not found.
   */
  delete(id: string): Promise<boolean>;

  /**
   * Delete multiple opportunities by IDs.
   * Returns count of deleted records.
   */
  deleteMany(ids: string[]): Promise<number>;

  /**
   * Count opportunities matching filter criteria.
   */
  count(filter?: OpportunityFilter): Promise<number>;

  /**
   * Check if an opportunity exists by ID.
   */
  exists(id: string): Promise<boolean>;

  /**
   * Get all unique vendors across opportunities.
   */
  getDistinctVendors(): Promise<string[]>;

  /**
   * Get all unique customers across opportunities.
   */
  getDistinctCustomers(): Promise<string[]>;

  /**
   * Clear all data (use with caution - primarily for testing).
   */
  clear(): Promise<void>;

  /**
   * Close any open connections/resources.
   */
  close(): Promise<void>;
}

// ============================================================================
// Repository Configuration
// ============================================================================

export interface FileSystemRepositoryConfig {
  type: 'filesystem';
  baseDir: string;
  fileName?: string;
  /** Lock timeout in milliseconds (default: 10000) */
  lockTimeout?: number;
  /** Lock stale threshold in milliseconds (default: 30000) */
  lockStale?: number;
}

export interface PostgresRepositoryConfig {
  type: 'postgres';
  /** Connection string or use existing pool */
  connectionString?: string;
  /** Table name for storing opportunities (default: 'opportunities') */
  tableName?: string;
}

export interface MemoryRepositoryConfig {
  type: 'memory';
  /** Initial data to populate */
  initialData?: OpportunityRecord[];
}

export type RepositoryConfig =
  | FileSystemRepositoryConfig
  | PostgresRepositoryConfig
  | MemoryRepositoryConfig;
