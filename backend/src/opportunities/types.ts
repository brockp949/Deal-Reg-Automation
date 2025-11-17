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
  connector?: 'gmail' | 'drive' | 'crm_csv';
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
  structuredNextSteps?: StructuredNextStep[];
  sourceTags: string[];
  sourceSummary: OpportunitySourceReference[];
  metadata: {
    vendor?: string;
    customer?: string;
    parser: string;
    confidence?: number;
    lastTouched?: string;
    annotations?: {
      originalStage?: OpportunityStage;
      stageOverride?: OpportunityStage;
      originalPriority?: OpportunityPriority;
      priorityOverride?: OpportunityPriority;
      reviewer?: string;
      reviewed_at?: string;
      notes?: string;
      verdict?: string;
    };
  };
}

export interface StructuredNextStep {
  description: string;
  owner?: string;
  dueDate?: string;
  source?: string;
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
