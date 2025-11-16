import { OpportunityRecord } from './types';
import { OpportunityCorrelator, OpportunityCluster } from './OpportunityCorrelator';

export interface ConsolidatedOpportunity {
  clusterId: string;
  opportunityIds: string[];
  stage: string;
  priority: string;
  vendors: string[];
  customers: string[];
  actors: string[];
  tags: string[];
  score: number;
  stageConfidence: number;
  priorityConfidence: number;
}

export interface ConsolidatorOptions {
  minScore?: number;
}

export class OpportunityConsolidator {
  private readonly correlator: OpportunityCorrelator;

  constructor(options: ConsolidatorOptions = {}) {
    this.correlator = new OpportunityCorrelator({ minScore: options.minScore ?? 0.4 });
  }

  consolidate(records: OpportunityRecord[]): ConsolidatedOpportunity[] {
    const clusters = this.correlator.correlate(records);
    const clusteredIds = new Set<string>();

    const consolidated: ConsolidatedOpportunity[] = clusters.map((cluster) => {
      cluster.records.forEach((record) => clusteredIds.add(record.id));
      return this.toConsolidated(cluster);
    });

    for (const record of records) {
      if (clusteredIds.has(record.id)) continue;
      consolidated.push({
        clusterId: `single-${record.id}`,
        opportunityIds: [record.id],
        stage: record.stage ?? 'unknown',
        priority: record.priority ?? 'medium',
        vendors: record.metadata.vendor ? [record.metadata.vendor] : [],
        customers: record.metadata.customer ? [record.metadata.customer] : [],
        actors: record.actors ?? [],
        tags: record.sourceTags ?? [],
        score: 1,
        stageConfidence: 1,
        priorityConfidence: 1,
      });
    }

    return consolidated.sort((a, b) => b.score - a.score);
  }

  private toConsolidated(cluster: OpportunityCluster): ConsolidatedOpportunity {
    return {
      clusterId: cluster.clusterId,
      opportunityIds: cluster.records.map((record) => record.id),
      stage: cluster.summary.stage,
      priority: cluster.summary.priority,
      vendors: cluster.summary.vendors,
      customers: cluster.summary.customers,
      actors: cluster.summary.actors,
      tags: cluster.summary.tags,
      score: cluster.score,
      stageConfidence: cluster.summary.stageConfidence,
      priorityConfidence: cluster.summary.priorityConfidence,
    };
  }
}

export default OpportunityConsolidator;
