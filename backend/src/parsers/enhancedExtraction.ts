/**
 * Enhanced Deal Extraction Intelligence
 *
 * Advanced extraction algorithms for more accurate deal data from emails and transcripts
 */

import logger from '../utils/logger';

// ============================================================================
// ENHANCED VALUE EXTRACTION
// ============================================================================

export interface ValueContext {
  value: number;
  currency: string;
  confidence: number;
  context: string; // surrounding text
  label?: string; // what this value represents
}

/**
 * Extract monetary values with advanced context analysis
 * Handles: $150k, $1.5M, $2,500,000, "one hundred fifty thousand dollars"
 */
export function extractValueWithContext(text: string): ValueContext[] {
  const results: ValueContext[] = [];
  const lowerText = text.toLowerCase();

  // Pattern 1: Standard currency format with labels
  const labeledPatterns = [
    /(?:deal\s+(?:size|value|amount)|contract\s+value|total\s+value|project\s+(?:budget|cost)|purchase\s+(?:amount|value)|tcv|acv|arr|mrr)[:\s]+\$?\s?([\d,]+(?:\.\d{2})?)\s?(?:million|m|thousand|k)?/gi,
    /\$\s?([\d,]+(?:\.\d{2})?)\s?(million|m|thousand|k)?\s+(?:deal|contract|project|opportunity|order|purchase)/gi,
  ];

  for (const pattern of labeledPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const numStr = match[1].replace(/,/g, '');
      let value = parseFloat(numStr);
      const multiplier = match[2]?.toLowerCase();

      if (multiplier && (multiplier.startsWith('m') || multiplier === 'million')) {
        value *= 1000000;
      } else if (multiplier && (multiplier === 'k' || multiplier === 'thousand')) {
        value *= 1000;
      }

      if (!isNaN(value) && value > 0) {
        // Get context (50 chars before and after)
        const startIdx = Math.max(0, match.index! - 50);
        const endIdx = Math.min(text.length, match.index! + match[0].length + 50);
        const context = text.substring(startIdx, endIdx);

        results.push({
          value,
          currency: 'USD',
          confidence: 0.9, // High confidence due to label
          context,
          label: 'deal_value'
        });
      }
    }
  }

  // Pattern 2: Abbreviated format ($150k, $1.5M, $2M)
  const abbreviatedPattern = /\$\s?([\d.]+)\s?(k|m|million|thousand)/gi;
  const abbMatches = [...text.matchAll(abbreviatedPattern)];
  for (const match of abbMatches) {
    const num = parseFloat(match[1]);
    const multiplier = match[2].toLowerCase();
    let value = num;

    if (multiplier.startsWith('m') || multiplier === 'million') {
      value *= 1000000;
    } else if (multiplier === 'k' || multiplier === 'thousand') {
      value *= 1000;
    }

    if (!isNaN(value) && value > 0) {
      const startIdx = Math.max(0, match.index! - 50);
      const endIdx = Math.min(text.length, match.index! + match[0].length + 50);
      const context = text.substring(startIdx, endIdx);

      results.push({
        value,
        currency: 'USD',
        confidence: 0.8,
        context,
        label: 'estimated_value'
      });
    }
  }

  // Pattern 3: Written numbers ("one hundred fifty thousand dollars")
  const writtenAmounts = extractWrittenNumbers(text);
  results.push(...writtenAmounts);

  // Pattern 4: Large currency amounts without labels
  const largeAmountPattern = /\$\s?([\d,]+(?:\.\d{2})?)/g;
  const amountMatches = [...text.matchAll(largeAmountPattern)];
  for (const match of amountMatches) {
    const value = parseFloat(match[1].replace(/,/g, ''));

    // Only include if value seems like a deal value (> $1,000)
    if (!isNaN(value) && value >= 1000) {
      const startIdx = Math.max(0, match.index! - 50);
      const endIdx = Math.min(text.length, match.index! + match[0].length + 50);
      const context = text.substring(startIdx, endIdx);

      // Check if this value is already captured with higher confidence
      const isDuplicate = results.some(r =>
        Math.abs(r.value - value) < 100 && r.confidence > 0.7
      );

      if (!isDuplicate) {
        results.push({
          value,
          currency: 'USD',
          confidence: 0.6, // Lower confidence without label
          context,
          label: 'possible_value'
        });
      }
    }
  }

  // Return highest confidence value, or largest value if confidence is similar
  return results.sort((a, b) => {
    if (Math.abs(a.confidence - b.confidence) < 0.2) {
      return b.value - a.value; // Sort by value if confidence similar
    }
    return b.confidence - a.confidence; // Otherwise sort by confidence
  });
}

