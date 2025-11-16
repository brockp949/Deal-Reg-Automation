import { OpportunityCorrelator } from '../../opportunities/OpportunityCorrelator';
import { OpportunityRecord } from '../../opportunities/types';

const buildRecord = (overrides: Partial<OpportunityRecord>): OpportunityRecord => ({
  id: overrides.id ?? 'opp-1',
  name: overrides.name ?? 'ClearLED PDU',
  stage: overrides.stage ?? 'rfq',
  priority: overrides.priority ?? 'medium',
  yearlyUnitRange: overrides.yearlyUnitRange,
  priceBand: overrides.priceBand,
  costUpsideNotes: overrides.costUpsideNotes ?? [],
  actors: overrides.actors ?? ['jeremy nocchi'],
  nextSteps: overrides.nextSteps ?? [],
  sourceTags: overrides.sourceTags ?? ['opportunity:clearled-pdu'],
  sourceSummary:
    overrides.sourceSummary ??
    [
      {
        parser: 'StandardizedMboxParser',
        fileName: 'file.eml',
        sourceType: 'email',
        referenceIds: ['msg-1'],
      },
    ],
  metadata: overrides.metadata ?? {
    parser: 'StandardizedMboxParser',
    vendor: 'ClearLED',
    customer: 'Antora',
  },
});

describe('OpportunityCorrelator', () => {
  it('creates clusters when opportunity tags overlap', () => {
    const correlator = new OpportunityCorrelator();
    const recordA = buildRecord({
      id: 'opp-a',
      sourceTags: ['opportunity:clearled-pdu', 'label:rfq'],
    });
    const recordB = buildRecord({
      id: 'opp-b',
      sourceTags: ['opportunity:clearled-pdu', 'doc:drive-file'],
      actors: ['steven moore', 'jeremy nocchi'],
    });
    const recordC = buildRecord({
      id: 'opp-c',
      sourceTags: ['opportunity:marshalling-cabinet'],
    });

    const clusters = correlator.correlate([recordA, recordB, recordC]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].records.map((r) => r.id)).toEqual(['opp-a', 'opp-b']);
    expect(clusters[0].signals.sharedOpportunityTags).toEqual(['clearled-pdu']);
    expect(clusters[0].signals.sharedActors).toEqual(['jeremy nocchi']);
    expect(clusters[0].summary.stage).toBe('rfq');
    expect(clusters[0].summary.vendors).toEqual(['ClearLED']);
    expect(clusters[0].score).toBeGreaterThan(0.3);
  });

  it('falls back to vendor/customer grouping when no tags exist', () => {
    const correlator = new OpportunityCorrelator({ minScore: 0 });
    const recordA = buildRecord({
      id: 'opp-a',
      sourceTags: [],
      metadata: { parser: 'StandardizedMboxParser', vendor: 'ClearLED', customer: 'Antora' },
    });
    const recordB = buildRecord({
      id: 'opp-b',
      sourceTags: [],
      metadata: { parser: 'StandardizedTranscriptParser', vendor: 'ClearLED', customer: 'Antora' },
    });

    const clusters = correlator.correlate([recordA, recordB]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].records.map((r) => r.id)).toEqual(['opp-a', 'opp-b']);
    expect(clusters[0].summary.vendors.sort()).toEqual(['ClearLED']);
  });

  it('ignores groups that do not meet score threshold', () => {
    const correlator = new OpportunityCorrelator({ minScore: 0.85 });
    const recordA = buildRecord({
      id: 'opp-a',
      sourceTags: ['opportunity:clearled-pdu'],
      actors: [],
    });
    const recordB = buildRecord({
      id: 'opp-b',
      sourceTags: ['opportunity:clearled-pdu'],
      actors: [],
    });

    const clusters = correlator.correlate([recordA, recordB]);
    expect(clusters).toHaveLength(0);
  });

  it('summarizes clusters with merged stage and priority', () => {
    const correlator = new OpportunityCorrelator({ minScore: 0 });
    const recordA = buildRecord({
      id: 'opp-a',
      stage: 'rfq',
      priority: 'medium',
      metadata: { parser: 'StandardizedMboxParser', vendor: 'ClearLED', customer: 'Antora' },
    });
    const recordB = buildRecord({
      id: 'opp-b',
      stage: 'po_in_progress',
      priority: 'high',
      metadata: { parser: 'StandardizedTranscriptParser', vendor: 'DriveVendor', customer: 'Antora' },
    });

    const clusters = correlator.correlate([recordA, recordB]);
    expect(clusters).toHaveLength(1);
    const summary = clusters[0].summary;
    expect(summary.stage).toBe('po_in_progress');
    expect(summary.priority).toBe('high');
    expect(summary.vendors.sort()).toEqual(['ClearLED', 'DriveVendor']);
    expect(summary.stageConfidence).toBe(0.5);
  });
});
