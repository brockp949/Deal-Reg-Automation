/**
 * PostgreSQL Opportunity Repository
 * Provides database-backed persistence with:
 * - ACID transactions for atomic operations
 * - Proper indexing for efficient queries
 * - JSONB storage for flexible metadata
 */

import { Pool, PoolClient } from 'pg';
import { OpportunityRecord, OpportunityStage, OpportunityPriority } from '../opportunities/types';
import {
  IOpportunityRepository,
  OpportunityFilter,
  PaginationOptions,
  PaginatedResult,
  UpsertResult,
  PostgresRepositoryConfig,
} from './IOpportunityRepository';
import pool, { query, getClient } from '../db';
import logger from '../utils/logger';

// ============================================================================
// PostgreSQL Repository Implementation
// ============================================================================

export class PostgresRepository implements IOpportunityRepository {
  private readonly tableName: string;
  private readonly pool: Pool;

  constructor(config: PostgresRepositoryConfig) {
    this.tableName = config.tableName || 'opportunities';
    this.pool = pool;
  }

  /**
   * Ensure the opportunities table exists.
   * Call this during app initialization.
   */
  async ensureTable(): Promise<void> {
    await query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(500) NOT NULL,
        stage VARCHAR(50) NOT NULL,
        priority VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        yearly_unit_range VARCHAR(100),
        price_band VARCHAR(100),
        cost_upside_notes TEXT[] DEFAULT '{}',
        actors TEXT[] DEFAULT '{}',
        next_steps TEXT[] DEFAULT '{}',
        structured_next_steps JSONB DEFAULT '[]',
        source_tags TEXT[] DEFAULT '{}',
        source_summary JSONB DEFAULT '[]',
        metadata JSONB DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_stage ON ${this.tableName}(stage);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_priority ON ${this.tableName}(priority);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at ON ${this.tableName}(created_at);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_updated_at ON ${this.tableName}(updated_at);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_vendor ON ${this.tableName}((metadata->>'vendor'));
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_customer ON ${this.tableName}((metadata->>'customer'));
    `);

    logger.info('PostgresRepository: ensured table exists', { tableName: this.tableName });
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

    const client = await getClient();

    try {
      await client.query('BEGIN');

      const now = new Date().toISOString();

      for (const record of records) {
        try {
          // Check if record exists
          const existingResult = await client.query(
            `SELECT id, created_at FROM ${this.tableName} WHERE id = $1`,
            [record.id]
          );
          const existing = existingResult.rows[0];

          const updatedRecord: OpportunityRecord = {
            ...record,
            createdAt: existing?.created_at?.toISOString() || record.createdAt || now,
            updatedAt: now,
          };

          if (existing) {
            // Update
            await client.query(
              `UPDATE ${this.tableName} SET
                name = $1,
                stage = $2,
                priority = $3,
                updated_at = $4,
                yearly_unit_range = $5,
                price_band = $6,
                cost_upside_notes = $7,
                actors = $8,
                next_steps = $9,
                structured_next_steps = $10,
                source_tags = $11,
                source_summary = $12,
                metadata = $13
              WHERE id = $14`,
              [
                updatedRecord.name,
                updatedRecord.stage,
                updatedRecord.priority,
                updatedRecord.updatedAt,
                updatedRecord.yearlyUnitRange || null,
                updatedRecord.priceBand || null,
                updatedRecord.costUpsideNotes || [],
                updatedRecord.actors || [],
                updatedRecord.nextSteps || [],
                JSON.stringify(updatedRecord.structuredNextSteps || []),
                updatedRecord.sourceTags || [],
                JSON.stringify(updatedRecord.sourceSummary || []),
                JSON.stringify(updatedRecord.metadata),
                updatedRecord.id,
              ]
            );
            result.updated++;
          } else {
            // Insert
            await client.query(
              `INSERT INTO ${this.tableName} (
                id, name, stage, priority, created_at, updated_at,
                yearly_unit_range, price_band, cost_upside_notes, actors,
                next_steps, structured_next_steps, source_tags, source_summary, metadata
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
              [
                updatedRecord.id,
                updatedRecord.name,
                updatedRecord.stage,
                updatedRecord.priority,
                updatedRecord.createdAt,
                updatedRecord.updatedAt,
                updatedRecord.yearlyUnitRange || null,
                updatedRecord.priceBand || null,
                updatedRecord.costUpsideNotes || [],
                updatedRecord.actors || [],
                updatedRecord.nextSteps || [],
                JSON.stringify(updatedRecord.structuredNextSteps || []),
                updatedRecord.sourceTags || [],
                JSON.stringify(updatedRecord.sourceSummary || []),
                JSON.stringify(updatedRecord.metadata),
              ]
            );
            result.created++;
          }

