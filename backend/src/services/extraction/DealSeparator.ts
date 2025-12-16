/**
 * DealSeparator - Intelligent Deal Boundary Detection
 *
 * This service identifies where individual deals start and end in text.
 * Uses multiple strategies:
 * 1. Keyword-based: Look for "Deal:", "Opportunity:", etc.
 * 2. Pattern-based: Numbered lists, bullet points
 * 3. Structure-based: Blank lines, section breaks
 * 4. Hybrid: Combine signals for higher confidence
 */

import logger from '../../utils/logger';
import {
  DealBoundary,
  DetectionMethod,
  SeparationResult,
  SeparationOptions,
  DEFAULT_SEPARATION_OPTIONS,
} from './types';

/**
 * Keyword tiers for deal detection
 */
const KEYWORD_TIERS = {
  // Tier 1: High confidence - explicit deal markers
  tier1: [
    /^Deal[\s]*[:#-]\s*/im,
    /^Opportunity[\s]*[:#-]\s*/im,
    /^Deal Name[\s]*[:#-]\s*/im,
    /^Opportunity Name[\s]*[:#-]\s*/im,
  ],
  // Tier 2: Medium confidence - related markers
  tier2: [
    /^Account[\s]*[:#-]\s*/im,
    /^Customer[\s]*[:#-]\s*/im,
    /^Prospect[\s]*[:#-]\s*/im,
    /^Lead[\s]*[:#-]\s*/im,
    /^Project[\s]*[:#-]\s*/im,
  ],
  // Tier 3: Lower confidence - potential markers
  tier3: [
    /^Company[\s]*[:#-]\s*/im,
    /^Client[\s]*[:#-]\s*/im,
    /^Partner[\s]*[:#-]\s*/im,
  ],
};

/**
 * Patterns that indicate end of a deal section
 */
const DEAL_END_PATTERNS = [
  /^-{3,}\s*$/m,           // Horizontal rule (---)
  /^={3,}\s*$/m,           // Equals rule (===)
  /^\*{3,}\s*$/m,          // Asterisk rule (***)
  /^#{1,6}\s+/m,           // Markdown headers
  /^Action Items?[\s]*:/im, // Action items section
  /^Next Steps?[\s]*:/im,   // Next steps section
  /^Summary[\s]*:/im,       // Summary section
  /^Notes?[\s]*:/im,        // Notes section
];

/**
 * Numbered/bulleted list patterns
 */
const LIST_PATTERNS = [
  /^(\d+)\.\s+([A-Z])/gm,  // Numbered list starting with capital
  /^[-•]\s+([A-Z])/gm,     // Bullet list starting with capital
  /^\[\d+\]\s+/gm,         // Bracketed numbers [1]
];

/**
 * DealSeparator class
 */
export class DealSeparator {
  private options: Required<SeparationOptions>;

  constructor(options: SeparationOptions = {}) {
    this.options = { ...DEFAULT_SEPARATION_OPTIONS, ...options };
  }

  /**
   * Separate text into deal boundaries
   */
  async separateDeals(text: string): Promise<SeparationResult> {
    const warnings: string[] = [];
    const allBoundaries: DealBoundary[] = [];

    logger.debug('Starting deal separation', { textLength: text.length });

    // Strategy 1: Keyword-based detection
    const keywordBoundaries = this.findKeywordBoundaries(text);
    allBoundaries.push(...keywordBoundaries);

    // Strategy 2: Pattern-based detection (numbered lists, etc.)
    const patternBoundaries = this.findPatternBoundaries(text);
    allBoundaries.push(...patternBoundaries);

    // Strategy 3: Structure-based detection (paragraphs with deal-like content)
    const structureBoundaries = this.findStructureBoundaries(text);
    allBoundaries.push(...structureBoundaries);

    // Merge and reconcile overlapping boundaries
    let finalBoundaries = this.options.mergeOverlapping
      ? this.reconcileBoundaries(allBoundaries, text)
      : allBoundaries;

    // Filter by confidence
    finalBoundaries = finalBoundaries.filter(
      b => b.confidence >= this.options.minConfidence
    );

    // Limit count
    if (finalBoundaries.length > this.options.maxDeals) {
      warnings.push(`Truncated to ${this.options.maxDeals} deals (found ${finalBoundaries.length})`);
      finalBoundaries = finalBoundaries.slice(0, this.options.maxDeals);
    }

    // Validate boundaries (ensure they're reasonable)
    finalBoundaries = this.validateBoundaries(finalBoundaries, text, warnings);

    // Calculate statistics
    const statistics = this.calculateStatistics(finalBoundaries);

    logger.info('Deal separation complete', {
      totalBoundaries: finalBoundaries.length,
      byMethod: statistics.byMethod,
    });

    return {
      boundaries: finalBoundaries,
      statistics,
      warnings,
    };
  }

  /**
   * Find boundaries using keyword detection
   */
  private findKeywordBoundaries(text: string): DealBoundary[] {
    const boundaries: DealBoundary[] = [];
    const lines = text.split('\n');
    let charIndex = 0;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      // Check each tier
      for (const [tier, patterns] of Object.entries(KEYWORD_TIERS)) {
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            const confidence = tier === 'tier1' ? 0.95 : tier === 'tier2' ? 0.8 : 0.65;

            boundaries.push({
              startIndex: charIndex,
              endIndex: charIndex, // Will be updated later
              confidence,
              detectionMethod: 'keyword',
              trigger: line.trim(),
              startLine: lineNum + 1,
            });
            break; // Only count once per line
          }
        }
      }

      charIndex += line.length + 1; // +1 for newline
    }

    // Update end indices
    this.updateEndIndices(boundaries, text.length);

    return boundaries;
  }

  /**
   * Find boundaries using pattern detection (numbered lists, etc.)
   */
  private findPatternBoundaries(text: string): DealBoundary[] {
    const boundaries: DealBoundary[] = [];
    const lines = text.split('\n');
    let charIndex = 0;

    // Look for numbered lists that might be deals
    const numberedPattern = /^(\d+)\.\s+(.+)/;
    let inList = false;
    let listStartIndex = 0;
    let listStartLine = 0;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      const match = line.match(numberedPattern);

      if (match) {
        const content = match[2];
        // Check if this looks like a deal entry (has company-like name or value)
        if (this.looksLikeDealEntry(content)) {
          if (!inList || match[1] === '1') {
            // Start new list or explicit #1
            if (inList) {
              // Close previous
              boundaries.push({
                startIndex: listStartIndex,
                endIndex: charIndex - 1,
                confidence: 0.7,
                detectionMethod: 'pattern',
                trigger: 'numbered_list',
                startLine: listStartLine,
                endLine: lineNum,
              });
            }
            listStartIndex = charIndex;
            listStartLine = lineNum + 1;
            inList = true;
          }
        }
      } else if (inList && line.trim() === '') {
        // End of list on blank line
        boundaries.push({
          startIndex: listStartIndex,
          endIndex: charIndex - 1,
          confidence: 0.7,
          detectionMethod: 'pattern',
          trigger: 'numbered_list',
          startLine: listStartLine,
          endLine: lineNum,
        });
        inList = false;
      }

      charIndex += line.length + 1;
    }

    // Close any open list
    if (inList) {
      boundaries.push({
        startIndex: listStartIndex,
        endIndex: text.length,
        confidence: 0.7,
        detectionMethod: 'pattern',
        trigger: 'numbered_list',
        startLine: listStartLine,
        endLine: lines.length,
      });
    }

    return boundaries;
  }

  /**
   * Find boundaries using structure detection (paragraphs)
   */
  private findStructureBoundaries(text: string): DealBoundary[] {
    const boundaries: DealBoundary[] = [];

    // Split by double newlines (paragraphs)
    const paragraphs = text.split(/\n\n+/);
    let currentIndex = 0;

    for (const para of paragraphs) {
      const trimmed = para.trim();

      if (trimmed && this.looksLikeDealParagraph(trimmed)) {
        // Check if this paragraph isn't already covered by keyword detection
        const hasKeyword = Object.values(KEYWORD_TIERS)
          .flat()
          .some(pattern => pattern.test(trimmed));

        if (!hasKeyword) {
          boundaries.push({
            startIndex: currentIndex,
            endIndex: currentIndex + para.length,
            confidence: 0.5, // Lower confidence for structural detection
            detectionMethod: 'structure',
            startLine: this.getLineNumber(text, currentIndex),
          });
        }
      }

      currentIndex += para.length + 2; // +2 for \n\n
    }

    return boundaries;
  }

  /**
   * Check if text looks like a deal entry
   */
  private looksLikeDealEntry(text: string): boolean {
    // Must have at least some alphabetic content
    if (!/[a-zA-Z]{3,}/.test(text)) return false;

    // Check for company name patterns
    const hasCompanyName = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/.test(text) ||
                          /(?:Inc|Corp|LLC|Ltd|Co)\b/i.test(text);

    // Check for value patterns
    const hasValue = /\$[\d,]+|\d+k|\d+K|\d+\s*(?:million|M)\b/i.test(text);

    return hasCompanyName || hasValue;
  }

  /**
   * Check if a paragraph looks like it contains deal information
   */
  private looksLikeDealParagraph(text: string): boolean {
    const indicators = [
      /\$[\d,]+/,                      // Dollar amounts
      /value|amount|price|deal/i,      // Value keywords
      /customer|client|account/i,      // Customer keywords
      /close|expected|timeline/i,      // Timeline keywords
      /status|stage|phase/i,           // Status keywords
      /(?:Inc|Corp|LLC|Ltd|Co)\b/i,    // Company suffixes
    ];

    const matches = indicators.filter(pattern => pattern.test(text));
    return matches.length >= 2; // Need at least 2 indicators
  }

  /**
   * Update end indices based on next boundary start
   */
  private updateEndIndices(boundaries: DealBoundary[], textLength: number): void {
    // Sort by start index
    boundaries.sort((a, b) => a.startIndex - b.startIndex);

    for (let i = 0; i < boundaries.length; i++) {
      const current = boundaries[i];
      const next = boundaries[i + 1];

      if (next) {
        current.endIndex = next.startIndex;
      } else {
        current.endIndex = textLength;
      }

      // Also update end line if we have start line
      if (current.startLine && next?.startLine) {
        current.endLine = next.startLine - 1;
      }
    }
  }

  /**
   * Reconcile and merge overlapping boundaries
   */
  private reconcileBoundaries(boundaries: DealBoundary[], text: string): DealBoundary[] {
    if (boundaries.length === 0) return [];

    // Sort by start index, then by confidence (higher first)
    boundaries.sort((a, b) => {
      const startDiff = a.startIndex - b.startIndex;
      if (startDiff !== 0) return startDiff;
      return b.confidence - a.confidence;
    });

    const merged: DealBoundary[] = [];
    let current = boundaries[0];

    for (let i = 1; i < boundaries.length; i++) {
      const next = boundaries[i];

      // Check for overlap
      const overlap = current.endIndex > next.startIndex;
      const sameStart = Math.abs(current.startIndex - next.startIndex) < 50;

      if (overlap || sameStart) {
        // Merge: keep the higher confidence one, extend end if needed
        if (next.confidence > current.confidence) {
          current = {
            ...next,
            endIndex: Math.max(current.endIndex, next.endIndex),
          };
        } else {
          current.endIndex = Math.max(current.endIndex, next.endIndex);
        }
        // Boost confidence for hybrid detection
        if (current.detectionMethod !== next.detectionMethod) {
          current.confidence = Math.min(1, current.confidence + 0.1);
          current.detectionMethod = 'hybrid';
        }
      } else {
        // No overlap, save current and move to next
        merged.push(current);
        current = next;
      }
    }

    // Don't forget the last one
    merged.push(current);

    // Update end indices
    this.updateEndIndices(merged, text.length);

    return merged;
  }

  /**
   * Validate boundaries and filter out invalid ones
   */
  private validateBoundaries(
    boundaries: DealBoundary[],
    text: string,
    warnings: string[]
  ): DealBoundary[] {
    return boundaries.filter(boundary => {
      const length = boundary.endIndex - boundary.startIndex;
      const content = text.substring(boundary.startIndex, boundary.endIndex);

      // Too short
      if (length < 20) {
        return false;
      }

      // Too long (likely merged multiple deals)
      if (length > 5000) {
        warnings.push(`Boundary at ${boundary.startIndex} may contain multiple deals (${length} chars)`);
        // Still include it, but warn
      }

      // Must have alphabetic content
      if (!/[a-zA-Z]{5,}/.test(content)) {
        return false;
      }

      // Must have some structure (not just a single line)
      const lineCount = content.split('\n').filter(l => l.trim()).length;
      if (lineCount < 1) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get line number for a character index
   */
  private getLineNumber(text: string, charIndex: number): number {
    return text.substring(0, charIndex).split('\n').length;
  }

  /**
   * Calculate statistics about the separation
   */
  private calculateStatistics(boundaries: DealBoundary[]): SeparationResult['statistics'] {
    const byMethod: Record<DetectionMethod, number> = {
      keyword: 0,
      pattern: 0,
      structure: 0,
      nlp: 0,
      hybrid: 0,
    };

    let totalConfidence = 0;
    let lowConfidenceCount = 0;

    for (const boundary of boundaries) {
      byMethod[boundary.detectionMethod]++;
      totalConfidence += boundary.confidence;
      if (boundary.confidence < 0.5) {
        lowConfidenceCount++;
      }
    }

    return {
      totalBoundaries: boundaries.length,
      byMethod,
      averageConfidence: boundaries.length > 0 ? totalConfidence / boundaries.length : 0,
      lowConfidenceCount,
    };
  }
}

export default DealSeparator;
