import { SourceType } from '../types/parsing';

export type OpportunityStage =
  | 'rfq'
  | 'quote'
  | 'po_in_progress'
  | 'integration'
  | 'research'
  | 'unknown';

export type OpportunityPriority = 'high' | 'medium' | 'low';

export interface OpportunitySourceReference {
  parser: string;
  fileName: string;
  sourceType: SourceType;
  connector?: 'gmail' | 'drive';
  queryName?: string;
  referenceIds: string[];
  manifestPath?: string;
}

export interface OpportunityRecord {
  id: string;
  name: string;
  stage: OpportunityStage;
  priority: OpportunityPriority;
  yearlyUnitRange?: string;
  priceBand?: string;
  costUpsideNotes: string[];
  actors: string[];
  nextSteps: string[];
  sourceTags: string[];
  sourceSummary: OpportunitySourceReference[];
  metadata: {
    vendor?: string;
    customer?: string;
    parser: string;
    confidence?: number;
  };
}

export interface OpportunityMapperOptions {
  defaultStage?: OpportunityStage;
  defaultPriority?: OpportunityPriority;
}

export interface CompositeOpportunity {
  composite_id: string;
  cluster_id: string;
  opportunity_ids: string[];
  stage: OpportunityStage;
  stage_confidence: number;
  priority: OpportunityPriority;
  priority_confidence: number;
  vendors: string[];
  customers: string[];
  actors: string[];
  tags: string[];
  score: number;
  conflicts: {
    stages: string[];
    priorities: string[];
    vendors: string[];
    customers: string[];
    has_mixed_sources: boolean;
  };
}
