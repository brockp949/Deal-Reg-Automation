import { OpportunityInsightService } from '../../insights/OpportunityInsightService';
import { OpportunityRecord } from '../../opportunities/types';

const baseRecord: OpportunityRecord = {
  id: 'opp-1',
  name: 'Test Deal',
  stage: 'rfq',
  priority: 'medium',
  costUpsideNotes: [],
  actors: ['Alice'],
  nextSteps: [],
  sourceTags: [],
  sourceSummary: [],
  metadata: { parser: 'StandardizedParser' },
};

describe('OpportunityInsightService', () => {
  it('scores opportunities and produces summary', () => {
    const service = new OpportunityInsightService(new Date('2025-11-17T00:00:00Z'));
    const records: OpportunityRecord[] = [
      {
        ...baseRecord,
        id: 'opp-1',
        stage: 'po_in_progress',
        priority: 'high',
        structuredNextSteps: [{ description: 'Follow up' }],
        metadata: { parser: 'Test', lastTouched: '2025-11-15T00:00:00Z' },
      },
      {
        ...baseRecord,
        id: 'opp-2',
        stage: 'rfq',
        priority: 'low',
        structuredNextSteps: [],
      },
    ];

    const { insights, summary } = service.generate(records);

    expect(summary.totalOpportunities).toBe(2);
    expect(summary.highWin).toBeGreaterThan(0);
    expect(insights[0].winProbability).toBeGreaterThan(insights[1].winProbability);
    expect(insights[1].riskFlags).toContain('missing_next_steps');
  });
});
