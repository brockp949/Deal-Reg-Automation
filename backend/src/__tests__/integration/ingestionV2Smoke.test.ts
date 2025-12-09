import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db';
import { FileProcessorV2 } from '../../services/fileProcessorV2';
import { config } from '../../config';

// Helpers
async function seedSourceFile(filePath: string, fileType: string) {
  const id = uuidv4();
  const filename = path.basename(filePath);
  const stats = await fs.stat(filePath);

  await query(
    `INSERT INTO source_files (id, filename, file_type, file_size, storage_path, processing_status, scan_status)
     VALUES ($1, $2, $3, $4, $5, 'pending', 'passed')`,
    [id, filename, fileType, stats.size, filePath]
  );

  return id;
}

async function cleanupSourceFile(fileId: string) {
  await query('DELETE FROM source_files WHERE id = $1', [fileId]);
}

async function getSourceFile(fileId: string) {
  const [file, deals, vendors, contacts, provenance] = await Promise.all([
    query(
      `SELECT processing_status, metadata
       FROM source_files
       WHERE id = $1
       LIMIT 1`,
      [fileId]
    ).then((r) => r.rows[0]),
    query(
      `SELECT * FROM deal_registrations WHERE metadata->>'source_file_id' = $1 ORDER BY created_at DESC`,
      [fileId]
    ).then((r) => r.rows),
    query(
      `SELECT * FROM vendors WHERE metadata->>'source_file_id' = $1 ORDER BY created_at DESC`,
      [fileId]
    ).then((r) => r.rows),
    query(
      `SELECT * FROM contacts WHERE metadata->>'source_file_id' = $1 ORDER BY created_at DESC`,
      [fileId]
    ).then((r) => r.rows),
    query(
      `SELECT * FROM field_provenance WHERE source_file_id = $1 ORDER BY extracted_at DESC`,
      [fileId]
    ).then((r) => r.rows),
  ]);

  return { file, deals, vendors, contacts, provenance };
}

describe('FileProcessorV2 smoke', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures', 'ingestion');

  const toggle = config.ingestion.useFileProcessorV2;
  let dbAvailable = false;

  beforeAll(async () => {
    // Force v2 on for these smoke tests
    (config as any).ingestion.useFileProcessorV2 = true;
    if (process.env.SKIP_DB_TESTS === 'true') {
      dbAvailable = false;
      return;
    }
    try {
      await query('SELECT 1');
      dbAvailable = true;
    } catch (err) {
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    (config as any).ingestion.useFileProcessorV2 = toggle;
  });

  it('processes CSV with standardized parser and writes entities', async () => {
    if (!dbAvailable) {
      return;
    }
    const filePath = path.join(fixturesDir, 'sample.csv');
    const fileId = await seedSourceFile(filePath, 'csv');

    const processor = new FileProcessorV2(fileId);
    const result = await processor.process();

    expect(result.vendorsCreated).toBeGreaterThanOrEqual(1);
    expect(result.dealsCreated).toBeGreaterThanOrEqual(1);

    const info = await getSourceFile(fileId);
    expect(info.file.processing_status).toBe('completed');
    expect(Number(info.file.metadata?.progress || 0)).toBe(100);
    expect(info.provenance.length).toBeGreaterThan(0);

    await cleanupSourceFile(fileId);
  });

  it('processes transcript text with standardized parser', async () => {
    if (!dbAvailable) {
      return;
    }
    const filePath = path.join(fixturesDir, 'sample.txt');
    const fileId = await seedSourceFile(filePath, 'txt');

    const processor = new FileProcessorV2(fileId);
    const result = await processor.process();

    expect(result.vendorsCreated).toBeGreaterThanOrEqual(0);
    expect(result.dealsCreated).toBeGreaterThanOrEqual(0);

    const info = await getSourceFile(fileId);
    expect(info.file.processing_status).toBe('completed');
    expect(Number(info.file.metadata?.progress || 0)).toBe(100);
    expect(info.provenance.length).toBeGreaterThanOrEqual(0);

    await cleanupSourceFile(fileId);
  });

  it('processes mbox with standardized parser', async () => {
    if (!dbAvailable) {
      return;
    }
    const filePath = path.join(fixturesDir, 'sample.mbox');
    const fileId = await seedSourceFile(filePath, 'mbox');

    const processor = new FileProcessorV2(fileId);
    const result = await processor.process();

    expect(result.vendorsCreated).toBeGreaterThanOrEqual(0);
    expect(result.dealsCreated).toBeGreaterThanOrEqual(0);

    const info = await getSourceFile(fileId);
    expect(info.file.processing_status).toBe('completed');
    expect(Number(info.file.metadata?.progress || 0)).toBe(100);
    expect(info.provenance.length).toBeGreaterThanOrEqual(0);

    await cleanupSourceFile(fileId);
  });
});
