import path from 'path';
import { OpportunityMapper } from '../opportunities';
import { OpportunityRecord, OpportunitySourceReference } from '../opportunities/types';
import { SourceManifestEntry } from './SourceSyncService';
import { IParser, StandardizedParserOutput } from '../types/parsing';
import logger from '../utils/logger';
import { StandardizedMboxParser } from '../parsers/StandardizedMboxParser';
import { StandardizedTranscriptParser } from '../parsers/StandardizedTranscriptParser';

type ParserName = SourceManifestEntry['parser'];

export interface ManifestProcessorOptions {
  mapper?: OpportunityMapper;
  parserOverrides?: Partial<Record<ParserName, IParser>>;
}

export interface ManifestProcessingError {
  entry: SourceManifestEntry;
  error: string;
}

export interface ManifestProcessResult {
  filesProcessed: number;
  opportunities: OpportunityRecord[];
  perEntry: Array<{ entry: SourceManifestEntry; opportunities: OpportunityRecord[] }>;
  errors: ManifestProcessingError[];
}

export class ManifestProcessor {
  private readonly mapper: OpportunityMapper;
  private readonly parserOverrides: Partial<Record<ParserName, IParser>>;

  constructor(options: ManifestProcessorOptions = {}) {
    this.mapper = options.mapper ?? new OpportunityMapper();
    this.parserOverrides = options.parserOverrides ?? {};
  }

  async processEntries(entries: SourceManifestEntry[]): Promise<ManifestProcessResult> {
    const perEntry: ManifestProcessResult['perEntry'] = [];
    const errors: ManifestProcessResult['errors'] = [];
    const aggregatedOpportunities: OpportunityRecord[] = [];

    for (const entry of entries) {
      try {
        const parser = this.getParser(entry.parser);
        logger.info('Processing manifest entry', {
          filePath: entry.filePath,
          parser: entry.parser,
        });
        const output = await parser.parse(entry.filePath);
        const mapped = this.mapper
          .mapFromParserOutput(output)
          .map((record) => this.enrichWithManifest(record, entry));
        perEntry.push({ entry, opportunities: mapped });
        aggregatedOpportunities.push(...mapped);
      } catch (error: any) {
        logger.error('Failed to process manifest entry', {
          filePath: entry.filePath,
          error: error.message,
        });
        errors.push({ entry, error: error.message });
      }
    }

    return {
      filesProcessed: entries.length,
      opportunities: aggregatedOpportunities,
      perEntry,
      errors,
    };
  }

  private getParser(name: ParserName): IParser {
    const override = this.parserOverrides[name];
    if (override) {
      return override;
    }
    return defaultParsers[name]();
  }

  private enrichWithManifest(
    record: OpportunityRecord,
    entry: SourceManifestEntry
  ): OpportunityRecord {
    const manifestTag = `manifest:${path.basename(entry.metadataPath)}`;
    const sourceTags = Array.from(new Set([...(record.sourceTags ?? []), manifestTag]));

    const sourceSummary = record.sourceSummary.map((summary: OpportunitySourceReference) => ({
      ...summary,
      manifestPath: entry.metadataPath,
    }));

    return {
      ...record,
      sourceTags,
      sourceSummary,
    };
  }
}

/**
 * Default parser factory functions
 * Uses static imports for type safety and better tree-shaking
 */
const defaultParsers: Record<ParserName, () => IParser> = {
  StandardizedMboxParser: () => new StandardizedMboxParser(),
  StandardizedTranscriptParser: () => new StandardizedTranscriptParser(),
};

export default ManifestProcessor;
