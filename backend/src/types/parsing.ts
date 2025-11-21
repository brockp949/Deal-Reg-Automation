import type { SourceMetadata } from '../connectors/types';

/**
 * Standardized Parser Types
 *
 * Common interfaces and types for all file parsers to ensure consistency
 * across the system. This standardization enables:
 * - Easier AI integration in Phase 4
 * - Consistent error handling
 * - Better testing and maintenance
 * - Predictable data flow
 */

// ============================================================================
// SOURCE TYPES
// ============================================================================

export type SourceType = 'email' | 'csv' | 'transcript' | 'pdf' | 'docx' | 'manual';

export type FileType = 'mbox' | 'csv' | 'vtiger_csv' | 'txt' | 'pdf' | 'docx' | 'transcript';

// ============================================================================
// EXTRACTION METHODS
// ============================================================================

export type ExtractionMethod =
  | 'regex'           // Pattern matching
  | 'keyword'         // Keyword-based (tiered system)
  | 'nlp'            // NLP patterns
  | 'ai'             // AI/LLM extraction
  | 'manual'         // Manual data entry
  | 'inference'      // Inferred from context
  | 'normalization'  // Derived through normalization
  | 'fuzzy_match'    // Fuzzy string matching
  | 'domain_match';  // Email domain matching

// ============================================================================
// PARSING ERRORS
// ============================================================================

export enum ParsingErrorSeverity {
  CRITICAL = 'critical',  // Cannot continue parsing
  ERROR = 'error',        // Significant issue, partial data may be lost
  WARNING = 'warning',    // Minor issue, processing continues
  INFO = 'info',          // Informational, no data loss
}

export interface ParsingError {
  severity: ParsingErrorSeverity;
  message: string;
  location?: string;      // Where in the file (line number, row, etc.)
  context?: any;          // Additional context for debugging
  recoverable: boolean;   // Can parsing continue?
}

export interface ParsingWarning {
  message: string;
  location?: string;
  suggestion?: string;    // Suggestion for user to fix
}

// ============================================================================
// ENTITY TYPES
// ============================================================================

export interface NormalizedVendor {
  // Required fields
  name: string;
  normalized_name: string;

  // Optional fields
  email_domains?: string[];
  industry?: string;
  website?: string;
  notes?: string;

  // Contact information
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;

  // Metadata
  origin?: string;           // 'extracted', 'manual', 'imported'
  confidence?: number;       // 0.0 to 1.0
  source_location?: string;  // Where this was extracted from
}

export interface NormalizedDeal {
  // Required fields
  deal_name: string;
  vendor_name: string;       // Reference to vendor

  // Financial information
  deal_value?: number;
  currency?: string;

  // Customer information
  customer_name?: string;
  customer_industry?: string;
  end_user_address?: string;

  // Timeline
  registration_date?: Date;
  expected_close_date?: Date;
  contract_start_date?: Date;
  contract_end_date?: Date;

  // Status and stage
  status?: string;           // 'registered', 'approved', 'pending', etc.
  deal_stage?: string;       // 'prospecting', 'qualification', etc.
  probability?: number;      // 0-100

  // Decision maker
  decision_maker_contact?: string;
  decision_maker_email?: string;
  decision_maker_phone?: string;

  // Deal details
  deal_type?: string;                      // 'co-sell', 'partner-led', 'rfp', etc.
  deployment_environment?: string;         // 'azure', 'aws', 'on-premise'
  solution_category?: string;              // 'networking', 'security', etc.
  pricing_model?: string;                  // 'subscription', 'perpetual', etc.
  project_name?: string;
  pre_sales_efforts?: string;
  product_service_requirements?: string;
  notes?: string;
  next_steps?: string[];
  objections?: string[];
  competitor_insights?: string[];
  identified_competitors?: string[];

  // Metadata
  confidence_score?: number;               // 0.0 to 1.0
  extraction_method?: ExtractionMethod;
  source_email_id?: string;
  source_location?: string;
  source_tags?: string[];
  rfq_signals?: RfqSignals;
  stage_hints?: string[];
  deal_name_features?: any;
  deal_name_candidates?: string[];
}

export interface NormalizedContact {
  // Required fields
  name: string;
  vendor_name: string;       // Reference to vendor

  // Contact details
  email?: string;
  phone?: string;
  role?: string;             // 'decision_maker', 'partner', 'vendor', etc.

  // Metadata
  is_primary?: boolean;
  source_location?: string;
  source_tags?: string[];
}

export interface RfqSignals {
  quantities: string[];
  priceTargets: string[];
  timelineRequests: string[];
  marginNotes: string[];
  actorMentions: string[];
}

export interface ParserSemanticSections {
  attendees: string[];
  pricing: string[];
  margins: string[];
  actionItems: string[];
  opportunityMentions: string[];
}

// ============================================================================
// STANDARDIZED PARSER OUTPUT
// ============================================================================

