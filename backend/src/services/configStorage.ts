import { mkdir, readFile, rename } from 'fs/promises';
import { join, extname } from 'path';
import { config } from '../config';
import logger from '../utils/logger';
import { query } from '../db';

interface StoreConfigParams {
  sourceFileId: string;
  tempPath: string;
  originalFilename: string;
  checksum: string;
  operatorId: string;
  intent?: string;
  configName?: string;
}

export interface StoredConfigSummary {
  snapshotId: string;
  configName: string;
  storedPath: string;
  keyCount: number;
  topLevelKeys: string[];
  storedAt: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'config';
}

export async function storeConfigFile(params: StoreConfigParams): Promise<StoredConfigSummary> {
  const { sourceFileId, tempPath, originalFilename, checksum, operatorId, intent, configName } = params;

  const raw = await readFile(tempPath, 'utf-8');

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (error: any) {
    logger.error('Invalid JSON config upload', { error: error.message });
    throw new Error('Uploaded configuration file is not valid JSON');
  }

  const baseName = configName || slugify(originalFilename.replace(extname(originalFilename), ''));
  const timestamp = new Date();
  const destDir = join(config.configStorage.directory, baseName);
  await mkdir(destDir, { recursive: true });

  const filename = `${baseName}-${timestamp.toISOString().replace(/[:.]/g, '-')}-${checksum.slice(0, 8)}.json`;
  const destination = join(destDir, filename);

  await rename(tempPath, destination);

  const topLevelKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 15) : [];
  const keyCount = parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0;

  const metadata = {
    keyCount,
    topLevelKeys,
    intent,
  };

  const snapshot = await query(
    `INSERT INTO config_snapshots (source_file_id, config_name, checksum_sha256, stored_path, applied_by, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id`,
    [sourceFileId, baseName, checksum, destination, operatorId, JSON.stringify(metadata)]
  );

  return {
    snapshotId: snapshot.rows[0].id,
    configName: baseName,
    storedPath: destination,
    keyCount,
    topLevelKeys,
    storedAt: timestamp.toISOString(),
  };
}
