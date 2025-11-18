import { OpportunityNotificationService } from '../../insights/OpportunityNotificationService';
import { OpportunityInsight } from '../../insights/OpportunityInsightService';

describe('OpportunityNotificationService', () => {
it('generates notifications for risky opportunities', () => {
    const service = new OpportunityNotificationService({ highRiskThreshold: 0.4, channels: ['slack', 'email'] });
    const insights: OpportunityInsight[] = [
      { opportunity_id: 'opp-1', winProbability: 0.8, momentumScore: 0.7, riskFlags: [], notes: [] },
      { opportunity_id: 'opp-2', winProbability: 0.15, momentumScore: 0.3, riskFlags: ['stalled'], notes: [] },
    ];

    const notifications = service.generate(insights);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].opportunity_id).toBe('opp-2');
    expect(notifications[0].severity).toBe('critical');
    expect(notifications[0].channels).toEqual(['slack', 'email']);
    expect(notifications[0].payload?.attachments).toBeDefined();
  });
});
