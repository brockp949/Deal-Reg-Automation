import { PoolClient } from 'pg';
import pool from '../db';
import logger from './logger';

/**
 * Execute a function within a database transaction
 * Automatically commits on success and rolls back on error
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    logger.debug('Transaction started');

    const result = await callback(client);

    await client.query('COMMIT');
    logger.debug('Transaction committed');

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', { error });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute a query with automatic retry on transient errors
 */
export async function queryWithRetry(
  queryText: string,
  values?: any[],
  maxRetries: number = 3
): Promise<any> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await pool.query(queryText, values);
      return result;
    } catch (error: any) {
      lastError = error;

      // Only retry on connection errors or deadlock errors
      const shouldRetry =
        error.code === '40P01' || // deadlock_detected
        error.code === '40001' || // serialization_failure
        error.code === '08000' || // connection_exception
        error.code === '08003' || // connection_does_not_exist
        error.code === '08006';   // connection_failure

      if (!shouldRetry || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      logger.warn(`Query failed, retrying in ${delay}ms`, {
        attempt,
        maxRetries,
        error: error.message,
        code: error.code,
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Batch insert with transaction support
 */
export async function batchInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  values: any[][],
  onConflict?: string
): Promise<void> {
  if (values.length === 0) return;

  const placeholders = values
    .map((row, i) =>
      `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`
    )
    .join(', ');

  const flatValues = values.flat();
  const conflictClause = onConflict ? `ON CONFLICT ${onConflict}` : '';

  const query = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES ${placeholders}
    ${conflictClause}
  `;

  await client.query(query, flatValues);
}
