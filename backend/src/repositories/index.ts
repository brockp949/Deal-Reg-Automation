/**
 * Repository Module
 * Provides abstraction over storage backends for OpportunityRecord persistence.
 */

// Types and interfaces
export {
  IOpportunityRepository,
  OpportunityFilter,
  PaginationOptions,
  PaginatedResult,
  UpsertResult,
  UpsertError,
  RepositoryConfig,
  FileSystemRepositoryConfig,
  PostgresRepositoryConfig,
  MemoryRepositoryConfig,
} from './IOpportunityRepository';

// Implementations
export { MemoryRepository } from './MemoryRepository';
export { FileSystemRepository } from './FileSystemRepository';
export { PostgresRepository } from './PostgresRepository';

// Factory
export {
  createOpportunityRepository,
  createRepositoryFromEnv,
  getDefaultRepository,
  setDefaultRepository,
  resetDefaultRepository,
} from './RepositoryFactory';
