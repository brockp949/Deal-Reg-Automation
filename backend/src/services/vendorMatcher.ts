/**
 * Vendor Matching Service
 * Phase 5.1: Enhanced Vendor Matching Engine
 *
 * Implements multi-strategy vendor matching:
 * - Strategy 1: Exact name match (normalized)
 * - Strategy 2: Fuzzy string matching (>80% similarity)
 * - Strategy 3: Email domain matching
 * - Strategy 4: Product/keyword matching
 * - Strategy 5: Contact affiliation inference
 *
 * Returns best match with confidence score (0.0-1.0)
 */

import fuzzball from 'fuzzball';
import { compareTwoStrings } from 'string-similarity';
import pool from '../db';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface VendorMatchContext {
  extractedName?: string;
  emailDomain?: string;
  contactEmail?: string;
  productMentions?: string[];
  keywords?: string[];
  sourceText?: string;
  existingVendors?: any[];
}

export interface VendorMatchResult {
  matched: boolean;
  vendor: any | null;
  confidence: number;
  matchStrategy: string;
  matchDetails?: {
    nameSimilarity?: number;
    domainMatch?: boolean;
    productMatches?: string[];
    keywordMatches?: string[];
    aliasMatch?: string;
  };
  alternativeMatches?: Array<{
    vendor: any;
    confidence: number;
    strategy: string;
  }>;
}

export interface VendorAlias {
  id: string;
  vendorId: string;
  alias: string;
  normalizedAlias: string;
  aliasType: 'abbreviation' | 'subsidiary' | 'product' | 'domain' | 'nickname';
  confidence: number;
  createdAt: Date;
}

// ============================================================================
// Configuration
// ============================================================================

const MATCH_CONFIG = {
  // Confidence thresholds
  EXACT_MATCH_CONFIDENCE: 1.0,
  HIGH_CONFIDENCE_THRESHOLD: 0.9,
  MEDIUM_CONFIDENCE_THRESHOLD: 0.7,
  LOW_CONFIDENCE_THRESHOLD: 0.5,
  MINIMUM_MATCH_THRESHOLD: 0.3,

  // Fuzzy matching thresholds
  FUZZY_EXACT_THRESHOLD: 95, // Fuzzball score (0-100)
  FUZZY_HIGH_THRESHOLD: 85,
  FUZZY_MEDIUM_THRESHOLD: 70,
  FUZZY_LOW_THRESHOLD: 50,

  // String similarity thresholds (0.0-1.0)
  STRING_SIM_EXACT: 0.95,
  STRING_SIM_HIGH: 0.85,
  STRING_SIM_MEDIUM: 0.70,
  STRING_SIM_LOW: 0.50,

  // Strategy weights for combined scoring
  WEIGHTS: {
    NAME_MATCH: 0.40,
    DOMAIN_MATCH: 0.25,
    PRODUCT_MATCH: 0.20,
    KEYWORD_MATCH: 0.10,
    CONTACT_MATCH: 0.05,
  },
};

// ============================================================================
// Core Matching Functions
// ============================================================================

/**
 * Main vendor matching function
 * Tries multiple strategies and returns best match
 */
export async function matchVendor(
  context: VendorMatchContext
): Promise<VendorMatchResult> {
  const { extractedName, emailDomain, contactEmail, productMentions, keywords, existingVendors } = context;

  // Load vendors if not provided
  const vendors = existingVendors || await loadVendors();

  if (vendors.length === 0) {
    return {
      matched: false,
      vendor: null,
      confidence: 0.0,
      matchStrategy: 'no_vendors_available',
    };
  }

  // Try strategies in order of reliability
  const strategies: Array<() => Promise<VendorMatchResult | null>> = [
    // Strategy 1: Exact name match (normalized)
    () => matchByExactName(extractedName, vendors),

    // Strategy 2: Alias match
    () => matchByAlias(extractedName, vendors),

    // Strategy 3: Email domain match
    () => matchByEmailDomain(emailDomain || contactEmail, vendors),

    // Strategy 4: Fuzzy name match
    () => matchByFuzzyName(extractedName, vendors),

    // Strategy 5: Product/keyword match
    () => matchByProducts(productMentions, vendors),

    // Strategy 6: Combined multi-factor match
    () => matchByCombinedFactors(context, vendors),
  ];

  const results: VendorMatchResult[] = [];

  // Execute all strategies and collect results
  for (const strategy of strategies) {
    try {
      const result = await strategy();
      if (result && result.confidence >= MATCH_CONFIG.MINIMUM_MATCH_THRESHOLD) {
        results.push(result);
      }
    } catch (error) {
      console.error('Vendor matching strategy error:', error);
    }
  }

  // No matches found
  if (results.length === 0) {
    return {
      matched: false,
      vendor: null,
      confidence: 0.0,
      matchStrategy: 'no_match',
    };
  }

  // Sort by confidence (descending)
  results.sort((a, b) => b.confidence - a.confidence);

  // Return best match with alternatives
  const bestMatch = results[0];
  const alternatives = results.slice(1, 4).map((r) => ({
    vendor: r.vendor,
    confidence: r.confidence,
    strategy: r.matchStrategy,
  }));

  return {
    ...bestMatch,
    alternativeMatches: alternatives.length > 0 ? alternatives : undefined,
  };
}