/**
 * Extract written number amounts
 */
function extractWrittenNumbers(text: string): ValueContext[] {
  const results: ValueContext[] = [];
  const numberWords: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50,
    'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
    'hundred': 100, 'thousand': 1000, 'million': 1000000
  };

  // Pattern: "one hundred fifty thousand dollars"
  const pattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and|\s)+dollars?\b/gi;
  const matches = [...text.matchAll(pattern)];

  for (const match of matches) {
    const words = match[0].toLowerCase().split(/\s+/);
    let value = 0;
    let current = 0;

    for (const word of words) {
      if (numberWords[word]) {
        if (word === 'hundred') {
          current *= 100;
        } else if (word === 'thousand') {
          value += current * 1000;
          current = 0;
        } else if (word === 'million') {
          value += current * 1000000;
          current = 0;
        } else {
          current += numberWords[word];
        }
      }
    }
    value += current;

    if (value > 0) {
      const startIdx = Math.max(0, match.index! - 50);
      const endIdx = Math.min(text.length, match.index! + match[0].length + 50);
      const context = text.substring(startIdx, endIdx);

      results.push({
        value,
        currency: 'USD',
        confidence: 0.7,
        context,
        label: 'written_amount'
      });
    }
  }

  return results;
}

// ============================================================================
// ENHANCED CUSTOMER/COMPANY EXTRACTION
// ============================================================================

export interface CompanyMatch {
  name: string;
  confidence: number;
  context: string;
  type: 'customer' | 'vendor' | 'partner' | 'unknown';
}

/**
 * Extract company names with context and role identification
 */
