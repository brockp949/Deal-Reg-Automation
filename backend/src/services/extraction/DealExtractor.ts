/**
 * DealExtractor - Intelligent Deal Field Extraction
 *
 * This service extracts structured deal information from text sections.
 * Features:
 * - Multi-pattern field extraction
 * - Confidence scoring per field
 * - Deduplication
 * - Date and currency parsing
 */

import logger from '../../utils/logger';
import {
  DealBoundary,
  ExtractedDeal,
  ExtractionResult,
  ExtractionOptions,
  FieldPattern,
  DEFAULT_EXTRACTION_OPTIONS,
} from './types';

/**
 * Field extraction patterns
 */
const FIELD_PATTERNS: FieldPattern[] = [
  // Deal Name
  {
    field: 'dealName',
    patterns: [
      /Deal(?:\s+Name)?[\s]*[:#-]\s*([^\n]+)/i,
      /Opportunity(?:\s+Name)?[\s]*[:#-]\s*([^\n]+)/i,
      /Account(?:\s+Name)?[\s]*[:#-]\s*([^\n]+)/i,
      /Project(?:\s+Name)?[\s]*[:#-]\s*([^\n]+)/i,
    ],
    processor: (val) => val.trim(),
    confidenceBoost: 0.2,
  },
  // Customer Name
  {
    field: 'customerName',
    patterns: [
      /Customer(?:\s+Name)?[\s]*[:#-]\s*([^\n]+)/i,
      /Client(?:\s+Name)?[\s]*[:#-]\s*([^\n]+)/i,
      /Company(?:\s+Name)?[\s]*[:#-]\s*([^\n]+)/i,
      /Account[\s]*[:#-]\s*([^\n]+)/i,
      /End[\s-]*User[\s]*[:#-]\s*([^\n]+)/i,
    ],
    processor: (val) => val.trim(),
    confidenceBoost: 0.15,
  },
  // Deal Value
  {
    field: 'dealValue',
    patterns: [
      /(?:Deal\s+)?Value[\s]*[:#-]\s*\$?([\d,]+(?:\.\d{2})?)\s*([kKmM])?/i,
      /(?:Deal\s+)?Amount[\s]*[:#-]\s*\$?([\d,]+(?:\.\d{2})?)\s*([kKmM])?/i,
      /(?:Deal\s+)?Size[\s]*[:#-]\s*\$?([\d,]+(?:\.\d{2})?)\s*([kKmM])?/i,
      /Price[\s]*[:#-]\s*\$?([\d,]+(?:\.\d{2})?)\s*([kKmM])?/i,
      /\$\s*([\d,]+(?:\.\d{2})?)\s*([kKmM])?(?:\s|$)/,
      /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|dollars?)/i,
    ],
    processor: parseMonetaryValue,
    confidenceBoost: 0.2,
  },
  // Status
  {
    field: 'status',
    patterns: [
      /Status[\s]*[:#-]\s*(\w+(?:[\s-]\w+)?)/i,
      /Stage[\s]*[:#-]\s*(\w+(?:[\s-]\w+)?)/i,
      /Phase[\s]*[:#-]\s*(\w+(?:[\s-]\w+)?)/i,
      /State[\s]*[:#-]\s*(\w+(?:[\s-]\w+)?)/i,
    ],
    processor: normalizeStatus,
    confidenceBoost: 0.15,
  },
  // Owner
  {
    field: 'owner',
    patterns: [
      /Owner[\s]*[:#-]\s*([^\n]+)/i,
      /(?:Sales\s+)?Rep(?:resentative)?[\s]*[:#-]\s*([^\n]+)/i,
      /Assigned[\s]+(?:to)?[\s]*[:#-]\s*([^\n]+)/i,
      /(?:Account\s+)?Manager[\s]*[:#-]\s*([^\n]+)/i,
    ],
    processor: (val) => val.trim(),
    confidenceBoost: 0.1,
  },
  // Expected Close Date
  {
    field: 'expectedCloseDate',
    patterns: [
      /(?:Expected\s+)?Close[\s]*(?:Date)?[\s]*[:#-]\s*([^\n]+)/i,
      /(?:Expected\s+)?Closing[\s]*[:#-]\s*([^\n]+)/i,
      /Target[\s]+Date[\s]*[:#-]\s*([^\n]+)/i,
      /Due[\s]+Date[\s]*[:#-]\s*([^\n]+)/i,
      /Timeline[\s]*[:#-]\s*([^\n]+)/i,
    ],
    processor: parseDate,
    confidenceBoost: 0.1,
  },
  // Probability
  {
    field: 'probability',
    patterns: [
      /Probability[\s]*[:#-]\s*(\d+)\s*%?/i,
      /(?:Win\s+)?Likelihood[\s]*[:#-]\s*(\d+)\s*%?/i,
      /Confidence[\s]*[:#-]\s*(\d+)\s*%?/i,
      /(\d+)\s*%\s+(?:probability|likely|chance)/i,
    ],
    processor: (val) => Math.min(100, Math.max(0, parseInt(val, 10))),
    confidenceBoost: 0.1,
  },
  // Decision Maker
  {
    field: 'decisionMaker',
    patterns: [
      /Decision[\s-]*Maker[\s]*[:#-]\s*([^\n]+)/i,
      /(?:Key\s+)?Contact[\s]*[:#-]\s*([^\n]+)/i,
      /(?:Primary\s+)?Stakeholder[\s]*[:#-]\s*([^\n]+)/i,
      /Champion[\s]*[:#-]\s*([^\n]+)/i,
    ],
    processor: (val) => val.trim(),
    confidenceBoost: 0.1,
  },
  // Description
  {
    field: 'description',
    patterns: [
      /Description[\s]*[:#-]\s*([^\n]+(?:\n(?![A-Z][a-z]*[\s]*[:#-])[^\n]+)*)/i,
      /Notes?[\s]*[:#-]\s*([^\n]+(?:\n(?![A-Z][a-z]*[\s]*[:#-])[^\n]+)*)/i,
      /Details?[\s]*[:#-]\s*([^\n]+(?:\n(?![A-Z][a-z]*[\s]*[:#-])[^\n]+)*)/i,
      /Summary[\s]*[:#-]\s*([^\n]+(?:\n(?![A-Z][a-z]*[\s]*[:#-])[^\n]+)*)/i,
    ],
    processor: (val) => val.trim().replace(/\n\s+/g, ' '),
    confidenceBoost: 0.05,
  },
];

/**
 * Parse monetary value from string
 */
function parseMonetaryValue(value: string, suffix?: string): number | undefined {
  if (!value) return undefined;

  // Remove commas and parse
  let num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num)) return undefined;

  // Apply suffix multiplier
  const multiplierSuffix = suffix?.toLowerCase() || '';
  if (multiplierSuffix === 'k') {
    num *= 1000;
  } else if (multiplierSuffix === 'm') {
    num *= 1000000;
  }

  return num;
}

/**
 * Normalize status value
 */
function normalizeStatus(value: string): string {
  const normalized = value.toLowerCase().trim();

  // Status mapping
  const statusMap: Record<string, string> = {
    'new': 'registered',
    'open': 'registered',
    'active': 'approved',
    'qualified': 'qualified',
    'discovery': 'discovery',
    'proposal': 'proposal',
    'negotiation': 'negotiation',
    'negotiating': 'negotiation',
    'closed won': 'closed-won',
    'closed-won': 'closed-won',
    'won': 'closed-won',
    'closed lost': 'closed-lost',
    'closed-lost': 'closed-lost',
    'lost': 'closed-lost',
    'pending': 'pending',
    'approved': 'approved',
    'rejected': 'rejected',
  };

  return statusMap[normalized] || value.trim();
}

/**
 * Parse date from various formats
 */
function parseDate(value: string): Date | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();

  // Try various formats
  const formats = [
    // MM/DD/YYYY or M/D/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    // DD/MM/YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    // YYYY-MM-DD
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    // Month DD, YYYY
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  ];

  // Try standard Date parsing first
  const standardDate = new Date(trimmed);
  if (!isNaN(standardDate.getTime())) {
    return standardDate;
  }

  // Try quarter references
  const quarterMatch = trimmed.match(/Q([1-4])\s+(\d{4})/i);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1], 10);
    const year = parseInt(quarterMatch[2], 10);
    const month = (quarter - 1) * 3 + 2; // End of quarter
    return new Date(year, month, 30);
  }

  return undefined;
}

/**
 * DealExtractor class
 */
export class DealExtractor {
  private options: Required<ExtractionOptions>;

  constructor(options: ExtractionOptions = {}) {
    this.options = { ...DEFAULT_EXTRACTION_OPTIONS, ...options };
  }

  /**
   * Extract deals from text using boundaries
   */
  async extractDeals(
    text: string,
    boundaries: DealBoundary[]
  ): Promise<ExtractionResult> {
    const warnings: string[] = [];
    const deals: ExtractedDeal[] = [];

    logger.debug('Starting deal extraction', { boundaryCount: boundaries.length });

    for (const boundary of boundaries) {
      const content = text.substring(boundary.startIndex, boundary.endIndex);

      try {
        const deal = this.extractDeal(content, boundary);

        if (deal && deal.dealName) {
          deals.push(deal);
        } else {
          warnings.push(`Could not extract deal name at index ${boundary.startIndex}`);
        }
      } catch (error) {
        logger.warn('Failed to extract deal', {
          startIndex: boundary.startIndex,
          error: error instanceof Error ? error.message : String(error),
        });
        warnings.push(`Extraction failed at index ${boundary.startIndex}`);
      }
    }

    // Deduplicate if enabled
    let finalDeals = deals;
    let duplicates: ExtractedDeal[] = [];

    if (this.options.deduplicate) {
      const deduped = this.deduplicateDeals(deals);
      finalDeals = deduped.unique;
      duplicates = deduped.duplicates;

      if (duplicates.length > 0) {
        logger.info(`Removed ${duplicates.length} duplicate deal(s)`);
      }
    }

    // Filter by minimum confidence
    finalDeals = finalDeals.filter(d => d.confidence >= this.options.minConfidence);

    // Calculate statistics
    const statistics = this.calculateStatistics(finalDeals, duplicates);

    logger.info('Deal extraction complete', {
      totalDeals: finalDeals.length,
      duplicatesRemoved: duplicates.length,
      averageConfidence: statistics.averageConfidence.toFixed(2),
    });

    return {
      deals: finalDeals,
      duplicates,
      statistics,
      warnings,
    };
  }

  /**
   * Extract a single deal from text
   */
  extractDeal(text: string, boundary: DealBoundary): ExtractedDeal {
    const fieldConfidences: Record<string, number> = {};
    let baseConfidence = boundary.confidence;
    let fieldsExtracted = 0;

    // Extract each field
    const result: Partial<ExtractedDeal> = {};

    for (const fieldPattern of FIELD_PATTERNS) {
      // Skip if field is filtered out
      if (this.options.fields.length > 0 &&
          !this.options.fields.includes(fieldPattern.field)) {
        continue;
      }

      const extracted = this.extractField(text, fieldPattern);

      if (extracted !== undefined && extracted !== null && extracted !== '') {
        (result as any)[fieldPattern.field] = extracted;
        fieldConfidences[fieldPattern.field] = 0.8 + (fieldPattern.confidenceBoost || 0);
        baseConfidence += fieldPattern.confidenceBoost || 0;
        fieldsExtracted++;
      }
    }

    // If no deal name found, try to infer one
    if (!result.dealName) {
      result.dealName = this.inferDealName(text);
      if (result.dealName) {
        fieldConfidences['dealName'] = 0.5;
        fieldsExtracted++;
      }
    }

    // Calculate final confidence
    const confidence = Math.min(1, baseConfidence);

    return {
      dealName: result.dealName || 'Unknown Deal',
      customerName: result.customerName,
      dealValue: result.dealValue as number | undefined,
      currency: result.dealValue ? 'USD' : undefined,
      status: result.status,
      owner: result.owner,
      expectedCloseDate: result.expectedCloseDate as Date | undefined,
      probability: result.probability as number | undefined,
      decisionMaker: result.decisionMaker,
      description: result.description,
      confidence,
      fieldConfidences,
      sourceLocation: {
        startIndex: boundary.startIndex,
        endIndex: boundary.endIndex,
        sourceFile: this.options.sourceFile,
        startLine: boundary.startLine,
        endLine: boundary.endLine,
      },
      rawText: text.substring(0, 500), // First 500 chars
      extractionMetadata: {
        method: boundary.detectionMethod,
        extractedAt: new Date(),
        fieldsExtracted,
        fieldsTotal: FIELD_PATTERNS.length,
      },
    };
  }

  /**
   * Extract a single field using patterns
   */
  private extractField(text: string, fieldPattern: FieldPattern): any {
    for (const pattern of fieldPattern.patterns) {
      const match = text.match(pattern);

      if (match && match[1]) {
        try {
          if (fieldPattern.processor) {
            // Pass primary capture group and optional secondary group (e.g., for K/M suffix)
            return fieldPattern.processor(match[1], match[2]);
          }
          return match[1].trim();
        } catch (error) {
          logger.debug(`Field processing failed for ${fieldPattern.field}`, { error });
        }
      }
    }

    return undefined;
  }

  /**
   * Infer deal name from text when not explicitly found
   */
  private inferDealName(text: string): string | undefined {
    // Try first non-empty line
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const firstLine = lines[0].trim();

      // Check if it's a reasonable name (not too long, has letters)
      if (firstLine.length < 100 && /[a-zA-Z]{3,}/.test(firstLine)) {
        // Remove common prefixes
        const cleaned = firstLine
          .replace(/^[\d.)\-•]\s*/, '')  // Remove list markers
          .replace(/^Deal[\s:#-]*/i, '')
          .replace(/^Opportunity[\s:#-]*/i, '')
          .trim();

        if (cleaned.length > 2) {
          return cleaned;
        }
      }
    }

    // Try to find company name pattern
    const companyMatch = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|LLC|Ltd|Co)\.?)/);
    if (companyMatch) {
      return companyMatch[1];
    }

    // Try to find capitalized phrase
    const capitalMatch = text.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,4})\s*$/m);
    if (capitalMatch && capitalMatch[1].length < 60) {
      return capitalMatch[1];
    }

    return undefined;
  }

  /**
   * Deduplicate deals based on similarity
   */
  private deduplicateDeals(deals: ExtractedDeal[]): {
    unique: ExtractedDeal[];
    duplicates: ExtractedDeal[];
  } {
    const unique: ExtractedDeal[] = [];
    const duplicates: ExtractedDeal[] = [];

    for (const deal of deals) {
      let isDuplicate = false;

      for (const existing of unique) {
        const similarity = this.calculateSimilarity(deal, existing);

        if (similarity >= this.options.deduplicationThreshold) {
          isDuplicate = true;
          duplicates.push(deal);

          // Keep the one with higher confidence
          if (deal.confidence > existing.confidence) {
            const index = unique.indexOf(existing);
            unique[index] = deal;
            duplicates.pop();
            duplicates.push(existing);
          }

          break;
        }
      }

      if (!isDuplicate) {
        unique.push(deal);
      }
    }

    return { unique, duplicates };
  }

  /**
   * Calculate similarity between two deals
   */
  private calculateSimilarity(deal1: ExtractedDeal, deal2: ExtractedDeal): number {
    let score = 0;
    let weights = 0;

    // Deal name similarity (highest weight)
    if (deal1.dealName && deal2.dealName) {
      const nameSim = this.stringSimilarity(
        deal1.dealName.toLowerCase(),
        deal2.dealName.toLowerCase()
      );
      score += nameSim * 0.4;
      weights += 0.4;
    }

    // Customer name similarity
    if (deal1.customerName && deal2.customerName) {
      const custSim = this.stringSimilarity(
        deal1.customerName.toLowerCase(),
        deal2.customerName.toLowerCase()
      );
      score += custSim * 0.3;
      weights += 0.3;
    }

    // Value similarity
    if (deal1.dealValue && deal2.dealValue) {
      const valueSim = 1 - Math.abs(deal1.dealValue - deal2.dealValue) /
                       Math.max(deal1.dealValue, deal2.dealValue);
      score += valueSim * 0.2;
      weights += 0.2;
    }

    // Status match
    if (deal1.status && deal2.status) {
      const statusSim = deal1.status === deal2.status ? 1 : 0;
      score += statusSim * 0.1;
      weights += 0.1;
    }

    return weights > 0 ? score / weights : 0;
  }

  /**
   * Simple string similarity (Jaccard-like)
   */
  private stringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (!str1 || !str2) return 0;

    // Tokenize
    const tokens1 = new Set(str1.split(/\s+/));
    const tokens2 = new Set(str2.split(/\s+/));

    // Calculate Jaccard similarity
    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);

    return intersection.size / union.size;
  }

  /**
   * Calculate extraction statistics
   */
  private calculateStatistics(
    deals: ExtractedDeal[],
    duplicates: ExtractedDeal[]
  ): ExtractionResult['statistics'] {
    const fieldsExtracted: Record<string, number> = {};

    let totalConfidence = 0;

    for (const deal of deals) {
      totalConfidence += deal.confidence;

      // Count extracted fields
      for (const field of FIELD_PATTERNS.map(p => p.field)) {
        if ((deal as any)[field] !== undefined) {
          fieldsExtracted[field] = (fieldsExtracted[field] || 0) + 1;
        }
      }
    }

    return {
      totalDeals: deals.length,
      duplicatesRemoved: duplicates.length,
      averageConfidence: deals.length > 0 ? totalConfidence / deals.length : 0,
      fieldsExtracted,
    };
  }
}

export default DealExtractor;
