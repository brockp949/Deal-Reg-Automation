import { OpportunityConsolidator } from '../../opportunities/OpportunityConsolidator';
import { OpportunityRecord } from '../../opportunities/types';

const buildRecord = (overrides: Partial<OpportunityRecord>): OpportunityRecord => ({
  id: overrides.id ?? 'opp-1',
  name: overrides.name ?? 'ClearLED PDU',
  stage: overrides.stage ?? 'rfq',
  priority: overrides.priority ?? 'medium',
  costUpsideNotes: overrides.costUpsideNotes ?? [],
  actors: overrides.actors ?? [],
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

describe('OpportunityConsolidator', () => {
  it('consolidates clustered opportunities into summaries', () => {
    const consolidator = new OpportunityConsolidator({ minScore: 0 });
    const recordA = buildRecord({
      id: 'opp-a',
      sourceTags: ['opportunity:clearled-pdu'],
      actors: ['jeremy nocchi'],
    });
    const recordB = buildRecord({
      id: 'opp-b',
      stage: 'po_in_progress',
      priority: 'high',
      sourceTags: ['opportunity:clearled-pdu'],
      actors: ['steven moore'],
    });

    const consolidated = consolidator.consolidate([recordA, recordB]);
    expect(consolidated).toHaveLength(1);
    const entry = consolidated[0];
    expect(entry.cluster_id).toContain('cluster-');
    expect(entry.opportunity_ids).toEqual(['opp-a', 'opp-b']);
    expect(entry.stage).toBe('po_in_progress');
    expect(entry.priority).toBe('high');
    expect(entry.vendors).toEqual(['ClearLED']);
    expect(entry.conflicts.stages.sort()).toEqual(['po_in_progress', 'rfq']);
    expect(entry.conflicts.has_mixed_sources).toBe(false);
  });

  it('includes singletons for non-clustered opportunities', () => {
    const consolidator = new OpportunityConsolidator({ minScore: 0.9 });
    const recordA = buildRecord({ id: 'opp-a' });
    const recordB = buildRecord({ id: 'opp-b', sourceTags: ['opportunity:other'] });

    const consolidated = consolidator.consolidate([recordA, recordB]);
    expect(consolidated).toHaveLength(2);
    expect(consolidated[0].cluster_id.startsWith('single-')).toBe(true);
    expect(consolidated[1].cluster_id.startsWith('single-')).toBe(true);
  });

  it('flags mixed connector sources', () => {
    const consolidator = new OpportunityConsolidator({ minScore: 0 });
    const recordA = buildRecord({
      id: 'opp-a',
      sourceSummary: [
        {
          parser: 'StandardizedMboxParser',
          fileName: 'file.eml',
          sourceType: 'email',
          connector: 'gmail',
          referenceIds: ['msg-1'],
        },
      ],
    });
    const recordB = buildRecord({
      id: 'opp-b',
      sourceSummary: [
        {
          parser: 'StandardizedTranscriptParser',
          fileName: 'file.txt',
          sourceType: 'transcript',
          connector: 'drive',
          referenceIds: ['drive-1'],
        },
      ],
    });

    const consolidated = consolidator.consolidate([recordA, recordB]);
    expect(consolidated[0].conflicts.has_mixed_sources).toBe(true);
  });
});
