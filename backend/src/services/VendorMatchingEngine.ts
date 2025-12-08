/**
 * Unified Vendor Matching Engine
 * Consolidates all vendor matching logic into a single, cacheable service.
 *
 * Strategies (in order of priority):
 * 1. Exact name match
 * 2. Normalized name match
 * 3. Alias match
 * 4. Email domain match
 * 5. Fuzzy name match
 * 6. Product/keyword match
 * 7. Combined multi-factor match
 */

import fuzzball from 'fuzzball';
import { compareTwoStrings } from 'string-similarity';
import logger from '../utils/logger';
import { VendorCache, getVendorCache } from './VendorCache';
import {
  VendorRecord,
  VendorMatchContext,
  VendorMatchResult,
  MatchDetails,
  AlternativeMatch,
  MatchStrategyType,
  StrategyMatchResult,
  VendorMatchingConfig,
  DEFAULT_MATCHING_CONFIG,
  MatchOptions,
} from '../types/vendorMatching';

// ============================================================================
// Vendor Matching Engine
// ============================================================================

export class VendorMatchingEngine {
  private readonly cache: VendorCache;
  private readonly config: VendorMatchingConfig;

  constructor(options?: { cache?: VendorCache; config?: Partial<VendorMatchingConfig> }) {
    this.cache = options?.cache || getVendorCache();
    this.config = {
      ...DEFAULT_MATCHING_CONFIG,
      ...options?.config,
      thresholds: {
        ...DEFAULT_MATCHING_CONFIG.thresholds,
        ...options?.config?.thresholds,
      },
      fuzzy: {
        ...DEFAULT_MATCHING_CONFIG.fuzzy,
        ...options?.config?.fuzzy,
      },
      weights: {
        ...DEFAULT_MATCHING_CONFIG.weights,
        ...options?.config?.weights,
      },
      cache: {
        ...DEFAULT_MATCHING_CONFIG.cache,
        ...options?.config?.cache,
      },
    };

    logger.info('VendorMatchingEngine initialized');
  }

  // ============================================================================
  // Main Entry Point
  // ============================================================================

  /**
   * Match vendor using all available strategies.
   * Returns the best match above the minimum confidence threshold.
   */
  async match(context: VendorMatchContext): Promise<VendorMatchResult> {
    const minConfidence = context.options?.minConfidence ?? this.config.thresholds.minimum;
    const maxAlternatives = context.options?.maxAlternatives ?? 3;

    // Get vendors to match against
    const vendors = context.options?.useProvidedVendorsOnly && context.existingVendors
      ? context.existingVendors
      : context.existingVendors || await this.cache.getAll();

    if (vendors.length === 0) {
      return {
        matched: false,
        vendor: null,
        confidence: 0,
        matchStrategy: 'no_vendors_available',
      };
    }

    // Execute strategies
    const results = await this.executeStrategies(context, vendors);

    // Filter by minimum confidence
    const validResults = results.filter((r) => r.confidence >= minConfidence);

    if (validResults.length === 0) {
      return {
        matched: false,
        vendor: null,
        confidence: 0,
        matchStrategy: 'no_match',
      };
    }

    // Sort by confidence descending
    validResults.sort((a, b) => b.confidence - a.confidence);

    const best = validResults[0];

    // Build alternatives (excluding the best match)
    const alternatives: AlternativeMatch[] = validResults
      .slice(1, maxAlternatives + 1)
      .filter((r) => r.vendor.id !== best.vendor.id)
      .map((r) => ({
        vendor: r.vendor,
        confidence: r.confidence,
        strategy: r.strategy,
      }));

    return {
      matched: true,
      vendor: best.vendor,
      confidence: best.confidence,
      matchStrategy: best.strategy,
      matchDetails: best.details,
      alternativeMatches: alternatives.length > 0 ? alternatives : undefined,
    };
  }