/**
 * Match multiple vendor names from text
 * Returns all matches with confidence scores
 */
export async function matchMultipleVendors(
  vendorNames: string[],
  context?: Partial<VendorMatchContext>
): Promise<Array<VendorMatchResult>> {
  const results: VendorMatchResult[] = [];

  for (const name of vendorNames) {
    const result = await matchVendor({
      ...context,
      extractedName: name,
    });

    if (result.matched) {
      results.push(result);
    }
  }

  return results;
}

// ============================================================================
// Strategy 1: Exact Name Match (Normalized)
// ============================================================================

async function matchByExactName(
  extractedName: string | undefined,
  vendors: any[]
): Promise<VendorMatchResult | null> {
  if (!extractedName) return null;

  const normalized = normalizeName(extractedName);

  for (const vendor of vendors) {
    const vendorNormalized = normalizeName(vendor.name);

    if (normalized === vendorNormalized) {
      return {
        matched: true,
        vendor,
        confidence: MATCH_CONFIG.EXACT_MATCH_CONFIDENCE,
        matchStrategy: 'exact_name',
        matchDetails: {
          nameSimilarity: 1.0,
        },
      };
    }
  }

  return null;
}

// ============================================================================
// Strategy 2: Alias Match
// ============================================================================

async function matchByAlias(
  extractedName: string | undefined,
  vendors: any[]
): Promise<VendorMatchResult | null> {
  if (!extractedName) return null;

  const normalized = normalizeName(extractedName);

  // Query alias table
  const aliasResult = await pool.query(
    `SELECT va.*, v.*
     FROM vendor_aliases va
     JOIN vendors v ON va.vendor_id = v.id
     WHERE va.normalized_alias = $1
     ORDER BY va.confidence DESC
     LIMIT 1`,
    [normalized]
  );

  if (aliasResult.rows.length > 0) {
    const row = aliasResult.rows[0];
    const vendor = {
      id: row.vendor_id,
      name: row.name,
      // ... other vendor fields
    };

    return {
      matched: true,
      vendor,
      confidence: row.confidence || 0.95,
      matchStrategy: 'alias_match',
      matchDetails: {
        aliasMatch: row.alias,
      },
    };
  }

  return null;
}

// ============================================================================
// Strategy 3: Email Domain Match
// ============================================================================

async function matchByEmailDomain(
  email: string | undefined,
  vendors: any[]
): Promise<VendorMatchResult | null> {
  if (!email) return null;

  // Extract domain from email
  const domain = extractDomain(email);
  if (!domain) return null;

  const normalizedDomain = domain.toLowerCase();

  // Check vendor email_domains array
  for (const vendor of vendors) {
    if (vendor.email_domains && Array.isArray(vendor.email_domains)) {
      const vendorDomains = vendor.email_domains.map((d: string) => d.toLowerCase());

      if (vendorDomains.includes(normalizedDomain)) {
        return {
          matched: true,
          vendor,
          confidence: 0.90,
          matchStrategy: 'email_domain',
          matchDetails: {
            domainMatch: true,
          },
        };
      }
    }
  }

  return null;
}

// ============================================================================
// Strategy 4: Fuzzy Name Match
// ============================================================================

