import { OpportunityInsight } from './OpportunityInsightService';

type NotificationChannel = 'slack' | 'email' | 'tasks';

export interface OpportunityNotification {
  opportunity_id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  channels: NotificationChannel[];
  payload?: Record<string, any>;
}

export interface NotificationServiceOptions {
  highRiskThreshold?: number;
  channels?: NotificationChannel[];
}

export class OpportunityNotificationService {
  private readonly highRiskThreshold: number;
  private readonly channels: NotificationChannel[];

  constructor(options: NotificationServiceOptions = {}) {
    this.highRiskThreshold = options.highRiskThreshold ?? 0.3;
    this.channels = options.channels ?? ['slack'];
  }

  generate(insights: OpportunityInsight[]): OpportunityNotification[] {
    const notifications: OpportunityNotification[] = [];

    for (const insight of insights) {
      if (insight.winProbability <= this.highRiskThreshold || insight.riskFlags.includes('stalled')) {
        const severity: 'info' | 'warning' | 'critical' = insight.winProbability <= 0.2 ? 'critical' : 'warning';
        notifications.push({
          opportunity_id: insight.opportunity_id,
          severity,
          message: this.buildMessage(insight),
          channels: this.channels,
          payload: this.buildPayload(insight, severity),
        });
      }
    }

    return notifications;
  }

  private buildMessage(insight: OpportunityInsight): string {
    const risks = insight.riskFlags.join(', ') || 'none';
    return `Opportunity ${insight.opportunity_id}: winProbability=${insight.winProbability}, momentum=${insight.momentumScore}, risks=${risks}`;
  }

  private buildPayload(insight: OpportunityInsight, severity: 'info' | 'warning' | 'critical') {
    return {
      text: this.buildMessage(insight),
      attachments: [
        {
          title: `Opportunity ${insight.opportunity_id}`,
          color: severity === 'critical' ? '#ff4d4f' : '#faad14',
          fields: [
            { title: 'Win Probability', value: `${insight.winProbability}`, short: true },
            { title: 'Momentum', value: `${insight.momentumScore}`, short: true },
            { title: 'Risks', value: insight.riskFlags.join(', ') || 'none', short: false },
          ],
        },
      ],
    };
  }
}
