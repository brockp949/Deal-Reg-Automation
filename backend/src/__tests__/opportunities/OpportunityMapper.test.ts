import { OpportunityMapper } from '../../opportunities/OpportunityMapper';
import { StandardizedParserOutput } from '../../types/parsing';

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

type ParserOutputOverrides = {
  metadata?: Partial<StandardizedParserOutput['metadata']>;
  entities?: Partial<StandardizedParserOutput['entities']>;
  statistics?: Partial<StandardizedParserOutput['statistics']>;
  semanticSections?: StandardizedParserOutput['semanticSections'];
  rawData?: any;
};

const buildParserOutput = (overrides: ParserOutputOverrides): StandardizedParserOutput => ({
  metadata: {
    sourceType: 'email',
    fileType: 'mbox',
    fileName: 'drive_file.eml',
    parsingMethod: 'StandardizedParser',
    parsingVersion: '1.0.0',
    parsedAt: new Date('2025-11-10T12:00:00Z'),
    recordCount: { vendors: 0, deals: 1, contacts: 1, total: 2 },
    sourceTags: ['query:4iec', 'label:rfq'],
    ...overrides.metadata,
  },
  entities: {
    vendors: overrides.entities?.vendors ?? [],
    deals: overrides.entities?.deals ?? [],
    contacts: overrides.entities?.contacts ?? [],
  },
  errors: [],
  warnings: [],
  statistics: {
    linesProcessed: 10,
    emailsProcessed: 1,
    confidence: {
      avgConfidence: 0.8,
      minConfidence: 0.8,
      maxConfidence: 0.8,
      lowConfidenceCount: 0,
    },
    extractionMethods: { ...baseExtractionCounts },
    ...overrides.statistics,
  },
  semanticSections: overrides.semanticSections,
  rawData: overrides.rawData,
});

describe('OpportunityMapper', () => {
  it('maps parser output into opportunity records with signals and metadata', () => {
    const mapper = new OpportunityMapper();
    const output = buildParserOutput({
      metadata: {
        sourceMetadata: {
          connector: 'gmail',
          queryName: 'rfq',
          message: {
            id: 'msg-1',
            threadId: 'thread-1',
            headers: {},
          },
        },
      },
      entities: {
        deals: [
          {
            deal_name: 'ClearLED PDU',
            vendor_name: 'ClearLED',
            customer_name: 'Antora',
            deal_stage: 'rfq',
            stage_hints: ['rfq'],
            rfq_signals: {
              quantities: ['1,500-4,000 units'],
              priceTargets: ['$500-700 per unit'],
              timelineRequests: ['6 weeks'],
              marginNotes: ['27-30%'],
              actorMentions: ['jeremy nocchi'],
            },
            confidence_score: 0.92,
            source_email_id: 'msg-1',
            source_tags: ['opportunity:clearled-pdu'],
          },
        ],
        contacts: [
          {
            name: 'Steven Moore',
            vendor_name: 'ClearLED',
          },
        ],
      },
      semanticSections: {
        attendees: ['Attendees: Jeremy Nocchi, Steven Moore'],
        pricing: ['Pricing: ClearLED PDU quote for 1,500-4,000 units at $500-700 per unit'],
        margins: ['27-30% GM'],
        actionItems: ['- Send updated quote and call Antora Tuesday'],
        opportunityMentions: ['clearled-pdu'],
      },
    });

    const [opportunity] = mapper.mapFromParserOutput(output);

    expect(opportunity.name).toBe('ClearLED PDU');
    expect(opportunity.stage).toBe('rfq');
    expect(opportunity.priority).toBe('medium');
    expect(opportunity.yearlyUnitRange).toBe('1,500-4,000 units');
    expect(opportunity.priceBand).toBe('$500-700 per unit');
    expect(opportunity.costUpsideNotes).toEqual(
      expect.arrayContaining(['27-30%', '27-30% GM'])
    );
    expect(opportunity.actors).toEqual(
      expect.arrayContaining(['jeremy nocchi', 'Steven Moore', 'Jeremy Nocchi, Steven Moore'])
    );
    expect(opportunity.nextSteps).toContain('- Send updated quote and call Antora Tuesday');
    expect(opportunity.sourceTags).toEqual(
      expect.arrayContaining(['opportunity:clearled-pdu', 'query:4iec'])
    );
    expect(opportunity.sourceSummary[0]).toMatchObject({
      connector: 'gmail',
      queryName: 'rfq',
      referenceIds: ['msg-1'],
    });
    expect(opportunity.metadata.vendor).toBe('ClearLED');
    expect(opportunity.metadata.customer).toBe('Antora');
  });

  it('falls back to defaults when signals are missing', () => {
    const mapper = new OpportunityMapper({ defaultStage: 'unknown', defaultPriority: 'low' });
    const output = buildParserOutput({
      metadata: {
        fileName: 'meeting.txt',
        sourceType: 'transcript',
        sourceMetadata: {
          connector: 'drive',
          queryName: 'meeting-notes',
          file: {
            id: 'drive-file',
            name: 'meeting.txt',
            mimeType: 'text/plain',
          },
        },
      },
      entities: {
        deals: [
          {
            deal_name: 'Graphene Heater Concept',
            vendor_name: '4IEC',
            customer_name: 'Antora',
            source_email_id: undefined,
          },
        ],
        contacts: [],
      },
      semanticSections: {
        attendees: [],
        pricing: [],
        margins: [],
        actionItems: [],
        opportunityMentions: [],
      },
    });

    const [opportunity] = mapper.mapFromParserOutput(output);

    expect(opportunity.stage).toBe('unknown');
    expect(opportunity.priority).toBe('low');
    expect(opportunity.yearlyUnitRange).toBeUndefined();
    expect(opportunity.priceBand).toBeUndefined();
    expect(opportunity.sourceSummary[0].connector).toBe('drive');
    expect(opportunity.sourceSummary[0].referenceIds).toContain('drive-file');
  });
});
