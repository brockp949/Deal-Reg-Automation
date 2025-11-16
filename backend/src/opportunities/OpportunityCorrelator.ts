import crypto from 'crypto';
import { OpportunityRecord } from './types';

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
}

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

      const score = this.computeScore(sharedTags, sharedActors);
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

  private computeScore(sharedTags: string[], sharedActors: string[]): number {
    const tagScore = sharedTags.length > 0 ? 1 : 0;
    const actorScore = Math.min(sharedActors.length / 3, 1);
    return Number((0.6 * tagScore + 0.4 * actorScore).toFixed(2));
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
}

export default OpportunityCorrelator;