async function matchByFuzzyName(
  extractedName: string | undefined,
  vendors: any[]
): Promise<VendorMatchResult | null> {
  if (!extractedName) return null;

  const normalized = normalizeName(extractedName);

  let bestMatch: any = null;
  let bestScore = 0;
  let bestSimilarity = 0;

  for (const vendor of vendors) {
    const vendorNormalized = normalizeName(vendor.name);

    // Use fuzzball for fuzzy matching (returns 0-100)
    const fuzzyScore = fuzzball.ratio(normalized, vendorNormalized);

    // Also use string-similarity for comparison (returns 0.0-1.0)
    const stringSim = compareTwoStrings(normalized, vendorNormalized);

    // Average the two approaches (convert fuzzy to 0-100 scale)
    const combinedScore = (fuzzyScore + stringSim * 100) / 2;

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestSimilarity = stringSim;
      bestMatch = vendor;
    }
  }

  // Determine confidence based on score
  if (bestScore >= MATCH_CONFIG.FUZZY_EXACT_THRESHOLD) {
    return {
      matched: true,
      vendor: bestMatch,
      confidence: 0.98,
      matchStrategy: 'fuzzy_exact',
      matchDetails: {
        nameSimilarity: bestSimilarity,
      },
    };
  } else if (bestScore >= MATCH_CONFIG.FUZZY_HIGH_THRESHOLD) {
    return {
      matched: true,
      vendor: bestMatch,
      confidence: 0.85,
      matchStrategy: 'fuzzy_high',
      matchDetails: {
        nameSimilarity: bestSimilarity,
      },
    };
  } else if (bestScore >= MATCH_CONFIG.FUZZY_MEDIUM_THRESHOLD) {
    return {
      matched: true,
      vendor: bestMatch,
      confidence: 0.70,
      matchStrategy: 'fuzzy_medium',
      matchDetails: {
        nameSimilarity: bestSimilarity,
      },
    };
  } else if (bestScore >= MATCH_CONFIG.FUZZY_LOW_THRESHOLD) {
    return {
      matched: true,
      vendor: bestMatch,
      confidence: 0.50,
      matchStrategy: 'fuzzy_low',
      matchDetails: {
        nameSimilarity: bestSimilarity,
      },
    };
  }

  return null;
}

// ============================================================================
// Strategy 5: Product/Keyword Match
// ============================================================================

async function matchByProducts(
  productMentions: string[] | undefined,
  vendors: any[]
): Promise<VendorMatchResult | null> {
  if (!productMentions || productMentions.length === 0) return null;

  const normalizedProducts = productMentions.map((p) => normalizeName(p));

  let bestMatch: any = null;
  let bestMatchCount = 0;
  let matchedProducts: string[] = [];

  for (const vendor of vendors) {
    if (!vendor.product_keywords || vendor.product_keywords.length === 0) {
      continue;
    }

    const vendorKeywords = vendor.product_keywords.map((k: string) => normalizeName(k));

    let matchCount = 0;
    const matched: string[] = [];

    for (const product of normalizedProducts) {
      for (const keyword of vendorKeywords) {
        // Check for exact match or substring match
        if (product.includes(keyword) || keyword.includes(product)) {
          matchCount++;
          matched.push(product);
          break;
        }

        // Fuzzy match for product names
        const fuzzyScore = fuzzball.ratio(product, keyword);
        if (fuzzyScore >= MATCH_CONFIG.FUZZY_HIGH_THRESHOLD) {
          matchCount++;
          matched.push(product);
          break;
        }
      }
    }

    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestMatch = vendor;
      matchedProducts = matched;
    }
  }

  if (bestMatchCount > 0) {
    // Confidence based on match ratio
    const confidence = Math.min(0.85, 0.5 + (bestMatchCount / productMentions.length) * 0.35);

    return {
      matched: true,
      vendor: bestMatch,
      confidence,
      matchStrategy: 'product_match',
      matchDetails: {
        productMatches: matchedProducts,
      },
    };
  }

  return null;
}

// ============================================================================
// Strategy 6: Combined Multi-Factor Match
// ============================================================================

