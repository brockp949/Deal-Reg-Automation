/**
 * Vendor Matching Types
 * Unified type definitions for the vendor matching system.
 */

// ============================================================================
// Vendor Record Types
// ============================================================================

/**
 * A vendor record from the database with all relevant fields for matching.
 */
export interface VendorRecord {
  id: string;
  name: string;
  normalizedName: string;
  emailDomains: string[];
  industry?: string;
  website?: string;
  status: string;
  origin: 'user_upload' | 'manual' | 'system_inferred' | 'approved_from_queue';
  approvalStatus: 'approved' | 'pending' | 'denied';
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Lightweight vendor record for cache storage.
 */
export interface CachedVendor {
  id: string;
  name: string;
  normalizedName: string;
  emailDomains: string[];
}

// ============================================================================
// Match Context Types
// ============================================================================

/**
 * Input context for vendor matching.
 * Provides all available information for finding a matching vendor.
 */
export interface VendorMatchContext {
  /** The vendor name extracted from source data */
  extractedName?: string;
  /** Email domain (e.g., "microsoft.com") */
  emailDomain?: string;
  /** Full contact email address */
  contactEmail?: string;
  /** Product names mentioned in source */
  productMentions?: string[];
  /** Keywords extracted from source */
  keywords?: string[];
  /** Original source text for context */
  sourceText?: string;
  /** Pre-loaded vendors to match against (skip DB query) */
  existingVendors?: VendorRecord[];
  /** Source file ID for provenance tracking */
  sourceFileId?: string;
  /** Match configuration overrides */
  options?: MatchOptions;
}

/**
 * Options to customize matching behavior.
 */
export interface MatchOptions {
  /** Minimum confidence threshold (default: 0.3) */
  minConfidence?: number;
  /** Maximum number of alternative matches to return */
  maxAlternatives?: number;
  /** Strategies to enable/disable */
  enabledStrategies?: MatchStrategyType[];
  /** Skip DB query and use only provided vendors */
  useProvidedVendorsOnly?: boolean;
  /** Include detailed scoring breakdown */
  includeDetails?: boolean;
}

// ============================================================================
// Match Result Types
// ============================================================================

/**
 * The result of a vendor matching operation.
 */
export interface VendorMatchResult {
  /** Whether a match was found above threshold */
  matched: boolean;
  /** The best matching vendor (null if no match) */
  vendor: VendorRecord | null;
  /** Confidence score (0.0 to 1.0) */
  confidence: number;
  /** Which strategy produced the match */
  matchStrategy: MatchStrategyType | 'no_match' | 'no_vendors_available';
  /** Detailed match information */
  matchDetails?: MatchDetails;
  /** Other potential matches below the best */
  alternativeMatches?: AlternativeMatch[];
}

/**
 * Detailed breakdown of how a match was determined.
 */
export interface MatchDetails {
  /** Name similarity score (0.0 to 1.0) */
  nameSimilarity?: number;
  /** Whether domain matched */
  domainMatch?: boolean;
  /** Which domain matched */
  matchedDomain?: string;
  /** Products that matched vendor */
  productMatches?: string[];
  /** Keywords that matched */
  keywordMatches?: string[];
  /** If matched via alias */
  aliasMatch?: string;
  /** Raw fuzzy match score */
  fuzzyScore?: number;
  /** Individual strategy scores */
  strategyScores?: Record<MatchStrategyType, number>;
}

/**
 * An alternative match below the best one.
 */
export interface AlternativeMatch {
  vendor: VendorRecord;
  confidence: number;
  strategy: MatchStrategyType;
}

// ============================================================================
// Strategy Types
// ============================================================================

/**
 * Available matching strategies.
 */
export type MatchStrategyType =
  | 'exact_name'
  | 'normalized_name'
  | 'alias'
  | 'email_domain'
  | 'fuzzy_name'
  | 'product'
  | 'keyword'
  | 'combined';

/**
 * Interface for a matching strategy.
 */
export interface IMatchStrategy {
  /** Unique identifier for this strategy */
  readonly type: MatchStrategyType;
  /** Human-readable description */
  readonly description: string;
  /** Priority order (lower = higher priority) */
  readonly priority: number;

  /**
   * Execute the matching strategy.
   * @param context - The matching context
   * @param vendors - List of vendors to match against
   * @returns Match result or null if no match found
   */
  match(
    context: VendorMatchContext,
    vendors: VendorRecord[]
  ): Promise<StrategyMatchResult | null>;
}

/**
 * Result from a single strategy execution.
 */
export interface StrategyMatchResult {
  vendor: VendorRecord;
  confidence: number;
  details?: Partial<MatchDetails>;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for the vendor matching engine.
 */
export interface VendorMatchingConfig {
  /** Confidence thresholds */
  thresholds: {
    /** Minimum confidence to consider a match (default: 0.3) */
    minimum: number;
    /** Low confidence threshold (default: 0.5) */
    low: number;
    /** Medium confidence threshold (default: 0.7) */
    medium: number;
    /** High confidence threshold (default: 0.9) */
    high: number;
    /** Exact match threshold (default: 1.0) */
    exact: number;
  };
  /** Fuzzy matching configuration */
  fuzzy: {
    /** Fuzzball score threshold (0-100) for matches */
    threshold: number;
    /** String similarity threshold (0.0-1.0) */
    stringSimilarityThreshold: number;
  };
  /** Strategy weights for combined scoring */
  weights: {
    name: number;
    domain: number;
    product: number;
    keyword: number;
    contact: number;
  };
  /** Cache configuration */
  cache: {
    /** Whether caching is enabled */
    enabled: boolean;
    /** Cache TTL in milliseconds */
    ttlMs: number;
  };
}

/**
 * Default configuration values.
 */
export const DEFAULT_MATCHING_CONFIG: VendorMatchingConfig = {
  thresholds: {
    minimum: 0.3,
    low: 0.5,
    medium: 0.7,
    high: 0.9,
    exact: 1.0,
  },
  fuzzy: {
    threshold: 70,
    stringSimilarityThreshold: 0.7,
  },
  weights: {
    name: 0.4,
    domain: 0.25,
    product: 0.2,
    keyword: 0.1,
    contact: 0.05,
  },
  cache: {
    enabled: true,
    ttlMs: 5 * 60 * 1000, // 5 minutes
  },
};

// ============================================================================
// Event Types (for cache invalidation)
// ============================================================================

/**
 * Events that trigger cache invalidation.
 */
export type VendorCacheEvent =
  | { type: 'vendor_created'; vendorId: string }
  | { type: 'vendor_updated'; vendorId: string }
  | { type: 'vendor_deleted'; vendorId: string }
  | { type: 'bulk_update'; count: number }
  | { type: 'manual_invalidate' };
