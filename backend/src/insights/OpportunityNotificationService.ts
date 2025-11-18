import { OpportunityInsight } from './OpportunityInsightService';

export interface OpportunityNotification {
  opportunity_id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  channels: string[];
}

export class OpportunityNotificationService {
  constructor(private readonly options: { highRiskThreshold?: number } = {}) {}

  generate(insights: OpportunityInsight[]): OpportunityNotification[] {
    const notifications: OpportunityNotification[] = [];
    const highRiskThreshold = this.options.highRiskThreshold ?? 0.3;

    for (const insight of insights) {
      if (insight.winProbability <= highRiskThreshold || insight.riskFlags.includes('stalled')) {
        notifications.push({
          opportunity_id: insight.opportunity_id,
          severity: insight.winProbability <= 0.2 ? 'critical' : 'warning',
          message: this.buildMessage(insight),
          channels: ['slack', 'email'],
        });
      }
    }

    return notifications;
  }

  private buildMessage(insight: OpportunityInsight): string {
    const risks = insight.riskFlags.join(', ') || 'none';
    return `Opportunity ${insight.opportunity_id}: winProbability=${insight.winProbability}, momentum=${insight.momentumScore}, risks=${risks}`;
  }
}
