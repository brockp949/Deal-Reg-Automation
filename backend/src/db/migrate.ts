import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from './index';
import logger from '../utils/logger';

async function runMigrations() {
  console.log('Starting idiosyncratic database migration runner...');

  try {
    // 1. Ensure migrations_log table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations_log (
        id SERIAL PRIMARY KEY,
        file_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Check if base schema has been applied (we can use a special file name for it)
    const baseSchemaApplied = await pool.query(
      'SELECT 1 FROM migrations_log WHERE file_name = $1',
      ['base_schema.sql']
    );

    if (baseSchemaApplied.rows.length === 0) {
      console.log('Applying base schema...');
      const schemaSQL = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
      await pool.query(schemaSQL);
      await pool.query('INSERT INTO migrations_log (file_name) VALUES ($1)', ['base_schema.sql']);
      console.log('✓ Base schema applied');
    } else {
      console.log('✓ Base schema already applied, skipping');
    }

    // 3. Get list of already applied migrations
    const appliedResult = await pool.query('SELECT file_name FROM migrations_log');
    const appliedFiles = new Set(appliedResult.rows.map(row => row.file_name));

    // 4. Run pending migration files in order
    const migrationsDir = join(__dirname, 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      if (appliedFiles.has(file)) {
        console.log(`- Migration ${file} already applied, skipping`);
        continue;
      }

      console.log(`Running migration: ${file}...`);
      const migrationSQL = readFileSync(join(migrationsDir, file), 'utf-8');

      // Use a transaction for each migration to ensure atomic success/failure
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migrationSQL);
        await client.query('INSERT INTO migrations_log (file_name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✓ ${file} completed`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    console.log('✓ All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', (error as any).message, (error as any).stack, JSON.stringify(error, null, 2));
    logger.error('Migration execution failed', { error });
    process.exit(1);
  }
}

runMigrations();
