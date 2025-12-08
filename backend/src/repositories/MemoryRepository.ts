/**
 * In-Memory Opportunity Repository
 * Thread-safe implementation for testing and development.
 */

import { OpportunityRecord } from '../opportunities/types';
import {
  IOpportunityRepository,
  OpportunityFilter,
  PaginationOptions,
  PaginatedResult,
  UpsertResult,
  MemoryRepositoryConfig,
} from './IOpportunityRepository';

export class MemoryRepository implements IOpportunityRepository {
  private data: Map<string, OpportunityRecord> = new Map();

  constructor(config?: MemoryRepositoryConfig) {
    if (config?.initialData) {
      for (const record of config.initialData) {
        this.data.set(record.id, { ...record });
      }
    }
  }

  async upsert(records: OpportunityRecord[]): Promise<UpsertResult> {
    const result: UpsertResult = {
      upserted: [],
      created: 0,
      updated: 0,
      errors: [],
    };

    const now = new Date().toISOString();

    for (const record of records) {
      try {
        const existing = this.data.get(record.id);
        const updatedRecord: OpportunityRecord = {
          ...record,
          createdAt: existing?.createdAt || record.createdAt || now,
          updatedAt: now,
        };

        this.data.set(record.id, updatedRecord);
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

    return result;
  }

  async findById(id: string): Promise<OpportunityRecord | null> {
    const record = this.data.get(id);
    return record ? { ...record } : null;
  }

  async findByIds(ids: string[]): Promise<OpportunityRecord[]> {
    const results: OpportunityRecord[] = [];
    for (const id of ids) {
      const record = this.data.get(id);
      if (record) {
        results.push({ ...record });
      }
    }
    return results;
  }

  async findByFilter(
    filter?: OpportunityFilter,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<OpportunityRecord>> {
    let records = Array.from(this.data.values());

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
      data: paginatedRecords.map((r) => ({ ...r })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async delete(id: string): Promise<boolean> {
    return this.data.delete(id);
  }

  async deleteMany(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (this.data.delete(id)) {
        deleted++;
      }
    }
    return deleted;
  }

  async count(filter?: OpportunityFilter): Promise<number> {
    if (!filter) {
      return this.data.size;
    }

    let count = 0;
    for (const record of this.data.values()) {
      if (this.matchesFilter(record, filter)) {
        count++;
      }
    }
    return count;
  }

  async exists(id: string): Promise<boolean> {
    return this.data.has(id);
  }

  async getDistinctVendors(): Promise<string[]> {
    const vendors = new Set<string>();
    for (const record of this.data.values()) {
      if (record.metadata?.vendor) {
        vendors.add(record.metadata.vendor);
      }
    }
    return Array.from(vendors).sort();
  }

  async getDistinctCustomers(): Promise<string[]> {
    const customers = new Set<string>();
    for (const record of this.data.values()) {
      if (record.metadata?.customer) {
        customers.add(record.metadata.customer);
      }
    }
    return Array.from(customers).sort();
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async close(): Promise<void> {
    // No-op for memory repository
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

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
