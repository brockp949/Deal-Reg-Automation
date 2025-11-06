import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from './index';

async function runMigrations() {
  console.log('Running database migrations...');

  try {
    // First, run the base schema
    console.log('Running base schema...');
    const schemaSQL = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schemaSQL);
    console.log('✓ Base schema applied');

    // Then run all migration files in order
    const migrationsDir = join(__dirname, 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort(); // Sort to ensure correct order (001, 002, 003, etc.)

    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}...`);
      const migrationSQL = readFileSync(join(migrationsDir, file), 'utf-8');
      await pool.query(migrationSQL);
      console.log(`✓ ${file} completed`);
    }

    console.log('✓ All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