export function extractCompaniesWithContext(text: string): CompanyMatch[] {
  const companies: CompanyMatch[] = [];

  // Pattern 1: Labeled customer references
  const customerPatterns = [
    /(?:customer|client|end[- ]user|end[- ]customer)(?:\s+is|\s+name)?[:\s]+([A-Z][A-Za-z0-9\s&.,'-]{2,50}?)(?:\.|,|;|\s+will|\s+has|\s+is|\s+based|\s+located|$)/gi,
    /(?:for|with)\s+([A-Z][A-Za-z0-9\s&]{2,40}?)\s+(?:customer|client|company|corporation|inc|llc)/gi,
    /([A-Z][A-Za-z0-9\s&]{2,40}?)\s+(?:is|are)\s+(?:our|the)\s+(?:customer|client|end[- ]user)/gi,
  ];

  for (const pattern of customerPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const name = match[1].trim();
      if (isValidCompanyName(name)) {
        const startIdx = Math.max(0, match.index! - 50);
        const endIdx = Math.min(text.length, match.index! + match[0].length + 50);
        const context = text.substring(startIdx, endIdx);

        companies.push({
          name: cleanCompanyName(name),
          confidence: 0.9,
          context,
          type: 'customer'
        });
      }
    }
  }

  // Pattern 2: Company suffixes (Inc, LLC, Corp, etc.)
  const companySuffixPattern = /\b([A-Z][A-Za-z0-9\s&.,'-]{2,50}?)\s+(Inc\.?|LLC|Corp\.?|Corporation|Ltd\.?|Limited|Co\.?|Company|Group|Partners|Solutions|Technologies|Systems|Services|Enterprises)\b/g;
  const suffixMatches = [...text.matchAll(companySuffixPattern)];

  for (const match of suffixMatches) {
    const name = match[1].trim() + ' ' + match[2];
    if (isValidCompanyName(name)) {
      const startIdx = Math.max(0, match.index! - 50);
      const endIdx = Math.min(text.length, match.index! + match[0].length + 50);
      const context = text.substring(startIdx, endIdx);

      // Determine type from context
      const contextLower = context.toLowerCase();
      let type: 'customer' | 'vendor' | 'partner' | 'unknown' = 'unknown';
      if (contextLower.includes('customer') || contextLower.includes('client') || contextLower.includes('end user')) {
        type = 'customer';
      } else if (contextLower.includes('vendor') || contextLower.includes('supplier')) {
        type = 'vendor';
      } else if (contextLower.includes('partner')) {
        type = 'partner';
      }

      companies.push({
        name: cleanCompanyName(name),
        confidence: 0.75,
        context,
        type
      });
    }
  }

  // Deduplicate and sort by confidence
  const uniqueCompanies = deduplicateCompanies(companies);
  return uniqueCompanies.sort((a, b) => b.confidence - a.confidence);
}

function isValidCompanyName(name: string): boolean {
  // Filter out common false positives
  const invalidNames = ['the', 'this', 'that', 'their', 'our', 'your', 'my', 'his', 'her'];
  const nameLower = name.toLowerCase().trim();

  if (invalidNames.includes(nameLower)) return false;
  if (name.length < 3 || name.length > 100) return false;
  if (/^\d+$/.test(name)) return false; // Just numbers
  if (name.split(/\s+/).length > 8) return false; // Too many words

  return true;
}

function cleanCompanyName(name: string): string {
  return name
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[,;]$/, '') // Remove trailing punctuation
    .trim();
}

function deduplicateCompanies(companies: CompanyMatch[]): CompanyMatch[] {
  const seen = new Map<string, CompanyMatch>();

  for (const company of companies) {
    const key = company.name.toLowerCase();
    const existing = seen.get(key);

    if (!existing || company.confidence > existing.confidence) {
      seen.set(key, company);
    }
  }

  return Array.from(seen.values());
}

// ============================================================================
// PRODUCT/COMMODITY EXTRACTION
// ============================================================================

export interface ProductMatch {
  product: string;
  category: string;
  confidence: number;
  quantity?: number;
}

/**
 * Extract product/commodity information
 */
export function extractProducts(text: string): ProductMatch[] {
  const products: ProductMatch[] = [];

  // Technology/Software products
  const techPatterns = [
    { pattern: /(?:need|require|looking for|purchase)\s+(\d+)?\s?(servers?|routers?|switches?|firewalls?|storage|backup|database)/gi, category: 'hardware' },
    { pattern: /(cable|cabling|fiber|copper|ethernet|network\s+infrastructure)/gi, category: 'infrastructure' },
    { pattern: /(transformer|power\s+supply|electrical\s+equipment|generators?)/gi, category: 'electrical' },
    { pattern: /(software\s+licenses?|subscriptions?|saas|cloud\s+services)/gi, category: 'software' },
    { pattern: /(consulting|implementation|training|support\s+services)/gi, category: 'services' },
  ];

  for (const { pattern, category } of techPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const quantity = match[1] ? parseInt(match[1]) : undefined;
      const product = match[quantity ? 2 : 1];

      products.push({
        product: product.trim(),
        category,
        confidence: 0.8,
        quantity
      });
    }
  }

  // Deduplicate
  const uniqueProducts = new Map<string, ProductMatch>();
  for (const product of products) {
    const key = product.product.toLowerCase();
    if (!uniqueProducts.has(key) || product.confidence > uniqueProducts.get(key)!.confidence) {
      uniqueProducts.set(key, product);
    }
  }

  return Array.from(uniqueProducts.values());
}

// ============================================================================
// DEAL STAGE/STATUS DETECTION
// ============================================================================

export interface DealStage {
  stage: string;
  confidence: number;
  indicators: string[];
}

/**
 * Detect deal stage from email content
 */
export function detectDealStage(text: string): DealStage {
  const lowerText = text.toLowerCase();

  const stageIndicators = [
    {
      stage: 'closed-won',
      patterns: ['signed', 'closed', 'won', 'po received', 'purchase order', 'executed contract', 'finalized'],
      confidence: 0.95
    },
    {
      stage: 'proposal',
      patterns: ['proposal submitted', 'quote sent', 'rfp response', 'bid submitted'],
      confidence: 0.85
    },
    {
      stage: 'negotiation',
      patterns: ['negotiating', 'discussing terms', 'contract review', 'legal review'],
      confidence: 0.8
    },
    {
      stage: 'qualification',
      patterns: ['qualified', 'discovery call', 'requirements gathering', 'scoping'],
      confidence: 0.75
    },
    {
      stage: 'prospect',
      patterns: ['interested', 'potential', 'lead', 'inquiry'],
      confidence: 0.6
    }
  ];

  for (const { stage, patterns, confidence } of stageIndicators) {
    const matched = patterns.filter(p => lowerText.includes(p));
    if (matched.length > 0) {
      return {
        stage,
        confidence,
        indicators: matched
      };
    }
  }

  return {
    stage: 'unknown',
    confidence: 0.3,
    indicators: []
  };
}

// ============================================================================
// TIMELINE EXTRACTION
// ============================================================================

export interface TimelineInfo {
  closeDate?: Date;
  startDate?: Date;
  durationDays?: number;
  confidence: number;
}

/**
 * Extract timeline information
 */
export function extractTimeline(text: string): TimelineInfo {
  const info: TimelineInfo = { confidence: 0 };

  // Close date patterns
  const closeDatePatterns = [
    /(?:expected\s+close|close\s+date|closing|expected\s+to\s+close)[:\s]+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/gi,
    /(?:by|before|on)\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/gi,
  ];

  for (const pattern of closeDatePatterns) {
    const match = text.match(pattern);
    if (match) {
      const dateStr = match[1];
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        info.closeDate = date;
        info.confidence = 0.8;
        break;
      }
    }
  }

  // Duration patterns
  const durationPattern = /(\d+)[-\s](?:day|week|month|year)\s+(?:project|contract|term|duration)/gi;
  const durationMatch = text.match(durationPattern);
  if (durationMatch) {
    const num = parseInt(durationMatch[1]);
    if (!isNaN(num)) {
      if (durationMatch[0].includes('year')) info.durationDays = num * 365;
      else if (durationMatch[0].includes('month')) info.durationDays = num * 30;
      else if (durationMatch[0].includes('week')) info.durationDays = num * 7;
      else info.durationDays = num;

      info.confidence = Math.max(info.confidence, 0.7);
    }
  }

  return info;
}

