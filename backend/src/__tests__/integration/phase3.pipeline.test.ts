import { OpportunityMapper } from '../../opportunities/OpportunityMapper';
import { OpportunityCorrelator } from '../../opportunities/OpportunityCorrelator';
import { OpportunityConsolidator } from '../../opportunities/OpportunityConsolidator';
import { StandardizedParserOutput } from '../../types/parsing';

const buildParserOutput = (): StandardizedParserOutput => ({
  metadata: {
    sourceType: 'email',
    fileType: 'mbox',
    fileName: 'sample.eml',
    fileSize: 1024,
    parsingMethod: 'StandardizedMboxParser',
    parsingVersion: '2.0.0',
    parsedAt: new Date('2025-11-15T12:00:00Z'),
    processingTime: 1000,
    recordCount: { vendors: 0, deals: 1, contacts: 1, total: 2 },
    sourceMetadata: {
      connector: 'gmail',
      queryName: 'rfq',
      message: {
        id: 'msg-1',
        threadId: 'thread-1',
        headers: { subject: 'RFQ Antora' },
      },
    },
    sourceTags: ['query:rfq'],
  },
  entities: {
    vendors: [],
    deals: [
      {
        deal_name: 'ClearLED PDU',
        vendor_name: 'ClearLED',
        customer_name: 'Antora',
        deal_stage: 'rfq',
        rfq_signals: {
          quantities: ['1,000 units'],
          priceTargets: ['$500 per unit'],
          timelineRequests: ['Q1 2026'],
          marginNotes: ['30% target margin'],
          actorMentions: ['Jeremy Nocchi'],
        },
        stage_hints: ['rfq'],
        source_tags: ['opportunity:clearled-pdu'],
        source_email_id: 'msg-1',
        confidence_score: 0.92,
      },
    ],
    contacts: [
      {
        name: 'Jeremy Nocchi',
        vendor_name: 'ClearLED',
        role: 'sales',
      },
    ],
  },
  errors: [],
  warnings: [],
  statistics: {
    linesProcessed: 10,
    emailsProcessed: 1,
    confidence: {
      avgConfidence: 0.9,
      minConfidence: 0.9,
      maxConfidence: 0.9,
      lowConfidenceCount: 0,
    },
    extractionMethods: {
      regex: 0,
      keyword: 1,
      nlp: 0,
      ai: 0,
      manual: 0,
      inference: 0,
      normalization: 0,
      fuzzy_match: 0,
      domain_match: 0,
    },
  },
  semanticSections: {
    attendees: ['Attendees: Jeremy Nocchi, Steven Moore'],
    pricing: ['Pricing discussed: $500 per unit'],
    margins: ['Margin target 30%'],
    actionItems: ['Send updated pricing deck'],
    opportunityMentions: ['clearled-pdu'],
  },
});

describe('Phase 3 pipeline', () => {
  it('maps parser output through correlator and consolidator', () => {
    const mapper = new OpportunityMapper();
    const correlator = new OpportunityCorrelator();
    const consolidator = new OpportunityConsolidator({ minScore: 0 });
    const parserOutput = buildParserOutput();

    const mapped = mapper.mapFromParserOutput(parserOutput);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].name).toBe('ClearLED PDU');
    expect(mapped[0].actors).toContain('Jeremy Nocchi');

    const clusters = correlator.correlate(mapped);
    expect(clusters).toHaveLength(0);

    const composites = consolidator.consolidate(mapped);
    expect(composites).toHaveLength(1);
    const composite = composites[0];
    expect(composite.cluster_id).toMatch(/^single-/);
    expect(composite.stage).toBe('rfq');
    expect(composite.vendors).toEqual(['ClearLED']);
    expect(composite.conflicts.stages).toHaveLength(0);
    expect(composite.conflicts.has_mixed_sources).toBe(false);
  });
});
