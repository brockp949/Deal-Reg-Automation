import { OpportunityRecord, OpportunityStage, OpportunityPriority, CompositeOpportunity } from './types';
import { OpportunityCorrelator, OpportunityCluster } from './OpportunityCorrelator';

export interface ConsolidatorOptions {
  minScore?: number;
}

export class OpportunityConsolidator {
  private readonly correlator: OpportunityCorrelator;

  constructor(options: ConsolidatorOptions = {}) {
    this.correlator = new OpportunityCorrelator({ minScore: options.minScore ?? 0.4 });
  }

  consolidate(records: OpportunityRecord[]): CompositeOpportunity[] {
    const clusters = this.correlator.correlate(records);
    const clusteredIds = new Set<string>();

    const consolidated: CompositeOpportunity[] = clusters.map((cluster) => {
      cluster.records.forEach((record) => clusteredIds.add(record.id));
      return this.toConsolidated(cluster);
    });

    for (const record of records) {
      if (clusteredIds.has(record.id)) continue;
      consolidated.push({
        composite_id: `single-${record.id}`,
        cluster_id: `single-${record.id}`,
        opportunity_ids: [record.id],
        stage: record.stage ?? 'unknown',
        stage_confidence: 1,
        priority: record.priority ?? 'medium',
        priority_confidence: 1,
        vendors: record.metadata.vendor ? [record.metadata.vendor] : [],
        customers: record.metadata.customer ? [record.metadata.customer] : [],
        actors: record.actors ?? [],
        tags: record.sourceTags ?? [],
        score: 1,
        conflicts: {
          stages: [],
          priorities: [],
          vendors: [],
          customers: [],
          has_mixed_sources: false,
        },
      });
    }

    return consolidated.sort((a, b) => b.score - a.score);
  }

  private toConsolidated(cluster: OpportunityCluster): CompositeOpportunity {
    return {
      composite_id: cluster.clusterId,
      cluster_id: cluster.clusterId,
      opportunity_ids: cluster.records.map((record) => record.id),
      stage: cluster.summary.stage,
      stage_confidence: cluster.summary.stageConfidence,
      priority: cluster.summary.priority,
      priority_confidence: cluster.summary.priorityConfidence,
      vendors: cluster.summary.vendors,
      customers: cluster.summary.customers,
      actors: cluster.summary.actors,
      tags: cluster.summary.tags,
      score: cluster.score,
      conflicts: this.buildConflicts(cluster.records),
    };
  }

  private buildConflicts(records: OpportunityRecord[]): {
    stages: string[];
    priorities: string[];
    vendors: string[];
    customers: string[];
    has_mixed_sources: boolean;
  } {
    const stages = new Set(records.map((r) => r.stage ?? 'unknown'));
    const priorities = new Set(records.map((r) => r.priority ?? 'medium'));
    const vendors = new Set(
      records
        .map((r) => r.metadata.vendor)
        .filter((value): value is string => Boolean(value))
    );
    const customers = new Set(
      records
        .map((r) => r.metadata.customer)
        .filter((value): value is string => Boolean(value))
    );
    const connectors = new Set(
      records
        .flatMap((record) => record.sourceSummary?.map((summary) => summary.connector))
        .filter(Boolean)
    );

    const conflictingStages = stages.size > 1 ? Array.from(stages) : [];
    const conflictingPriorities = priorities.size > 1 ? Array.from(priorities) : [];
    const conflictingVendors = vendors.size > 1 ? Array.from(vendors) : [];
    const conflictingCustomers = customers.size > 1 ? Array.from(customers) : [];

    return {
      stages: conflictingStages,
      priorities: conflictingPriorities,
      vendors: conflictingVendors,
      customers: conflictingCustomers,
      has_mixed_sources: connectors.size > 1,
    };
  }
}

export default OpportunityConsolidator;
