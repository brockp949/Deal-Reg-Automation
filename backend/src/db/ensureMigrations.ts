import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from './index';
import logger from '../utils/logger';

async function schemaExists(): Promise<boolean> {
  try {
    // Check for a core table that should exist after base schema
    const result = await pool.query(
      "SELECT to_regclass('public.source_files') AS exists"
    );
    return !!result.rows[0]?.exists;
  } catch (error: any) {
    logger.warn('Unable to determine schema presence; will attempt migrations', { error: error.message });
    return false;
  }
}

export async function ensureMigrations() {
  const exists = await schemaExists();
  if (exists) {
    logger.info('Database schema detected; skipping migrations');
    return;
  }

  logger.warn('Database schema not found; running migrations');

  // Run base schema
  const schemaSQL = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(schemaSQL);
  logger.info('Base schema applied');

  // Run migration files in order
  const migrationsDir = join(__dirname, 'migrations');
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const migrationSQL = readFileSync(join(migrationsDir, file), 'utf-8');
    await pool.query(migrationSQL);
    logger.info(`Migration applied: ${file}`);
  }

  logger.info('All migrations applied');
}

export default ensureMigrations;