          result.upserted.push(updatedRecord);
        } catch (error: unknown) {
          result.errors.push({
            recordId: record.id,
            message: error instanceof Error ? error.message : 'Unknown error',
            code: 'UPSERT_FAILED',
          });
        }
      }

      await client.query('COMMIT');

      logger.info('PostgresRepository upserted records', {
        created: result.created,
        updated: result.updated,
        errors: result.errors.length,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return result;
  }

  async findById(id: string): Promise<OpportunityRecord | null> {
    const result = await query(
      `SELECT * FROM ${this.tableName} WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? this.rowToRecord(result.rows[0]) : null;
  }

  async findByIds(ids: string[]): Promise<OpportunityRecord[]> {
    if (ids.length === 0) return [];

    const result = await query(
      `SELECT * FROM ${this.tableName} WHERE id = ANY($1)`,
      [ids]
    );
    return result.rows.map((row) => this.rowToRecord(row));
  }

  async findByFilter(
    filter?: OpportunityFilter,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<OpportunityRecord>> {
    const { whereClause, params } = this.buildWhereClause(filter);

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM ${this.tableName} ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Apply sorting
    const sortBy = this.mapSortField(pagination?.sortBy || 'createdAt');
    const sortOrder = pagination?.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Apply pagination
    const limit = Math.min(pagination?.limit || 50, 1000);
    const offset = pagination?.offset || 0;

    const result = await query(
      `SELECT * FROM ${this.tableName}
       ${whereClause}
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return {
      data: result.rows.map((row) => this.rowToRecord(row)),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM ${this.tableName} WHERE id = $1`,
      [id]
    );
    return (result.rowCount || 0) > 0;
  }

  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await query(
      `DELETE FROM ${this.tableName} WHERE id = ANY($1)`,
      [ids]
    );
    return result.rowCount || 0;
  }

  async count(filter?: OpportunityFilter): Promise<number> {
    const { whereClause, params } = this.buildWhereClause(filter);
    const result = await query(
      `SELECT COUNT(*) FROM ${this.tableName} ${whereClause}`,
      params
    );
    return parseInt(result.rows[0].count, 10);
  }

  async exists(id: string): Promise<boolean> {
    const result = await query(
      `SELECT 1 FROM ${this.tableName} WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows.length > 0;
  }

  async getDistinctVendors(): Promise<string[]> {
    const result = await query(
      `SELECT DISTINCT metadata->>'vendor' as vendor
       FROM ${this.tableName}
       WHERE metadata->>'vendor' IS NOT NULL
       ORDER BY vendor`
    );
    return result.rows.map((row) => row.vendor);
  }

  async getDistinctCustomers(): Promise<string[]> {
    const result = await query(
      `SELECT DISTINCT metadata->>'customer' as customer
       FROM ${this.tableName}
       WHERE metadata->>'customer' IS NOT NULL
       ORDER BY customer`
    );
    return result.rows.map((row) => row.customer);
  }

  async clear(): Promise<void> {
    await query(`DELETE FROM ${this.tableName}`);
  }

  async close(): Promise<void> {
    // Pool is managed globally, don't close it here
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private rowToRecord(row: Record<string, unknown>): OpportunityRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      stage: row.stage as OpportunityStage,
      priority: row.priority as OpportunityPriority,
      createdAt: row.created_at ? (row.created_at as Date).toISOString() : undefined,
      updatedAt: row.updated_at ? (row.updated_at as Date).toISOString() : undefined,
      yearlyUnitRange: row.yearly_unit_range as string | undefined,
      priceBand: row.price_band as string | undefined,
      costUpsideNotes: (row.cost_upside_notes as string[]) || [],
      actors: (row.actors as string[]) || [],
      nextSteps: (row.next_steps as string[]) || [],
      structuredNextSteps: row.structured_next_steps as OpportunityRecord['structuredNextSteps'],
      sourceTags: (row.source_tags as string[]) || [],
      sourceSummary: row.source_summary as OpportunityRecord['sourceSummary'],
      metadata: row.metadata as OpportunityRecord['metadata'],
    };
  }

  private buildWhereClause(filter?: OpportunityFilter): {
    whereClause: string;
    params: (string | number | Date)[];
  } {
    if (!filter) {
      return { whereClause: '', params: [] };
    }

    const conditions: string[] = [];
    const params: (string | number | Date)[] = [];
    let paramIndex = 1;

    if (filter.vendor) {
      conditions.push(`metadata->>'vendor' ILIKE $${paramIndex}`);
      params.push(`%${filter.vendor}%`);
      paramIndex++;
    }

    if (filter.customer) {
      conditions.push(`metadata->>'customer' ILIKE $${paramIndex}`);
      params.push(`%${filter.customer}%`);
      paramIndex++;
    }

    if (filter.stage) {
      conditions.push(`stage = $${paramIndex}`);
      params.push(filter.stage);
      paramIndex++;
    }

    if (filter.priority) {
      conditions.push(`priority = $${paramIndex}`);
      params.push(filter.priority);
      paramIndex++;
    }

    if (filter.minConfidence !== undefined) {
      conditions.push(`(metadata->>'confidence')::decimal >= $${paramIndex}`);
      params.push(filter.minConfidence);
      paramIndex++;
    }

    if (filter.createdAfter) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(filter.createdAfter);
      paramIndex++;
    }

    if (filter.createdBefore) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(filter.createdBefore);
      paramIndex++;
    }

    if (filter.updatedAfter) {
      conditions.push(`updated_at >= $${paramIndex}`);
      params.push(filter.updatedAfter);
      paramIndex++;
    }

    if (filter.searchText) {
      conditions.push(`(
        name ILIKE $${paramIndex} OR
        metadata->>'vendor' ILIKE $${paramIndex} OR
        metadata->>'customer' ILIKE $${paramIndex} OR
        array_to_string(actors, ' ') ILIKE $${paramIndex} OR
        array_to_string(next_steps, ' ') ILIKE $${paramIndex}
      )`);
      params.push(`%${filter.searchText}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return { whereClause, params };
  }

  private mapSortField(field: string): string {
    const fieldMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      name: 'name',
      stage: 'stage',
      priority: 'priority',
    };
    return fieldMap[field] || 'created_at';
  }
}
