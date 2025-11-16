import { promises as fs } from 'fs';
import path from 'path';
import { OpportunityRecord } from './types';
import logger from '../utils/logger';

export interface OpportunityStoreOptions {
  baseDir: string;
  fileName?: string;
}

export interface OpportunityStoreResult {
  storedRecords: OpportunityRecord[];
  filePath: string;
}

export class OpportunityStore {
  private readonly fileName: string;

  constructor(private readonly options: OpportunityStoreOptions) {
    if (!options.baseDir) {
      throw new Error('OpportunityStore requires a baseDir option');
    }
    this.fileName = options.fileName ?? 'opportunities.json';
  }

  async upsert(records: OpportunityRecord[]): Promise<OpportunityStoreResult> {
    const dir = await this.ensureDirectory();
    const filePath = path.join(dir, this.fileName);
    const existing = await this.readExisting(filePath);
    const map = new Map(existing.map((record) => [record.id, record]));

    for (const record of records) {
      map.set(record.id, record);
    }

    const merged = Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
    await fs.writeFile(filePath, JSON.stringify(merged, null, 2), 'utf-8');

    logger.info('OpportunityStore persisted records', {
      stored: merged.length,
      filePath,
    });

    return { storedRecords: merged, filePath };
  }

  private async ensureDirectory(): Promise<string> {
    const dir = path.join(this.options.baseDir, 'opportunities');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private async readExisting(filePath: string): Promise<OpportunityRecord[]> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as OpportunityRecord[];
      }
      logger.warn('OpportunityStore found non-array data, resetting file', { filePath });
      return [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

export default OpportunityStore;