/**
 * Standard output format that ALL parsers must return
 */
export interface StandardizedParserOutput {
  // Metadata about the parsing operation
  metadata: {
    sourceType: SourceType;              // Type of source file
    fileType: FileType;                  // Specific file format
    fileName: string;                    // Original filename
    fileSize?: number;                   // Size in bytes
    parsingMethod: string;               // Which parser was used
    parsingVersion: string;              // Parser version (for tracking changes)
    parsedAt: Date;                      // When parsing occurred
    processingTime?: number;             // Time taken in milliseconds
    recordCount: {                       // Count of extracted entities
      vendors: number;
      deals: number;
      contacts: number;
      total: number;
    };
    sourceMetadata?: SourceMetadata;
    sourceTags?: string[];
  };

  // The normalized, clean text from the file (optional)
  // Useful for AI processing in Phase 4
  normalizedText?: string;

  // Extracted and normalized entities
  entities: {
    vendors: NormalizedVendor[];
    deals: NormalizedDeal[];
    contacts: NormalizedContact[];
  };

  // Original raw data (for debugging and audit purposes)
  rawData?: any;

  // Semantic sections derived from transcripts or narratives
  semanticSections?: ParserSemanticSections;

  // Errors and warnings encountered during parsing
  errors: ParsingError[];
  warnings: ParsingWarning[];

  // Statistics about the parsing operation
  statistics: {
    linesProcessed?: number;
    rowsProcessed?: number;
    emailsProcessed?: number;
    confidence: {
      avgConfidence: number;             // Average confidence across all entities
      minConfidence: number;             // Lowest confidence
      maxConfidence: number;             // Highest confidence
      lowConfidenceCount: number;        // Count of entities with confidence < 0.5
    };
    extractionMethods: Record<ExtractionMethod, number>;  // Count by method
  };

  // Suggestions for improvement (e.g., missing required fields)
  suggestions?: string[];
}

// ============================================================================
// PARSER INTERFACE
// ============================================================================

/**
 * Interface that all parsers must implement
 */
export interface IParser {
  /**
   * Parse a file and return standardized output
   * @param filePath Path to the file to parse
   * @param options Parser-specific options
   */
  parse(filePath: string, options?: any): Promise<StandardizedParserOutput>;

  /**
   * Validate the parser output
   * @param output The output to validate
   */
  validate(output: StandardizedParserOutput): ValidationResult;

  /**
   * Get parser metadata
   */
  getMetadata(): ParserMetadata;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ParserMetadata {
  name: string;
  version: string;
  supportedFileTypes: FileType[];
  capabilities: string[];
}

// ============================================================================
// PARSER OPTIONS
// ============================================================================

export interface BaseParserOptions {
  // Confidence threshold for filtering results
  confidenceThreshold?: number;          // Default: 0.0 (include all)

  // Whether to include raw data in output
  includeRawData?: boolean;              // Default: false

  // Whether to include normalized text
  includeNormalizedText?: boolean;       // Default: false

  // Maximum entities to extract (for performance)
  maxEntities?: number;                  // Default: unlimited

  // Vendor filtering
  vendorDomains?: string[];              // Filter by vendor domains
  vendorNames?: string[];                // Filter by vendor names

  // Verbosity
  verbose?: boolean;                     // Default: false
}

export interface MboxParserOptions extends BaseParserOptions {
  // Use enhanced 3-layer extraction
  useEnhancedExtraction?: boolean;       // Default: true

  // Thread correlation
  correlateThreads?: boolean;            // Default: true

  // Keyword filtering
  requireTier1Keywords?: boolean;        // Default: false
}

export interface CSVParserOptions extends BaseParserOptions {
  // Auto-detect CRM format
  autoDetectFormat?: boolean;            // Default: true

  // Specific format to use
  format?: 'vtiger' | 'salesforce' | 'hubspot' | 'zoho' | 'pipedrive' | 'deals_with_vendors' | 'generic' | 'auto';

  // Custom column mappings
  columnMappings?: Record<string, string>;
}

export interface TranscriptParserOptions extends BaseParserOptions {
  // Use enhanced transcript parsing
  useEnhancedParsing?: boolean;          // Default: true

  // Speaker identification
  identifySpeakers?: boolean;            // Default: false

  // Thresholds for enhanced parsing heuristics
  buyingSignalThreshold?: number;
  confidenceThreshold?: number;
}

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Result of attempting to find or create an entity
 */
export interface EntityCreationResult<T> {
  id: string;
  entity: T;
  wasCreated: boolean;     // true if newly created, false if existing
  confidence: number;
}

/**
 * Context for tracking where data came from
 */
export interface ExtractionContext {
  sourceFileId?: string;
  sourceLocation: string;  // Human-readable location
  extractionMethod: ExtractionMethod;
  confidence: number;
  timestamp: Date;
}
