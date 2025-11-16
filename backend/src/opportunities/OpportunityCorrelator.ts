import crypto from 'crypto';
import { OpportunityRecord, OpportunityStage, OpportunityPriority } from './types';

export interface CorrelationOptions {
  minScore?: number;
}

export interface OpportunityCluster {
  clusterId: string;
  records: OpportunityRecord[];
  score: number;
  signals: {
    sharedOpportunityTags: string[];
    sharedActors: string[];
  };
  summary: ClusterSummary;
}

export interface ClusterSummary {
  stage: OpportunityStage;
  priority: OpportunityPriority;
  vendors: string[];
  customers: string[];
  actors: string[];
  tags: string[];
  stageConfidence: number;
  priorityConfidence: number;
}

const STAGE_PRECEDENCE: OpportunityStage[] = [
  'po_in_progress',
  'quote',
  'rfq',
  'integration',
  'research',
  'unknown',
];

const PRIORITY_PRECEDENCE: OpportunityPriority[] = ['high', 'medium', 'low'];

export class OpportunityCorrelator {
  constructor(private readonly options: CorrelationOptions = {}) {}

  correlate(records: OpportunityRecord[]): OpportunityCluster[] {
    const groups = new Map<string, OpportunityRecord[]>();

    for (const record of records) {
      const tags = this.extractOpportunityTags(record);
      const keyCandidates = tags.length ? tags : [this.buildFallbackKey(record)];

      keyCandidates.forEach((key) => {
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(record);
      });
    }

    const clusters: OpportunityCluster[] = [];

    for (const [key, groupRecords] of groups.entries()) {
      if (groupRecords.length < 2) continue;
      const sharedTags = this.intersection(
        groupRecords.map((record) => this.extractOpportunityTags(record))
      );
      const sharedActors = this.intersection(
        groupRecords.map((record) => record.actors ?? [])
      );

      const summary = this.buildSummary(groupRecords);
      const score = this.computeScore(sharedTags, sharedActors, summary.stageConfidence);
      if (score < (this.options.minScore ?? 0.3)) {
        continue;
      }

      clusters.push({
        clusterId: this.buildClusterId(key, groupRecords),
        records: groupRecords,
        score,
        signals: {
          sharedOpportunityTags: sharedTags,
          sharedActors,
        },
        summary,
      });
    }

    return clusters.sort((a, b) => b.score - a.score);
  }

  private extractOpportunityTags(record: OpportunityRecord): string[] {
    return (record.sourceTags ?? [])
      .filter((tag) => tag.startsWith('opportunity:'))
      .map((tag) => tag.replace(/^opportunity:/, '').toLowerCase());
  }

  private buildFallbackKey(record: OpportunityRecord): string {
    return [
      (record.metadata.vendor || '').toLowerCase(),
      (record.metadata.customer || '').toLowerCase(),
      (record.stage || ''),
    ].join('|');
  }

  private computeScore(sharedTags: string[], sharedActors: string[], stageScore: number = 0): number {
    const tagScore = sharedTags.length > 0 ? 1 : 0;
    const actorScore = Math.min(sharedActors.length / 3, 1);
    const combined = 0.5 * tagScore + 0.3 * actorScore + 0.2 * stageScore;
    return Number(combined.toFixed(2));
  }

  private intersection(lists: string[][]): string[] {
    if (!lists.length) return [];
    return lists.reduce<string[]>((acc, list) => {
      if (!acc.length) return [...new Set(list)];
      const next = new Set(list);
      return acc.filter((item) => next.has(item));
    }, lists[0]);
  }

  private buildClusterId(key: string, records: OpportunityRecord[]): string {
    const hash = crypto
      .createHash('sha1')
      .update(key + records.map((record) => record.id).sort().join('|'))
      .digest('hex')
      .slice(0, 12);
    return `cluster-${hash}`;
  }

  private buildSummary(records: OpportunityRecord[]): ClusterSummary {
    const stageCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const vendors = new Set<string>();
    const customers = new Set<string>();
    const actors = new Set<string>();
    const tags = new Set<string>();

    for (const record of records) {
      const stage = record.stage ?? 'unknown';
      stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
      const priority = record.priority ?? 'medium';
      priorityCounts[priority] = (priorityCounts[priority] ?? 0) + 1;
      if (record.metadata.vendor) {
        vendors.add(record.metadata.vendor);
      }
      if (record.metadata.customer) {
        customers.add(record.metadata.customer);
      }
      (record.actors ?? []).forEach((actor) => actors.add(actor));
      (record.sourceTags ?? []).forEach((tag) => tags.add(tag));
    }

    const stageDominant = Object.values(stageCounts).reduce(
      (max, count) => Math.max(max, count),
      0
    );
    const priorityDominant = Object.values(priorityCounts).reduce(
      (max, count) => Math.max(max, count),
      0
    );
    const stageConfidence = records.length
      ? Number((stageDominant / records.length).toFixed(2))
      : 0;
    const priorityConfidence = records.length
      ? Number((priorityDominant / records.length).toFixed(2))
      : 0;

    const stage = this.pickByPrecedence(stageCounts, STAGE_PRECEDENCE, 'unknown');
    const priority = this.pickByPrecedence(priorityCounts, PRIORITY_PRECEDENCE, 'medium');

    return {
      stage: stage as OpportunityStage,
      priority: priority as OpportunityPriority,
      vendors: Array.from(vendors),
      customers: Array.from(customers),
      actors: Array.from(actors),
      tags: Array.from(tags),
      stageConfidence,
      priorityConfidence,
    };
  }

  private pickByPrecedence<T extends string>(
    counts: Record<string, number>,
    precedence: T[],
    fallback: string
  ): string {
    if (!Object.keys(counts).length) {
      return fallback;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    for (const stage of precedence) {
      const match = sorted.find(([key]) => key === stage);
      if (match) return match[0];
    }
    return sorted[0][0];
  }
}

export default OpportunityCorrelator;