// ============================================================================
// ENHANCED CONFIDENCE SCORING
// ============================================================================

export function calculateEnhancedConfidence(data: {
  hasValue: boolean;
  hasCustomer: boolean;
  hasProduct: boolean;
  hasTimeline: boolean;
  hasStage: boolean;
  tier1Keywords: number;
  tier2Keywords: number;
  tier3Keywords: number;
  valueConfidence?: number;
  customerConfidence?: number;
}): number {
  let score = 0;

  // Base score from keywords
  score += data.tier1Keywords * 0.3;
  score += data.tier2Keywords * 0.15;
  score += data.tier3Keywords * 0.05;

  // Bonus for complete data
  if (data.hasValue) score += 0.2;
  if (data.hasCustomer) score += 0.2;
  if (data.hasProduct) score += 0.1;
  if (data.hasTimeline) score += 0.1;
  if (data.hasStage) score += 0.05;

  // Factor in sub-confidence scores
  if (data.valueConfidence) score *= (0.7 + data.valueConfidence * 0.3);
  if (data.customerConfidence) score *= (0.7 + data.customerConfidence * 0.3);

  return Math.min(1.0, score);
}

export default {
  extractValueWithContext,
  extractCompaniesWithContext,
  extractProducts,
  detectDealStage,
  extractTimeline,
  calculateEnhancedConfidence,
};
