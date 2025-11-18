import { OpportunityRecord } from '../opportunities/types';

export interface OpportunityInsight {
  opportunity_id: string;
  winProbability: number;
  momentumScore: number;
  riskFlags: string[];
  notes: string[];
}

export interface InsightSummary {
  generatedAt: string;
  totalOpportunities: number;
  highWin: number;
  mediumWin: number;
  lowWin: number;
  avgMomentum: number;
}

export class OpportunityInsightService {
  constructor(private readonly now: Date = new Date()) {}

  generate(records: OpportunityRecord[]): { insights: OpportunityInsight[]; summary: InsightSummary } {
    const insights = records.map((record) => this.scoreOpportunity(record));
    const groups = { high: 0, medium: 0, low: 0 };
    let momentumSum = 0;

    for (const insight of insights) {
      if (insight.winProbability >= 0.7) groups.high += 1;
      else if (insight.winProbability >= 0.4) groups.medium += 1;
      else groups.low += 1;
      momentumSum += insight.momentumScore;
    }

    return {
      insights,
      summary: {
        generatedAt: this.now.toISOString(),
        totalOpportunities: records.length,
        highWin: groups.high,
        mediumWin: groups.medium,
        lowWin: groups.low,
        avgMomentum: insights.length ? Number((momentumSum / insights.length).toFixed(2)) : 0,
      },
    };
  }

  private scoreOpportunity(record: OpportunityRecord): OpportunityInsight {
    const winProbability = this.estimateWinProbability(record);
    const momentumScore = this.estimateMomentum(record);
    const riskFlags = this.computeRiskFlags(record, winProbability, momentumScore);

    return {
      opportunity_id: record.id,
      winProbability: Number(winProbability.toFixed(2)),
      momentumScore: Number(momentumScore.toFixed(2)),
      riskFlags,
      notes: this.buildNotes(record, riskFlags),
    };
  }

  private estimateWinProbability(record: OpportunityRecord): number {
    let base = 0.2;
    if (record.stage === 'po_in_progress' || record.stage === 'integration') base = 0.8;
    else if (record.stage === 'quote') base = 0.55;
    else if (record.stage === 'rfq') base = 0.4;

    if (record.priority === 'high') base += 0.1;
    else if (record.priority === 'low') base -= 0.05;

    if (record.costUpsideNotes.length > 0) base += 0.05;
    if ((record.structuredNextSteps ?? []).length === 0) base -= 0.05;

    return Math.max(0.05, Math.min(0.95, base));
  }

  private estimateMomentum(record: OpportunityRecord): number {
    const nextSteps = record.structuredNextSteps ?? [];
    const actors = record.actors ?? [];
    let score = 0.5;

    if (nextSteps.length > 0) score += 0.2;
    if (actors.length > 2) score += 0.1;
    if (record.metadata.lastTouched) {
      const daysSince = (this.now.getTime() - new Date(record.metadata.lastTouched).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince <= 7) score += 0.1;
      else if (daysSince > 21) score -= 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  private computeRiskFlags(record: OpportunityRecord, winProbability: number, momentumScore: number): string[] {
    const flags: string[] = [];
    if (winProbability < 0.3) flags.push('low_win_probability');
    if (momentumScore < 0.4) flags.push('stalled');
    if ((record.structuredNextSteps ?? []).length === 0) flags.push('missing_next_steps');
    if (!record.metadata.vendor || !record.metadata.customer) flags.push('incomplete_metadata');
    return flags;
  }

  private buildNotes(record: OpportunityRecord, flags: string[]): string[] {
    const notes: string[] = [];
    if (record.priority === 'high' && record.stage === 'rfq') {
      notes.push('High-priority RFQ: ensure follow-up on pricing.');
    }
    if (flags.includes('stalled')) {
      notes.push('No recent activity detected; consider re-engaging stakeholders.');
    }
    return notes;
  }
}