  /**
   * Quick check if a vendor name matches any known vendor.
   * Uses only fast strategies (exact, normalized, domain).
   */
  async quickMatch(
    name: string,
    emailDomain?: string
  ): Promise<{ matched: boolean; vendorId?: string; confidence: number }> {
    const normalized = this.normalizeName(name);

    // Try normalized name lookup first
    const byName = await this.cache.getByNormalizedName(normalized);
    if (byName) {
      return { matched: true, vendorId: byName.id, confidence: 1.0 };
    }

    // Try domain lookup
    if (emailDomain) {
      const byDomain = await this.cache.getByDomain(emailDomain);
      if (byDomain.length > 0) {
        return { matched: true, vendorId: byDomain[0].id, confidence: 0.9 };
      }
    }

    return { matched: false, confidence: 0 };
  }

  /**
   * Warm up the cache for faster subsequent matches.
   */
  async warmup(): Promise<void> {
    await this.cache.warmup();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  // ============================================================================
  // Strategy Execution
  // ============================================================================

  private async executeStrategies(
    context: VendorMatchContext,
    vendors: VendorRecord[]
  ): Promise<Array<StrategyMatchResult & { strategy: MatchStrategyType }>> {
    const enabledStrategies = context.options?.enabledStrategies || [
      'exact_name',
      'normalized_name',
      'alias',
      'email_domain',
      'fuzzy_name',
      'product',
      'combined',
    ];

    const results: Array<StrategyMatchResult & { strategy: MatchStrategyType }> = [];

    // Execute each enabled strategy
    for (const strategy of enabledStrategies) {
      try {
        const result = await this.executeStrategy(strategy, context, vendors);
        if (result) {
          results.push({ ...result, strategy });
        }
      } catch (error) {
        logger.warn('Strategy execution failed', {
          strategy,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  private async executeStrategy(
    strategy: MatchStrategyType,
    context: VendorMatchContext,
    vendors: VendorRecord[]
  ): Promise<StrategyMatchResult | null> {
    switch (strategy) {
      case 'exact_name':
        return this.matchByExactName(context.extractedName, vendors);
      case 'normalized_name':
        return this.matchByNormalizedName(context.extractedName, vendors);
      case 'alias':
        return this.matchByAlias(context.extractedName, vendors);
      case 'email_domain':
        return this.matchByEmailDomain(context.emailDomain || context.contactEmail, vendors);
      case 'fuzzy_name':
        return this.matchByFuzzyName(context.extractedName, vendors);
      case 'product':
        return this.matchByProducts(context.productMentions, vendors);
      case 'keyword':
        return this.matchByKeywords(context.keywords, vendors);
      case 'combined':
        return this.matchByCombinedFactors(context, vendors);
      default:
        return null;
    }
  }

  // ============================================================================
  // Individual Strategies
  // ============================================================================

  private matchByExactName(
    name: string | undefined,
    vendors: VendorRecord[]
  ): StrategyMatchResult | null {
    if (!name) return null;

    const vendor = vendors.find((v) => v.name.toLowerCase() === name.toLowerCase());
    if (vendor) {
      return {
        vendor,
        confidence: this.config.thresholds.exact,
        details: { nameSimilarity: 1.0 },
      };
    }
    return null;
  }

  private matchByNormalizedName(
    name: string | undefined,
    vendors: VendorRecord[]
  ): StrategyMatchResult | null {
    if (!name) return null;

    const normalized = this.normalizeName(name);
    const vendor = vendors.find((v) => v.normalizedName.toLowerCase() === normalized);

    if (vendor) {
      return {
        vendor,
        confidence: this.config.thresholds.exact,
        details: { nameSimilarity: 1.0 },
      };
    }
    return null;
  }

  private async matchByAlias(
    name: string | undefined,
    vendors: VendorRecord[]
  ): Promise<StrategyMatchResult | null> {
    if (!name) return null;

    const normalized = this.normalizeName(name);

    // Check vendor metadata for aliases
    for (const vendor of vendors) {
      const aliases = (vendor.metadata?.aliases as string[]) || [];
      for (const alias of aliases) {
        if (this.normalizeName(alias) === normalized) {
          return {
            vendor,
            confidence: this.config.thresholds.high,
            details: { aliasMatch: alias },
          };
        }
      }
    }

    return null;
  }

  private matchByEmailDomain(
    emailOrDomain: string | undefined,
    vendors: VendorRecord[]
  ): StrategyMatchResult | null {
    if (!emailOrDomain) return null;

    // Extract domain from email if needed
    const domain = emailOrDomain.includes('@')
      ? emailOrDomain.split('@')[1].toLowerCase()
      : emailOrDomain.toLowerCase();

    for (const vendor of vendors) {
      if (vendor.emailDomains.some((d) => d.toLowerCase() === domain)) {
        return {
          vendor,
          confidence: this.config.thresholds.high,
          details: { domainMatch: true, matchedDomain: domain },
        };
      }
    }

    return null;
  }

  private matchByFuzzyName(
    name: string | undefined,
    vendors: VendorRecord[]
  ): StrategyMatchResult | null {
    if (!name) return null;

    const normalized = this.normalizeName(name);
    let bestMatch: { vendor: VendorRecord; score: number } | null = null;

    for (const vendor of vendors) {
      // Use both fuzzball and string-similarity for robust matching
      const fuzzScore = fuzzball.ratio(normalized, vendor.normalizedName);
      const stringSim = compareTwoStrings(normalized, vendor.normalizedName);

      // Average the two scores (fuzzball is 0-100, string-similarity is 0-1)
      const combinedScore = (fuzzScore / 100 + stringSim) / 2;

      if (combinedScore >= this.config.fuzzy.stringSimilarityThreshold) {
        if (!bestMatch || combinedScore > bestMatch.score) {
          bestMatch = { vendor, score: combinedScore };
        }
      }
    }

    if (bestMatch) {
      return {
        vendor: bestMatch.vendor,
        confidence: bestMatch.score,
        details: {
          nameSimilarity: bestMatch.score,
          fuzzyScore: fuzzball.ratio(normalized, bestMatch.vendor.normalizedName),
        },
      };
    }

    return null;
  }

  private matchByProducts(
    products: string[] | undefined,
    vendors: VendorRecord[]
  ): StrategyMatchResult | null {
    if (!products || products.length === 0) return null;

    const normalizedProducts = products.map((p) => this.normalizeName(p));

    for (const vendor of vendors) {
      const vendorProducts = (vendor.metadata?.products as string[]) || [];
      const normalizedVendorProducts = vendorProducts.map((p) => this.normalizeName(p));

      const matches = normalizedProducts.filter(
        (p) =>
          normalizedVendorProducts.includes(p) ||
          vendor.normalizedName.includes(p) ||
          p.includes(vendor.normalizedName)
      );

      if (matches.length > 0) {
        const confidence = Math.min(
          this.config.thresholds.medium + matches.length * 0.1,
          this.config.thresholds.high
        );
        return {
          vendor,
          confidence,
          details: { productMatches: matches },
        };
      }
    }

    return null;
  }

  private matchByKeywords(
    keywords: string[] | undefined,
    vendors: VendorRecord[]
  ): StrategyMatchResult | null {
    if (!keywords || keywords.length === 0) return null;

    const normalizedKeywords = keywords.map((k) => this.normalizeName(k));

    for (const vendor of vendors) {
      const vendorKeywords = (vendor.metadata?.keywords as string[]) || [];
      const normalizedVendorKeywords = vendorKeywords.map((k) => this.normalizeName(k));

      const matches = normalizedKeywords.filter((k) =>
        normalizedVendorKeywords.some((vk) => vk.includes(k) || k.includes(vk))
      );

      if (matches.length > 0) {
        const confidence = Math.min(
          this.config.thresholds.low + matches.length * 0.1,
          this.config.thresholds.medium
        );
        return {
          vendor,
          confidence,
          details: { keywordMatches: matches },
        };
      }
    }

    return null;
  }

  private matchByCombinedFactors(
    context: VendorMatchContext,
    vendors: VendorRecord[]
  ): StrategyMatchResult | null {
    if (!context.extractedName) return null;

    let bestMatch: { vendor: VendorRecord; score: number; details: Partial<MatchDetails> } | null = null;

    for (const vendor of vendors) {
      let totalScore = 0;
      const details: Partial<MatchDetails> = { strategyScores: {} as Record<MatchStrategyType, number> };

      // Name similarity
      if (context.extractedName) {
        const normalized = this.normalizeName(context.extractedName);
        const nameSim = compareTwoStrings(normalized, vendor.normalizedName);
        const nameScore = nameSim * this.config.weights.name;
        totalScore += nameScore;
        details.nameSimilarity = nameSim;
        details.strategyScores!.fuzzy_name = nameScore;
      }

      // Domain match
      if (context.emailDomain || context.contactEmail) {
        const domain = context.emailDomain || context.contactEmail?.split('@')[1];
        if (domain && vendor.emailDomains.some((d) => d.toLowerCase() === domain.toLowerCase())) {
          totalScore += this.config.weights.domain;
          details.domainMatch = true;
          details.matchedDomain = domain;
          details.strategyScores!.email_domain = this.config.weights.domain;
        }
      }

      // Product matches
      if (context.productMentions && context.productMentions.length > 0) {
        const vendorProducts = (vendor.metadata?.products as string[]) || [];
        const matches = context.productMentions.filter((p) =>
          vendorProducts.some((vp) => this.normalizeName(vp).includes(this.normalizeName(p)))
        );
        if (matches.length > 0) {
          const productScore = (matches.length / context.productMentions.length) * this.config.weights.product;
          totalScore += productScore;
          details.productMatches = matches;
          details.strategyScores!.product = productScore;
        }
      }

      // Keyword matches
      if (context.keywords && context.keywords.length > 0) {
        const vendorKeywords = (vendor.metadata?.keywords as string[]) || [];
        const matches = context.keywords.filter((k) =>
          vendorKeywords.some((vk) => this.normalizeName(vk).includes(this.normalizeName(k)))
        );
        if (matches.length > 0) {
          const keywordScore = (matches.length / context.keywords.length) * this.config.weights.keyword;
          totalScore += keywordScore;
          details.keywordMatches = matches;
          details.strategyScores!.keyword = keywordScore;
        }
      }

      if (totalScore > 0 && (!bestMatch || totalScore > bestMatch.score)) {
        bestMatch = { vendor, score: totalScore, details };
      }
    }

    if (bestMatch && bestMatch.score >= this.config.thresholds.minimum) {
      return {
        vendor: bestMatch.vendor,
        confidence: Math.min(bestMatch.score, 1.0),
        details: bestMatch.details,
      };
    }

    return null;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Normalize a vendor name for matching.
   * Removes common suffixes, punctuation, and normalizes whitespace.
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+(inc|llc|ltd|corp|corporation|company|co|limited|gmbh|ag|sa|bv|nv)\.?$/gi, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultEngine: VendorMatchingEngine | null = null;

/**
 * Get the default vendor matching engine instance.
 */
export function getVendorMatchingEngine(): VendorMatchingEngine {
  if (!defaultEngine) {
    defaultEngine = new VendorMatchingEngine();
  }
  return defaultEngine;
}

/**
 * Set the default vendor matching engine instance (for testing).
 */
export function setVendorMatchingEngine(engine: VendorMatchingEngine): void {
  defaultEngine = engine;
}

/**
 * Reset the default vendor matching engine (for testing).
 */
export function resetVendorMatchingEngine(): void {
  defaultEngine = null;
}

// ============================================================================
// Compatibility Layer
// ============================================================================

/**
 * @deprecated Use getVendorMatchingEngine().match() instead.
 * Provided for backward compatibility with existing code.
 */
export async function matchVendor(context: VendorMatchContext): Promise<VendorMatchResult> {
  return getVendorMatchingEngine().match(context);
}

export default VendorMatchingEngine;
