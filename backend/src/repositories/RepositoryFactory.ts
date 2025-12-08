/**
 * Repository Factory
 * Creates the appropriate repository implementation based on configuration.
 */

import { IOpportunityRepository, RepositoryConfig } from './IOpportunityRepository';
import { MemoryRepository } from './MemoryRepository';
import { FileSystemRepository } from './FileSystemRepository';
import { PostgresRepository } from './PostgresRepository';
import logger from '../utils/logger';

/**
 * Create an opportunity repository based on configuration.
 *
 * @example
 * // File system repository (default)
 * const repo = createOpportunityRepository({
 *   type: 'filesystem',
 *   baseDir: './data',
 * });
 *
 * @example
 * // PostgreSQL repository
 * const repo = createOpportunityRepository({
 *   type: 'postgres',
 *   tableName: 'opportunities',
 * });
 *
 * @example
 * // Memory repository (for testing)
 * const repo = createOpportunityRepository({
 *   type: 'memory',
 *   initialData: [],
 * });
 */
export function createOpportunityRepository(config: RepositoryConfig): IOpportunityRepository {
  logger.info('Creating opportunity repository', { type: config.type });

  switch (config.type) {
    case 'filesystem':
      return new FileSystemRepository(config);

    case 'postgres':
      return new PostgresRepository(config);

    case 'memory':
      return new MemoryRepository(config);

    default:
      throw new Error(`Unknown repository type: ${(config as RepositoryConfig).type}`);
  }
}

/**
 * Create a repository from environment configuration.
 * Uses OPPORTUNITY_STORE_TYPE environment variable.
 *
 * Defaults:
 * - filesystem: Uses UPLOAD_DIR or './uploads' as base directory
 * - postgres: Uses default 'opportunities' table
 * - memory: Empty initial data
 */
export function createRepositoryFromEnv(): IOpportunityRepository {
  const storeType = process.env.OPPORTUNITY_STORE_TYPE || 'filesystem';

  switch (storeType) {
    case 'postgres':
      return createOpportunityRepository({
        type: 'postgres',
        tableName: process.env.OPPORTUNITY_TABLE_NAME || 'opportunities',
      });

    case 'memory':
      return createOpportunityRepository({
        type: 'memory',
      });

    case 'filesystem':
    default:
      return createOpportunityRepository({
        type: 'filesystem',
        baseDir: process.env.UPLOAD_DIR || './uploads',
        fileName: 'opportunities.json',
        lockTimeout: parseInt(process.env.LOCK_TIMEOUT || '10000', 10),
        lockStale: parseInt(process.env.LOCK_STALE || '30000', 10),
      });
  }
}

// Singleton instance for application-wide use
let defaultRepository: IOpportunityRepository | null = null;

/**
 * Get the default repository instance.
 * Creates one if it doesn't exist.
 */
export function getDefaultRepository(): IOpportunityRepository {
  if (!defaultRepository) {
    defaultRepository = createRepositoryFromEnv();
  }
  return defaultRepository;
}

/**
 * Set the default repository instance.
 * Useful for testing or custom configuration.
 */
export function setDefaultRepository(repository: IOpportunityRepository): void {
  defaultRepository = repository;
}

/**
 * Reset the default repository (primarily for testing).
 */
export function resetDefaultRepository(): void {
  defaultRepository = null;
}
