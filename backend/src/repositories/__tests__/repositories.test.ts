/**
 * Repository Tests
 * Tests all three repository implementations for consistent behavior.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { OpportunityRecord } from '../../opportunities/types';
import { MemoryRepository } from '../MemoryRepository';
import { FileSystemRepository } from '../FileSystemRepository';
import {
  IOpportunityRepository,
  createOpportunityRepository,
  OpportunityFilter,
} from '../index';

// ============================================================================
// Test Data Factory
// ============================================================================

function createTestRecord(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  const id = overrides.id || `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    name: `Test Opportunity ${id}`,
    stage: 'rfq',
    priority: 'medium',
    costUpsideNotes: ['Note 1'],
    actors: ['Actor 1', 'Actor 2'],
    nextSteps: ['Next step 1'],
    sourceTags: ['tag1', 'tag2'],
    sourceSummary: [],
    metadata: {
      vendor: 'Test Vendor',
      customer: 'Test Customer',
      parser: 'test',
      confidence: 0.85,
    },
    ...overrides,
  };
}

// ============================================================================
// Shared Test Suite for All Repository Implementations
// ============================================================================

function runRepositoryTests(
  name: string,
  createRepository: () => Promise<{ repo: IOpportunityRepository; cleanup: () => Promise<void> }>
) {
  describe(`${name}`, () => {
    let repo: IOpportunityRepository;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const setup = await createRepository();
      repo = setup.repo;
      cleanup = setup.cleanup;
    });

    afterEach(async () => {
      await cleanup();
    });

    describe('upsert', () => {
      it('should insert new records', async () => {
        const record = createTestRecord({ id: 'insert-test-1' });
        const result = await repo.upsert([record]);

        expect(result.created).toBe(1);
        expect(result.updated).toBe(0);
        expect(result.upserted).toHaveLength(1);
        expect(result.upserted[0].id).toBe('insert-test-1');
        expect(result.errors).toHaveLength(0);
      });

      it('should update existing records', async () => {
        const record = createTestRecord({ id: 'update-test-1' });
        await repo.upsert([record]);

        const updatedRecord = { ...record, name: 'Updated Name' };
        const result = await repo.upsert([updatedRecord]);

        expect(result.created).toBe(0);
        expect(result.updated).toBe(1);
        expect(result.upserted[0].name).toBe('Updated Name');
      });

      it('should handle multiple records', async () => {
        const records = [
          createTestRecord({ id: 'multi-1' }),
          createTestRecord({ id: 'multi-2' }),
          createTestRecord({ id: 'multi-3' }),
        ];

        const result = await repo.upsert(records);

        expect(result.created).toBe(3);
        expect(result.updated).toBe(0);
        expect(result.upserted).toHaveLength(3);
      });

      it('should set createdAt and updatedAt', async () => {
        const record = createTestRecord({ id: 'timestamp-test' });
        const result = await repo.upsert([record]);

        const upserted = result.upserted[0];
        expect(upserted.createdAt).toBeDefined();
        expect(upserted.updatedAt).toBeDefined();
      });

      it('should preserve createdAt on update', async () => {
        const record = createTestRecord({ id: 'preserve-created' });
        const firstResult = await repo.upsert([record]);
        const originalCreatedAt = firstResult.upserted[0].createdAt;

        // Wait a bit to ensure different timestamp
        await new Promise((resolve) => setTimeout(resolve, 10));

        const updatedRecord = { ...record, name: 'Updated' };
        const secondResult = await repo.upsert([updatedRecord]);

        expect(secondResult.upserted[0].createdAt).toBe(originalCreatedAt);
        expect(secondResult.upserted[0].updatedAt).not.toBe(originalCreatedAt);
      });

      it('should handle empty array', async () => {
        const result = await repo.upsert([]);

        expect(result.created).toBe(0);
        expect(result.updated).toBe(0);
        expect(result.upserted).toHaveLength(0);
      });
    });

    describe('findById', () => {
      it('should find existing record', async () => {
        const record = createTestRecord({ id: 'find-by-id-1' });
        await repo.upsert([record]);

        const found = await repo.findById('find-by-id-1');

        expect(found).not.toBeNull();
        expect(found!.id).toBe('find-by-id-1');
        expect(found!.name).toBe(record.name);
      });

      it('should return null for non-existent record', async () => {
        const found = await repo.findById('non-existent');

        expect(found).toBeNull();
      });
    });

    describe('findByIds', () => {
      it('should find multiple records', async () => {
        const records = [
          createTestRecord({ id: 'ids-1' }),
          createTestRecord({ id: 'ids-2' }),
          createTestRecord({ id: 'ids-3' }),
        ];
        await repo.upsert(records);

        const found = await repo.findByIds(['ids-1', 'ids-3']);

        expect(found).toHaveLength(2);
        expect(found.map((r) => r.id).sort()).toEqual(['ids-1', 'ids-3']);
      });

      it('should return empty array for non-existent IDs', async () => {
        const found = await repo.findByIds(['non-1', 'non-2']);

        expect(found).toHaveLength(0);
      });

      it('should skip non-existent IDs', async () => {
        const record = createTestRecord({ id: 'exists' });
        await repo.upsert([record]);

        const found = await repo.findByIds(['exists', 'not-exists']);

        expect(found).toHaveLength(1);
        expect(found[0].id).toBe('exists');
      });
    });

    describe('findByFilter', () => {
      beforeEach(async () => {
        const records = [
          createTestRecord({
            id: 'filter-1',
            stage: 'rfq',
            priority: 'high',
            metadata: { vendor: 'Vendor A', customer: 'Customer 1', parser: 'test', confidence: 0.9 },
          }),
          createTestRecord({
            id: 'filter-2',
            stage: 'quote',
            priority: 'medium',
            metadata: { vendor: 'Vendor B', customer: 'Customer 2', parser: 'test', confidence: 0.7 },
          }),
          createTestRecord({
            id: 'filter-3',
            stage: 'rfq',
            priority: 'low',
            metadata: { vendor: 'Vendor A', customer: 'Customer 3', parser: 'test', confidence: 0.5 },
          }),
        ];
        await repo.upsert(records);
      });

      it('should filter by stage', async () => {
        const result = await repo.findByFilter({ stage: 'rfq' });

        expect(result.data).toHaveLength(2);
        expect(result.data.every((r) => r.stage === 'rfq')).toBe(true);
      });

      it('should filter by priority', async () => {
        const result = await repo.findByFilter({ priority: 'high' });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].priority).toBe('high');
      });

      it('should filter by vendor (partial match)', async () => {
        const result = await repo.findByFilter({ vendor: 'Vendor A' });

        expect(result.data).toHaveLength(2);
      });

      it('should filter by minimum confidence', async () => {
        const result = await repo.findByFilter({ minConfidence: 0.8 });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].metadata.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it('should apply pagination', async () => {
        const result = await repo.findByFilter(undefined, { limit: 2, offset: 0 });

        expect(result.data).toHaveLength(2);
        expect(result.total).toBe(3);
        expect(result.hasMore).toBe(true);
      });

      it('should sort results', async () => {
        const result = await repo.findByFilter(undefined, {
          sortBy: 'priority',
          sortOrder: 'asc',
        });

        expect(result.data).toHaveLength(3);
      });

      it('should return pagination metadata', async () => {
        const result = await repo.findByFilter(undefined, { limit: 10, offset: 0 });

        expect(result.total).toBe(3);
        expect(result.limit).toBe(10);
        expect(result.offset).toBe(0);
        expect(result.hasMore).toBe(false);
      });
    });

    describe('delete', () => {
      it('should delete existing record', async () => {
        const record = createTestRecord({ id: 'delete-1' });
        await repo.upsert([record]);

        const deleted = await repo.delete('delete-1');

        expect(deleted).toBe(true);
        expect(await repo.findById('delete-1')).toBeNull();
      });

      it('should return false for non-existent record', async () => {
        const deleted = await repo.delete('non-existent');

        expect(deleted).toBe(false);
      });
    });

    describe('deleteMany', () => {
      it('should delete multiple records', async () => {
        const records = [
          createTestRecord({ id: 'del-many-1' }),
          createTestRecord({ id: 'del-many-2' }),
          createTestRecord({ id: 'del-many-3' }),
        ];
        await repo.upsert(records);

        const deleted = await repo.deleteMany(['del-many-1', 'del-many-3']);

        expect(deleted).toBe(2);
        expect(await repo.count()).toBe(1);
      });

      it('should return 0 for non-existent IDs', async () => {
        const deleted = await repo.deleteMany(['non-1', 'non-2']);

        expect(deleted).toBe(0);
      });
    });

    describe('count', () => {
      it('should count all records', async () => {
        const records = [
          createTestRecord({ id: 'count-1' }),
          createTestRecord({ id: 'count-2' }),
        ];
        await repo.upsert(records);

        const count = await repo.count();

        expect(count).toBe(2);
      });

      it('should count filtered records', async () => {
        const records = [
          createTestRecord({ id: 'count-filter-1', stage: 'rfq' }),
          createTestRecord({ id: 'count-filter-2', stage: 'quote' }),
          createTestRecord({ id: 'count-filter-3', stage: 'rfq' }),
        ];
        await repo.upsert(records);

        const count = await repo.count({ stage: 'rfq' });

        expect(count).toBe(2);
      });
    });

    describe('exists', () => {
      it('should return true for existing record', async () => {
        const record = createTestRecord({ id: 'exists-1' });
        await repo.upsert([record]);

        expect(await repo.exists('exists-1')).toBe(true);
      });

      it('should return false for non-existent record', async () => {
        expect(await repo.exists('non-existent')).toBe(false);
      });
    });

    describe('getDistinctVendors', () => {
      it('should return unique vendors', async () => {
        const records = [
          createTestRecord({ id: 'vendor-1', metadata: { vendor: 'Vendor A', parser: 'test' } }),
          createTestRecord({ id: 'vendor-2', metadata: { vendor: 'Vendor B', parser: 'test' } }),
          createTestRecord({ id: 'vendor-3', metadata: { vendor: 'Vendor A', parser: 'test' } }),
        ];
        await repo.upsert(records);

        const vendors = await repo.getDistinctVendors();

        expect(vendors.sort()).toEqual(['Vendor A', 'Vendor B']);
      });
    });

    describe('getDistinctCustomers', () => {
      it('should return unique customers', async () => {
        const records = [
          createTestRecord({ id: 'cust-1', metadata: { customer: 'Customer X', parser: 'test' } }),
          createTestRecord({ id: 'cust-2', metadata: { customer: 'Customer Y', parser: 'test' } }),
          createTestRecord({ id: 'cust-3', metadata: { customer: 'Customer X', parser: 'test' } }),
        ];
        await repo.upsert(records);

        const customers = await repo.getDistinctCustomers();

        expect(customers.sort()).toEqual(['Customer X', 'Customer Y']);
      });
    });

    describe('clear', () => {
      it('should remove all records', async () => {
        const records = [
          createTestRecord({ id: 'clear-1' }),
          createTestRecord({ id: 'clear-2' }),
        ];
        await repo.upsert(records);

        await repo.clear();

        expect(await repo.count()).toBe(0);
      });
    });
  });
}

// ============================================================================
// Repository-Specific Tests
// ============================================================================

describe('Opportunity Repositories', () => {
  // Memory Repository
  runRepositoryTests('MemoryRepository', async () => {
    const repo = new MemoryRepository();
    return {
      repo,
      cleanup: async () => {
        await repo.clear();
      },
    };
  });

  // File System Repository
  runRepositoryTests('FileSystemRepository', async () => {
    const tempDir = path.join(os.tmpdir(), `repo-test-${Date.now()}`);
    const repo = createOpportunityRepository({
      type: 'filesystem',
      baseDir: tempDir,
      fileName: 'test-opportunities.json',
      lockTimeout: 5000,
      lockStale: 10000,
    });

    return {
      repo,
      cleanup: async () => {
        await repo.close();
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  });

  // File System Repository - Specific Tests
  describe('FileSystemRepository - Locking', () => {
    let tempDir: string;
    let repo1: IOpportunityRepository;
    let repo2: IOpportunityRepository;

    beforeEach(async () => {
      tempDir = path.join(os.tmpdir(), `lock-test-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      repo1 = createOpportunityRepository({
        type: 'filesystem',
        baseDir: tempDir,
        fileName: 'shared.json',
        lockTimeout: 2000,
      });

      repo2 = createOpportunityRepository({
        type: 'filesystem',
        baseDir: tempDir,
        fileName: 'shared.json',
        lockTimeout: 2000,
      });
    });

    afterEach(async () => {
      await repo1.close();
      await repo2.close();
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    it('should handle concurrent writes without data loss', async () => {
      // Create initial records
      const initialRecords = Array.from({ length: 5 }, (_, i) =>
        createTestRecord({ id: `initial-${i}` })
      );
      await repo1.upsert(initialRecords);

      // Concurrent writes from both repositories
      const records1 = Array.from({ length: 3 }, (_, i) =>
        createTestRecord({ id: `repo1-${i}` })
      );
      const records2 = Array.from({ length: 3 }, (_, i) =>
        createTestRecord({ id: `repo2-${i}` })
      );

      await Promise.all([repo1.upsert(records1), repo2.upsert(records2)]);

      // Verify all records exist
      const count = await repo1.count();
      expect(count).toBe(11); // 5 initial + 3 from repo1 + 3 from repo2
    });
  });

  // Factory Tests
  describe('createOpportunityRepository', () => {
    it('should create memory repository', () => {
      const repo = createOpportunityRepository({ type: 'memory' });
      expect(repo).toBeInstanceOf(MemoryRepository);
    });

    it('should create filesystem repository', () => {
      const repo = createOpportunityRepository({
        type: 'filesystem',
        baseDir: os.tmpdir(),
      });
      expect(repo).toBeInstanceOf(FileSystemRepository);
    });

    it('should throw for unknown type', () => {
      expect(() =>
        createOpportunityRepository({ type: 'unknown' as any, baseDir: '' })
      ).toThrow();
    });
  });
});