async function matchByCombinedFactors(
  context: VendorMatchContext,
  vendors: any[]
): Promise<VendorMatchResult | null> {
  const { extractedName, emailDomain, contactEmail, productMentions, keywords } = context;

  let bestVendor: any = null;
  let bestScore = 0;
  let bestDetails: any = {};

  for (const vendor of vendors) {
    let score = 0;
    const details: any = {};

    // Factor 1: Name similarity
    if (extractedName) {
      const normalized = normalizeName(extractedName);
      const vendorNormalized = normalizeName(vendor.name);
      const nameSim = compareTwoStrings(normalized, vendorNormalized);
      details.nameSimilarity = nameSim;
      score += nameSim * MATCH_CONFIG.WEIGHTS.NAME_MATCH;
    }

    // Factor 2: Domain match
    const domain = extractDomain(emailDomain || contactEmail || '');
    if (domain && vendor.email_domains && vendor.email_domains.includes(domain.toLowerCase())) {
      details.domainMatch = true;
      score += MATCH_CONFIG.WEIGHTS.DOMAIN_MATCH;
    }

    // Factor 3: Product match
    if (productMentions && productMentions.length > 0 && vendor.product_keywords) {
      const productScore = calculateProductMatchScore(productMentions, vendor.product_keywords);
      details.productMatchScore = productScore;
      score += productScore * MATCH_CONFIG.WEIGHTS.PRODUCT_MATCH;
    }

    // Factor 4: Keyword match
    if (keywords && keywords.length > 0 && vendor.product_keywords) {
      const keywordScore = calculateProductMatchScore(keywords, vendor.product_keywords);
      details.keywordMatchScore = keywordScore;
      score += keywordScore * MATCH_CONFIG.WEIGHTS.KEYWORD_MATCH;
    }

    if (score > bestScore) {
      bestScore = score;
      bestVendor = vendor;
      bestDetails = details;
    }
  }

  if (bestScore >= MATCH_CONFIG.MINIMUM_MATCH_THRESHOLD) {
    return {
      matched: true,
      vendor: bestVendor,
      confidence: Math.min(0.95, bestScore),
      matchStrategy: 'combined_factors',
      matchDetails: bestDetails,
    };
  }

  return null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize vendor name for comparison
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b/g, '') // Remove common suffixes
    .trim();
}

/**
 * Extract domain from email address
 */
