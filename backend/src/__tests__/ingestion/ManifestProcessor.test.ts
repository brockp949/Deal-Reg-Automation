import { ManifestProcessor } from '../../ingestion/ManifestProcessor';
import { SourceManifestEntry } from '../../ingestion/SourceSyncService';
import { OpportunityMapper } from '../../opportunities';
import { OpportunityRecord } from '../../opportunities/types';
import { IParser, StandardizedParserOutput } from '../../types/parsing';

const baseExtractionCounts = {
  regex: 0,
  keyword: 0,
  nlp: 0,
  ai: 0,
  manual: 0,
  inference: 0,
  normalization: 0,
  fuzzy_match: 0,
  domain_match: 0,
};

const buildParserOutput = (dealName: string): StandardizedParserOutput => ({
  metadata: {
    sourceType: 'email',
    fileType: 'mbox',
    fileName: `${dealName}.eml`,
    parsingMethod: 'StandardizedMboxParser',
    parsingVersion: '2.0.0',
    parsedAt: new Date('2025-11-14T12:00:00Z'),
    recordCount: { vendors: 0, deals: 1, contacts: 0, total: 1 },
  },
  entities: {
    vendors: [],
    deals: [
      {
        deal_name: dealName,
        vendor_name: 'ClearLED',
        customer_name: 'Antora',
        source_email_id: 'msg-123',
        source_tags: ['opportunity:clearled-pdu'],
      },
    ],
    contacts: [],
  },
  errors: [],
  warnings: [],
  statistics: {
    emailsProcessed: 1,
    confidence: {
      avgConfidence: 0.9,
      minConfidence: 0.9,
      maxConfidence: 0.9,
      lowConfidenceCount: 0,
    },
    extractionMethods: { ...baseExtractionCounts },
  },
});

const createManifestEntry = (overrides: Partial<SourceManifestEntry>): SourceManifestEntry => ({
  filePath: overrides.filePath ?? '/tmp/file.eml',
  metadataPath: overrides.metadataPath ?? '/tmp/file.eml.json',
  parser: overrides.parser ?? 'StandardizedMboxParser',
  sourceType: overrides.sourceType ?? 'email',
  connector: overrides.connector ?? 'gmail',
  queryName: overrides.queryName ?? 'rfq',
  recordedAt: overrides.recordedAt ?? new Date().toISOString(),
  sourceMetadata:
    overrides.sourceMetadata ??
    ({
      connector: 'gmail',
      queryName: 'rfq',
      message: {
        id: 'msg-123',
        threadId: 'thread-1',
        headers: {},
      },
    } as SourceManifestEntry['sourceMetadata']),
});

const createStubParser = (output: StandardizedParserOutput): IParser => ({
  parse: jest.fn().mockResolvedValue(output),
  validate: jest.fn(),
  getMetadata: jest.fn(),
});

describe('ManifestProcessor', () => {
  it('returns aggregated opportunities with manifest tags', async () => {
    const entry = createManifestEntry({
      filePath: '/tmp/deal.eml',
      metadataPath: '/tmp/deal.eml.json',
    });

    const stubParser = createStubParser(buildParserOutput('ClearLED PDU'));
    const mapper = new OpportunityMapper();
    const processor = new ManifestProcessor({
      mapper,
      parserOverrides: {
        StandardizedMboxParser: stubParser,
      },
    });

    const result = await processor.processEntries([entry]);

    expect(result.filesProcessed).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.opportunities).toHaveLength(1);
    const opportunity = result.opportunities[0];
    expect(opportunity.name).toBe('ClearLED PDU');
    expect(opportunity.sourceTags).toEqual(
      expect.arrayContaining(['manifest:deal.eml.json'])
    );
    expect(opportunity.sourceSummary[0].manifestPath).toBe('/tmp/deal.eml.json');
  });

  it('captures parser errors per manifest entry', async () => {
    const entry = createManifestEntry({
      filePath: '/tmp/bad.eml',
      metadataPath: '/tmp/bad.eml.json',
    });

    const failingParser: IParser = {
      parse: jest.fn().mockRejectedValue(new Error('boom')),
      validate: jest.fn(),
      getMetadata: jest.fn(),
    };

    const processor = new ManifestProcessor({
      parserOverrides: {
        StandardizedMboxParser: failingParser,
      },
    });

    const result = await processor.processEntries([entry]);
    expect(result.opportunities).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].entry.filePath).toBe('/tmp/bad.eml');
    expect(result.errors[0].error).toBe('boom');
  });
});
