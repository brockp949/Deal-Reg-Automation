/**
 * Deal Extraction Types
 *
 * Common types and interfaces for deal separation and extraction.
 */

/**
 * Detection method used to identify a deal boundary
 */
export type DetectionMethod = 'keyword' | 'pattern' | 'structure' | 'nlp' | 'hybrid';

/**
 * Confidence level for extracted data
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * A boundary marking where a deal starts and ends in text
 */
export interface DealBoundary {
  /** Start character index in the source text */
  startIndex: number;
  /** End character index in the source text */
  endIndex: number;
  /** Confidence score (0-1) for this boundary */
  confidence: number;
  /** Method used to detect this boundary */
  detectionMethod: DetectionMethod;
  /** Optional title/header that triggered detection */
  trigger?: string;
  /** Line number where boundary starts */
  startLine?: number;
  /** Line number where boundary ends */
  endLine?: number;
}

/**
 * Extracted deal information
 */
export interface ExtractedDeal {
  /** Deal name/title */
  dealName: string;
  /** Customer/company name */
  customerName?: string;
  /** Deal monetary value */
  dealValue?: number;
  /** Currency code (USD, EUR, etc.) */
  currency?: string;
  /** Current deal status */
  status?: string;
  /** Deal stage in pipeline */
  stage?: string;
  /** Deal owner/rep name */
  owner?: string;
  /** Expected close date */
  expectedCloseDate?: Date;
  /** Registration date */
  registrationDate?: Date;
  /** Deal description/notes */
  description?: string;
  /** Probability percentage (0-100) */
  probability?: number;
  /** Decision maker contact */
  decisionMaker?: string;
  /** Decision maker email */
  decisionMakerEmail?: string;
  /** Decision maker phone */
  decisionMakerPhone?: string;
  /** Next steps */
  nextSteps?: string[];
  /** Identified competitors */
  competitors?: string[];
  /** Overall confidence score (0-1) */
  confidence: number;
  /** Individual field confidences */
  fieldConfidences?: Record<string, number>;
  /** Source location info */
  sourceLocation: {
    startIndex: number;
    endIndex: number;
    sourceFile?: string;
    startLine?: number;
    endLine?: number;
  };
  /** Raw text of the deal section */
  rawText: string;
  /** Extraction metadata */
  extractionMetadata?: {
    method: DetectionMethod;
    extractedAt: Date;
    fieldsExtracted: number;
    fieldsTotal: number;
  };
}

/**
 * Result of deal separation
 */
export interface SeparationResult {
  /** Identified deal boundaries */
  boundaries: DealBoundary[];
  /** Statistics about separation */
  statistics: {
    totalBoundaries: number;
    byMethod: Record<DetectionMethod, number>;
    averageConfidence: number;
    lowConfidenceCount: number;
  };
  /** Any warnings during separation */
  warnings: string[];
}

/**
 * Result of deal extraction
 */
export interface ExtractionResult {
  /** Extracted deals */
  deals: ExtractedDeal[];
  /** Deals that were filtered as duplicates */
  duplicates: ExtractedDeal[];
  /** Statistics about extraction */
  statistics: {
    totalDeals: number;
    duplicatesRemoved: number;
    averageConfidence: number;
    fieldsExtracted: Record<string, number>;
  };
  /** Any warnings during extraction */
  warnings: string[];
}

/**
 * Options for deal separation
 */
export interface SeparationOptions {
  /** Minimum confidence threshold for boundaries */
  minConfidence?: number;
  /** Maximum number of deals to extract */
  maxDeals?: number;
  /** Whether to merge overlapping boundaries */
  mergeOverlapping?: boolean;
  /** Custom keywords to detect deal starts */
  customKeywords?: string[];
  /** Whether to use NLP-based detection */
  useNlp?: boolean;
}

/**
 * Options for deal extraction
 */
export interface ExtractionOptions {
  /** Minimum confidence for including a deal */
  minConfidence?: number;
  /** Whether to deduplicate results */
  deduplicate?: boolean;
  /** Similarity threshold for deduplication (0-1) */
  deduplicationThreshold?: number;
  /** Fields to extract (empty = all) */
  fields?: string[];
  /** Source file name for metadata */
  sourceFile?: string;
}

/**
 * Field extraction pattern
 */
export interface FieldPattern {
  /** Field name */
  field: string;
  /** Regex patterns to try (in order of preference) */
  patterns: RegExp[];
  /** Post-processor function (receives primary capture group and optional secondary group) */
  processor?: (value: string, secondaryValue?: string) => any;
  /** Confidence boost for this pattern */
  confidenceBoost?: number;
}

/**
 * Default options
 */
export const DEFAULT_SEPARATION_OPTIONS: Required<SeparationOptions> = {
  minConfidence: 0.3,
  maxDeals: 100,
  mergeOverlapping: true,
  customKeywords: [],
  useNlp: false,
};

export const DEFAULT_EXTRACTION_OPTIONS: Required<ExtractionOptions> = {
  minConfidence: 0.3,
  deduplicate: true,
  deduplicationThreshold: 0.85,
  fields: [],
  sourceFile: '',
};
