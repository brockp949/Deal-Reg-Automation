import { promises as fs } from 'fs';
import { SourceMetadata } from '../connectors/types';

export async function loadSourceMetadata(filePath: string): Promise<SourceMetadata | undefined> {
  const metadataPath = `${filePath}.json`;
  try {
    const raw = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(raw) as SourceMetadata;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