export function extractDomain(email: string): string | null {
  if (!email) return null;

  const match = email.match(/@([a-z0-9.-]+\.[a-z]{2,})$/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Calculate product match score
 */
function calculateProductMatchScore(mentions: string[], keywords: string[]): number {
  if (mentions.length === 0 || keywords.length === 0) return 0;

  const normalizedMentions = mentions.map((m) => normalizeName(m));
  const normalizedKeywords = keywords.map((k) => normalizeName(k));

  let matches = 0;

  for (const mention of normalizedMentions) {
    for (const keyword of normalizedKeywords) {
      if (mention.includes(keyword) || keyword.includes(mention)) {
        matches++;
        break;
      }
    }
  }

  return matches / mentions.length;
}

/**
 * Load all vendors from database
 */
async function loadVendors(): Promise<any[]> {
  const result = await pool.query(`
    SELECT
      id,
      name,
      email_domains,
      product_keywords,
      matching_rules,
      status,
      tier
    FROM vendors
    WHERE status != 'rejected'
    ORDER BY name ASC
  `);

  return result.rows;
}

// ============================================================================
// Vendor Alias Management
// ============================================================================

/**
 * Add vendor alias
 */
export async function addVendorAlias(
  vendorId: string,
  alias: string,
  aliasType: 'abbreviation' | 'subsidiary' | 'product' | 'domain' | 'nickname',
  confidence: number = 1.0
): Promise<VendorAlias> {
  const normalizedAlias = normalizeName(alias);

  const result = await pool.query(
    `INSERT INTO vendor_aliases (vendor_id, alias, normalized_alias, alias_type, confidence)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [vendorId, alias, normalizedAlias, aliasType, confidence]
  );

  return result.rows[0];
}

/**
 * Get all aliases for a vendor
 */
export async function getVendorAliases(vendorId: string): Promise<VendorAlias[]> {
  const result = await pool.query(
    `SELECT * FROM vendor_aliases WHERE vendor_id = $1 ORDER BY confidence DESC, created_at DESC`,
    [vendorId]
  );

  return result.rows;
}

/**
 * Remove vendor alias
 */
export async function removeVendorAlias(aliasId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM vendor_aliases WHERE id = $1`, [aliasId]);
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Suggest aliases from unmatched vendor names
 */
export async function suggestAliases(unmatchedName: string): Promise<Array<{ vendor: any; confidence: number }>> {
  const vendors = await loadVendors();
  const suggestions: Array<{ vendor: any; confidence: number }> = [];

  const normalized = normalizeName(unmatchedName);

  for (const vendor of vendors) {
    const vendorNormalized = normalizeName(vendor.name);

    // Use fuzzy matching to find potential matches
    const fuzzyScore = fuzzball.ratio(normalized, vendorNormalized);

    // Suggest if score is between 50-85 (not exact, but similar)
    if (fuzzyScore >= 50 && fuzzyScore < 85) {
      suggestions.push({
        vendor,
        confidence: fuzzyScore / 100,
      });
    }
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions.slice(0, 5); // Top 5 suggestions
}

// ============================================================================
// Vendor Inference (Phase 5.2)
// ============================================================================

/**
 * Infer vendor from contact email domain
 */
export async function inferVendorFromContact(contactEmail: string): Promise<VendorMatchResult> {
  return matchVendor({
    contactEmail,
    emailDomain: extractDomain(contactEmail) || undefined,
  });
}

/**
 * Infer vendor from product mentions in text
 */
export async function inferVendorFromProducts(products: string[]): Promise<VendorMatchResult> {
  return matchVendor({
    productMentions: products,
  });
}

/**
 * Learn vendor associations from historical data
 * This function analyzes past successful matches to improve future matching
 */
export async function learnVendorPatterns(): Promise<{
  patternsLearned: number;
  aliasesCreated: number;
}> {
  // Query successful vendor matches with high confidence
  const result = await pool.query(`
    SELECT
      ee.vendor_id,
      ee.raw_value,
      COUNT(*) as frequency
    FROM extracted_entities ee
    JOIN deal_registrations dr ON dr.id = ee.entity_id
    WHERE
      ee.entity_type = 'vendor'
      AND ee.vendor_id IS NOT NULL
      AND ee.ai_confidence_score >= 0.85
      AND ee.validation_status = 'passed'
    GROUP BY ee.vendor_id, ee.raw_value
    HAVING COUNT(*) >= 3
    ORDER BY frequency DESC
  `);

  let aliasesCreated = 0;

  for (const row of result.rows) {
    const vendorId = row.vendor_id;
    const rawValue = row.raw_value;

    // Check if this alias already exists
    const existingAlias = await pool.query(
      `SELECT id FROM vendor_aliases WHERE vendor_id = $1 AND normalized_alias = $2`,
      [vendorId, normalizeName(rawValue)]
    );

    if (existingAlias.rows.length === 0) {
      // Create new alias with confidence based on frequency
      const confidence = Math.min(0.95, 0.7 + (row.frequency / 10) * 0.25);

      await addVendorAlias(vendorId, rawValue, 'nickname', confidence);
      aliasesCreated++;
    }
  }

  return {
    patternsLearned: result.rows.length,
    aliasesCreated,
  };
}

/**
 * Get vendor matching statistics
 */
export async function getMatchingStatistics(): Promise<{
  totalMatches: number;
  matchesByStrategy: Record<string, number>;
  averageConfidence: number;
  unmatchedCount: number;
}> {
  // This would query from extraction logs in a real implementation
  // For now, return placeholder structure

  const result = await pool.query(`
    SELECT
      extraction_metadata->>'matchStrategy' as strategy,
      COUNT(*) as count,
      AVG((extraction_metadata->>'matchConfidence')::decimal) as avg_confidence
    FROM extracted_entities
    WHERE
      entity_type = 'vendor'
      AND extraction_metadata->>'matchStrategy' IS NOT NULL
    GROUP BY extraction_metadata->>'matchStrategy'
  `);

  const matchesByStrategy: Record<string, number> = {};
  let totalMatches = 0;
  let totalConfidence = 0;

  for (const row of result.rows) {
    const strategy = row.strategy;
    const count = parseInt(row.count, 10);
    matchesByStrategy[strategy] = count;
    totalMatches += count;
    totalConfidence += parseFloat(row.avg_confidence) * count;
  }

  const averageConfidence = totalMatches > 0 ? totalConfidence / totalMatches : 0;

  return {
    totalMatches,
    matchesByStrategy,
    averageConfidence,
    unmatchedCount: 0, // Would query unmatched vendor names
  };
}

export default {
  matchVendor,
  matchMultipleVendors,
  normalizeName,
  extractDomain,
  addVendorAlias,
  getVendorAliases,
  removeVendorAlias,
  suggestAliases,
  inferVendorFromContact,
  inferVendorFromProducts,
  learnVendorPatterns,
  getMatchingStatistics,
};
