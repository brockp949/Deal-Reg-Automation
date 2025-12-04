import { query } from '../db';
import { ratio, partial_ratio, token_sort_ratio, token_set_ratio } from 'fuzzball';
import { compareTwoStrings } from 'string-similarity';
import logger from '../utils/logger';
import { triggerWebhook } from './webhookService';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface DealData {
  id?: string;
  dealName: string;
  customerName: string;
  dealValue?: number;
  currency?: string;
  closeDate?: string | Date;
  registrationDate?: string | Date;
  vendorId?: string;
  vendorName?: string;
  products?: string[];
  contacts?: ContactData[];
  description?: string;
  status?: string;
  [key: string]: any;
}

export interface VendorData {
  id?: string;
  vendorName: string;
  normalizedName?: string;
  emailDomains?: string[];
  products?: string[];
  tier?: string;
  status?: string;
  [key: string]: any;
}

export interface ContactData {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  company?: string;
  [key: string]: any;
}

export type EntityData = DealData | VendorData | ContactData;

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  matches: DuplicateMatch[];
  suggestedAction: 'auto_merge' | 'manual_review' | 'no_action';
  confidence: number;
}

export interface DuplicateMatch {
  matchedEntityId: string;
  matchedEntity: EntityData;
  similarityScore: number;
  confidence: number;
  strategy: DuplicateStrategy;
  similarityFactors: SimilarityFactors;
  reasoning: string;
}

export interface SimilarityFactors {
  dealName?: number;
  customerName?: number;
  vendorMatch?: number;
  dealValue?: number;
  closeDate?: number;
  products?: number;
  contacts?: number;
  description?: number;
  emailDomain?: number;
  phone?: number;
}

export interface FieldWeights {
  dealName: number;
  customerName: number;
  vendorMatch: number;
  dealValue: number;
  closeDate: number;
  products: number;
  contacts: number;
  description: number;
}

export enum DuplicateStrategy {
  EXACT_MATCH = 'exact_match',
  FUZZY_NAME = 'fuzzy_name',
  CUSTOMER_VALUE = 'customer_value',
  CUSTOMER_DATE = 'customer_date',
  VENDOR_CUSTOMER = 'vendor_customer',
  MULTI_FACTOR = 'multi_factor'
}

export interface DuplicateCluster {
  clusterId: string;
  clusterKey: string;
  entityType: 'deal' | 'vendor' | 'contact';
  entityIds: string[];
  masterEntityId?: string;
  clusterSize: number;
  confidenceScore: number;
  createdAt: Date;
  status: 'active' | 'merged' | 'split';
}

export interface SimilarityScore {
  overall: number;
  factors: SimilarityFactors;
  weight: number;
}

// ============================================================================
// Configuration
// ============================================================================

export const MATCH_CONFIG = {
  // Confidence thresholds
  AUTO_MERGE_THRESHOLD: parseFloat(process.env.DUPLICATE_AUTO_MERGE_THRESHOLD || '0.95'),
  HIGH_CONFIDENCE_THRESHOLD: 0.85,
  MEDIUM_CONFIDENCE_THRESHOLD: 0.70,
  LOW_CONFIDENCE_THRESHOLD: 0.50,
  MINIMUM_MATCH_THRESHOLD: parseFloat(process.env.DUPLICATE_DETECTION_THRESHOLD || '0.85'),

  // Fuzzy matching thresholds
  FUZZY_EXACT_THRESHOLD: 95,
  FUZZY_HIGH_THRESHOLD: 85,
  FUZZY_MEDIUM_THRESHOLD: 70,
  FUZZY_LOW_THRESHOLD: 50,

  // Deal value tolerance (percentage)
  VALUE_TOLERANCE_PERCENT: 10,

  // Date tolerance (days)
  DATE_TOLERANCE_DAYS: 7,

  // Default field weights for deals
  DEFAULT_DEAL_WEIGHTS: {
    dealName: 0.25,
    customerName: 0.25,
    vendorMatch: 0.15,
    dealValue: 0.15,
    closeDate: 0.10,
    products: 0.05,
    contacts: 0.05,
    description: 0.00 // Not used by default (expensive)
  } as FieldWeights,

  // Batch processing
  BATCH_SIZE: parseInt(process.env.DUPLICATE_BATCH_SIZE || '100'),
};

/**
 * Update duplicate detection configuration
 */
export function updateDuplicateConfig(config: Partial<typeof MATCH_CONFIG>) {
  Object.assign(MATCH_CONFIG, config);
  logger.info('Duplicate detection configuration updated', config);
}

/**
 * Get current duplicate detection configuration
 */
export function getDuplicateConfig() {
  return { ...MATCH_CONFIG };
}

// ============================================================================
// Normalization Utilities
// ============================================================================

/**
 * Normalize string for comparison
 */
function normalizeString(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' ');   // Normalize whitespace
}

/**
 * Normalize company name (remove suffixes)
 */
function normalizeCompanyName(name: string): string {
  const normalized = normalizeString(name);
  const suffixes = ['inc', 'corp', 'corporation', 'llc', 'ltd', 'limited', 'co', 'company'];

  let result = normalized;
  for (const suffix of suffixes) {
    const pattern = new RegExp(`\\b${suffix}\\b$`, 'i');
    result = result.replace(pattern, '').trim();
  }

  return result;
}

/**
 * Normalize date for comparison
 */
function normalizeDate(date: string | Date | null | undefined): Date | null {
  if (!date) return null;
  try {
    return new Date(date);
  } catch {
    return null;
  }
}

// ============================================================================
// Similarity Calculation Functions
// ============================================================================

/**
 * Calculate fuzzy string similarity using multiple algorithms
 */
function calculateFuzzyStringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  const norm1 = normalizeString(str1);
  const norm2 = normalizeString(str2);

  if (norm1 === norm2) return 100;

  // Use multiple fuzzy matching algorithms and take the best
  const scores = [
    ratio(norm1, norm2),                    // Levenshtein distance
    partial_ratio(norm1, norm2),            // Partial string matching
    token_sort_ratio(norm1, norm2),         // Token sorting
    token_set_ratio(norm1, norm2),          // Token set matching
    compareTwoStrings(norm1, norm2) * 100   // Dice coefficient
  ];

  // Return the highest score
  return Math.max(...scores);
}

/**
 * Calculate deal name similarity
 */
function calculateDealNameSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0;

  const score = calculateFuzzyStringSimilarity(name1, name2);

  // Normalize to 0-1 scale
  return score / 100;
}

/**
 * Calculate customer name similarity
 */
function calculateCustomerNameSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0;

  // Normalize company names
  const norm1 = normalizeCompanyName(name1);
  const norm2 = normalizeCompanyName(name2);

  const score = calculateFuzzyStringSimilarity(norm1, norm2);

  return score / 100;
}

/**
 * Calculate deal value similarity
 */
function calculateDealValueSimilarity(
  value1: number | null | undefined,
  value2: number | null | undefined,
  tolerance: number = MATCH_CONFIG.VALUE_TOLERANCE_PERCENT
): number {
  if (!value1 || !value2) return 0;
  if (value1 === value2) return 1.0;

  // Calculate percentage difference
  const avgValue = (value1 + value2) / 2;
  const diff = Math.abs(value1 - value2);
  const percentDiff = (diff / avgValue) * 100;

  if (percentDiff <= tolerance) {
    // Within tolerance - scale from 1.0 to 0.7
    return 1.0 - (percentDiff / tolerance) * 0.3;
  }

  // Outside tolerance - scale from 0.7 to 0
  const maxDiff = tolerance * 3; // Allow up to 3x tolerance
  if (percentDiff > maxDiff) return 0;

  return 0.7 - ((percentDiff - tolerance) / (maxDiff - tolerance)) * 0.7;
}

/**
 * Calculate date similarity
 */
function calculateDateSimilarity(
  date1: string | Date | null | undefined,
  date2: string | Date | null | undefined,
  toleranceDays: number = MATCH_CONFIG.DATE_TOLERANCE_DAYS
): number {
  const d1 = normalizeDate(date1);
  const d2 = normalizeDate(date2);

  if (!d1 || !d2) return 0;
  if (d1.getTime() === d2.getTime()) return 1.0;

  // Calculate day difference
  const dayDiff = Math.abs((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));

  if (dayDiff <= toleranceDays) {
    // Within tolerance - scale from 1.0 to 0.7
    return 1.0 - (dayDiff / toleranceDays) * 0.3;
  }

  // Outside tolerance - scale from 0.7 to 0
  const maxDays = toleranceDays * 4; // Allow up to 4x tolerance
  if (dayDiff > maxDays) return 0;

  return 0.7 - ((dayDiff - toleranceDays) / (maxDays - toleranceDays)) * 0.7;
}

/**
 * Calculate product similarity
 */
function calculateProductSimilarity(
  products1: string[] | null | undefined,
  products2: string[] | null | undefined
): number {
  if (!products1 || !products2 || products1.length === 0 || products2.length === 0) {
    return 0;
  }

  // Normalize product names
  const norm1 = products1.map(p => normalizeString(p));
  const norm2 = products2.map(p => normalizeString(p));

  // Calculate Jaccard similarity
  const set1 = new Set(norm1);
  const set2 = new Set(norm2);

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 0;

  return intersection.size / union.size;
}

/**
 * Calculate contact similarity
 */
function calculateContactSimilarity(
  contacts1: ContactData[] | null | undefined,
  contacts2: ContactData[] | null | undefined
): number {
  if (!contacts1 || !contacts2 || contacts1.length === 0 || contacts2.length === 0) {
    return 0;
  }

  // Extract emails
  const emails1 = contacts1.map(c => c.email?.toLowerCase()).filter(Boolean);
  const emails2 = contacts2.map(c => c.email?.toLowerCase()).filter(Boolean);

  if (emails1.length === 0 || emails2.length === 0) return 0;

  // Calculate Jaccard similarity on emails
  const set1 = new Set(emails1);
  const set2 = new Set(emails2);

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 0;

  return intersection.size / union.size;
}

/**
 * Calculate overall similarity score with weighted factors
 */
export function calculateSimilarityScore(
  entity1: DealData,
  entity2: DealData,
  weights: FieldWeights = MATCH_CONFIG.DEFAULT_DEAL_WEIGHTS
): SimilarityScore {
  const factors: SimilarityFactors = {
    dealName: calculateDealNameSimilarity(entity1.dealName, entity2.dealName),
    customerName: calculateCustomerNameSimilarity(entity1.customerName, entity2.customerName),
    vendorMatch: entity1.vendorId && entity2.vendorId && entity1.vendorId === entity2.vendorId ? 1.0 : 0.0,
    dealValue: calculateDealValueSimilarity(entity1.dealValue, entity2.dealValue),
    closeDate: calculateDateSimilarity(entity1.closeDate, entity2.closeDate),
    products: calculateProductSimilarity(entity1.products, entity2.products),
    contacts: calculateContactSimilarity(entity1.contacts, entity2.contacts),
  };

  // Calculate weighted score
  let overall = 0;
  let totalWeight = 0;

  for (const [factor, score] of Object.entries(factors)) {
    const weight = weights[factor as keyof FieldWeights] || 0;
    overall += score * weight;
    totalWeight += weight;
  }

  // Normalize by total weight
  overall = totalWeight > 0 ? overall / totalWeight : 0;

  return {
    overall,
    factors,
    weight: totalWeight
  };
}

// ============================================================================
// Duplicate Detection Strategies
// ============================================================================

/**
 * Strategy 1: Exact match (normalized)
 */
async function detectExactMatch(
  deal: DealData,
  existingDeals: DealData[]
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  const normDealName = normalizeString(deal.dealName);
  const normCustomer = normalizeCompanyName(deal.customerName);

  for (const existing of existingDeals) {
    const existingDealName = normalizeString(existing.dealName);
    const existingCustomer = normalizeCompanyName(existing.customerName);

    if (normDealName === existingDealName && normCustomer === existingCustomer) {
      // Check if values match (if both have values)
      let valueMatch = true;
      if (deal.dealValue && existing.dealValue) {
        valueMatch = Math.abs(deal.dealValue - existing.dealValue) < 1; // Allow $1 difference
      }

      if (valueMatch) {
        matches.push({
          matchedEntityId: existing.id!,
          matchedEntity: existing,
          similarityScore: 1.0,
          confidence: 1.0,
          strategy: DuplicateStrategy.EXACT_MATCH,
          similarityFactors: {
            dealName: 1.0,
            customerName: 1.0,
            dealValue: valueMatch ? 1.0 : 0.9
          },
          reasoning: 'Exact match on deal name and customer name'
        });
      }
    }
  }

  return matches;
}

/**
 * Strategy 2: Fuzzy name match
 */
async function detectFuzzyNameMatch(
  deal: DealData,
  existingDeals: DealData[]
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  for (const existing of existingDeals) {
    const dealNameScore = calculateFuzzyStringSimilarity(deal.dealName, existing.dealName);
    const customerScore = calculateFuzzyStringSimilarity(deal.customerName, existing.customerName);
    const avgScore = (dealNameScore + customerScore) / 2;

    // Require both scores to be at least "medium" similarity and the average to be high.
    if (
      dealNameScore >= MATCH_CONFIG.FUZZY_MEDIUM_THRESHOLD &&
      customerScore >= MATCH_CONFIG.FUZZY_MEDIUM_THRESHOLD &&
      avgScore >= MATCH_CONFIG.FUZZY_HIGH_THRESHOLD
    ) {
      const confidence = avgScore / 100;

      matches.push({
        matchedEntityId: existing.id!,
        matchedEntity: existing,
        similarityScore: confidence,
        confidence,
        strategy: DuplicateStrategy.FUZZY_NAME,
        similarityFactors: {
          dealName: dealNameScore / 100,
          customerName: customerScore / 100
        },
        reasoning: `Fuzzy match: deal name ${dealNameScore.toFixed(1)}%, customer ${customerScore.toFixed(1)}%`
      });
    }
  }

  return matches;
}

/**
 * Strategy 3: Customer + Value match
 */
async function detectCustomerValueMatch(
  deal: DealData,
  existingDeals: DealData[]
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  if (!deal.dealValue) return matches;

  for (const existing of existingDeals) {
    if (!existing.dealValue) continue;

    const customerSim = calculateCustomerNameSimilarity(deal.customerName, existing.customerName);
    const valueSim = calculateDealValueSimilarity(deal.dealValue, existing.dealValue);

    // High customer similarity and value match
    if (customerSim >= 0.85 && valueSim >= 0.85) {
      const confidence = (customerSim * 0.6 + valueSim * 0.4);

      matches.push({
        matchedEntityId: existing.id!,
        matchedEntity: existing,
        similarityScore: confidence,
        confidence,
        strategy: DuplicateStrategy.CUSTOMER_VALUE,
        similarityFactors: {
          customerName: customerSim,
          dealValue: valueSim
        },
        reasoning: `Same customer (${(customerSim * 100).toFixed(1)}%) with similar deal value ($${deal.dealValue.toLocaleString()} vs $${existing.dealValue.toLocaleString()})`
      });
    }
  }

  return matches;
}

/**
 * Strategy 4: Customer + Date match
 */
async function detectCustomerDateMatch(
  deal: DealData,
  existingDeals: DealData[]
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  if (!deal.closeDate) return matches;

  for (const existing of existingDeals) {
    if (!existing.closeDate) continue;

    const customerSim = calculateCustomerNameSimilarity(deal.customerName, existing.customerName);
    const dateSim = calculateDateSimilarity(deal.closeDate, existing.closeDate);

    // High customer similarity and close date match
    if (customerSim >= 0.85 && dateSim >= 0.85) {
      const confidence = (customerSim * 0.6 + dateSim * 0.4);

      matches.push({
        matchedEntityId: existing.id!,
        matchedEntity: existing,
        similarityScore: confidence,
        confidence,
        strategy: DuplicateStrategy.CUSTOMER_DATE,
        similarityFactors: {
          customerName: customerSim,
          closeDate: dateSim
        },
        reasoning: `Same customer (${(customerSim * 100).toFixed(1)}%) with similar close date`
      });
    }
  }

  return matches;
}

/**
 * Strategy 5: Vendor + Customer match
 */
async function detectVendorCustomerMatch(
  deal: DealData,
  existingDeals: DealData[]
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  if (!deal.vendorId) return matches;

  for (const existing of existingDeals) {
    if (!existing.vendorId || existing.vendorId !== deal.vendorId) continue;

    const customerSim = calculateCustomerNameSimilarity(deal.customerName, existing.customerName);

    // Same vendor and high customer similarity
    if (customerSim >= 0.80) {
      const dealNameSim = calculateDealNameSimilarity(deal.dealName, existing.dealName);
      const vendorBonus = 0.3;
      const confidence = Math.min(1,
        vendorBonus + (customerSim * 0.5) + (dealNameSim * 0.2)
      );

      matches.push({
        matchedEntityId: existing.id!,
        matchedEntity: existing,
        similarityScore: confidence,
        confidence,
        strategy: DuplicateStrategy.VENDOR_CUSTOMER,
        similarityFactors: {
          vendorMatch: 1.0,
          customerName: customerSim,
          dealName: dealNameSim
        },
        reasoning: `Same vendor with similar customer (${(customerSim * 100).toFixed(1)}%)`
      });
    }
  }

  return matches;
}

/**
 * Strategy 6: Multi-factor weighted match
 */
async function detectMultiFactorMatch(
  deal: DealData,
  existingDeals: DealData[],
  weights: FieldWeights = MATCH_CONFIG.DEFAULT_DEAL_WEIGHTS
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  for (const existing of existingDeals) {
    const similarity = calculateSimilarityScore(deal, existing, weights);

    // High overall similarity
    if (similarity.overall >= MATCH_CONFIG.MEDIUM_CONFIDENCE_THRESHOLD) {
      matches.push({
        matchedEntityId: existing.id!,
        matchedEntity: existing,
        similarityScore: similarity.overall,
        confidence: similarity.overall,
        strategy: DuplicateStrategy.MULTI_FACTOR,
        similarityFactors: similarity.factors,
        reasoning: `Multi-factor match with ${(similarity.overall * 100).toFixed(1)}% overall similarity`
      });
    }
  }

  return matches;
}

// ============================================================================
// Main Duplicate Detection Functions
// ============================================================================

/**
 * Detect duplicate deals using all strategies
 */
export async function detectDuplicateDeals(
  deal: DealData,
  context?: {
    existingDeals?: DealData[];
    threshold?: number;
    strategies?: DuplicateStrategy[];
  }
): Promise<DuplicateDetectionResult> {
  const threshold = context?.threshold || MATCH_CONFIG.MINIMUM_MATCH_THRESHOLD;
  const strategies = context?.strategies || Object.values(DuplicateStrategy);
  const usingProvidedDeals = Array.isArray(context?.existingDeals);

  try {
    // Get existing deals if not provided
    let existingDeals = context?.existingDeals;
    if (!existingDeals) {
      existingDeals = await getExistingDeals(deal);
    }

    // Filter out the deal itself if it has an ID
    if (deal.id) {
      existingDeals = existingDeals.filter(d => d.id !== deal.id);
    }

    if (existingDeals.length === 0) {
      return {
        isDuplicate: false,
        matches: [],
        suggestedAction: 'no_action',
        confidence: 0
      };
    }

    // Run all requested strategies
    const allMatches: DuplicateMatch[] = [];

    if (strategies.includes(DuplicateStrategy.EXACT_MATCH)) {
      const exactMatches = await detectExactMatch(deal, existingDeals);
      allMatches.push(...exactMatches);
    }

    if (strategies.includes(DuplicateStrategy.FUZZY_NAME)) {
      const fuzzyMatches = await detectFuzzyNameMatch(deal, existingDeals);
      allMatches.push(...fuzzyMatches);
    }

    if (strategies.includes(DuplicateStrategy.CUSTOMER_VALUE)) {
      const customerValueMatches = await detectCustomerValueMatch(deal, existingDeals);
      allMatches.push(...customerValueMatches);
    }

    if (strategies.includes(DuplicateStrategy.CUSTOMER_DATE)) {
      const customerDateMatches = await detectCustomerDateMatch(deal, existingDeals);
      allMatches.push(...customerDateMatches);
    }

    if (strategies.includes(DuplicateStrategy.VENDOR_CUSTOMER)) {
      const vendorCustomerMatches = await detectVendorCustomerMatch(deal, existingDeals);
      allMatches.push(...vendorCustomerMatches);
    }

    if (strategies.includes(DuplicateStrategy.MULTI_FACTOR)) {
      const multiFactorMatches = await detectMultiFactorMatch(deal, existingDeals);
      allMatches.push(...multiFactorMatches);
    }

    // Deduplicate matches (same entity matched by multiple strategies)
    const matchMap = new Map<string, DuplicateMatch>();
    for (const match of allMatches) {
      const existing = matchMap.get(match.matchedEntityId);
      if (!existing || match.confidence > existing.confidence) {
        matchMap.set(match.matchedEntityId, match);
      }
    }

    // Filter by threshold and sort by confidence
    const matches = Array.from(matchMap.values())
      .filter(m => m.confidence >= threshold)
      .sort((a, b) => b.confidence - a.confidence);

    // Determine suggested action
    let suggestedAction: 'auto_merge' | 'manual_review' | 'no_action' = 'no_action';
    const maxConfidence = matches.length > 0 ? matches[0].confidence : 0;

    if (maxConfidence >= MATCH_CONFIG.AUTO_MERGE_THRESHOLD) {
      suggestedAction = 'auto_merge';
    } else if (maxConfidence >= MATCH_CONFIG.HIGH_CONFIDENCE_THRESHOLD) {
      suggestedAction = 'manual_review';
    }

    // Log detection
    if (!usingProvidedDeals && matches.length > 0 && deal.id) {
      await logDuplicateDetection(deal.id, matches[0].matchedEntityId, matches[0]);
    }

    logger.info('Duplicate detection completed', {
      dealId: deal.id,
      dealName: deal.dealName,
      matchesFound: matches.length,
      topConfidence: maxConfidence,
      suggestedAction
    });

    // Trigger webhook if duplicates found
    if (matches.length > 0) {
      triggerWebhook('duplicate.detected', {
        dealId: deal.id,
        dealName: deal.dealName,
        matchesCount: matches.length,
        topConfidence: maxConfidence,
        suggestedAction,
        matches: matches.slice(0, 3).map(m => ({
          matchedEntityId: m.matchedEntityId,
          confidence: m.confidence,
          reasoning: m.reasoning
        }))
      }).catch(err => logger.error('Failed to trigger duplicate webhook', { error: err.message }));
    }

    return {
      isDuplicate: matches.length > 0,
      matches,
      suggestedAction,
      confidence: maxConfidence
    };

  } catch (error: any) {
    logger.error('Duplicate detection failed', {
      error: error.message,
      dealId: deal.id,
      dealName: deal.dealName
    });
    throw error;
  }
}

/**
 * Batch duplicate detection
 */
export async function detectDuplicatesInBatch(
  entities: DealData[],
  entityType: 'deal' = 'deal'
): Promise<Map<string, DuplicateDetectionResult>> {
  const results = new Map<string, DuplicateDetectionResult>();

  logger.info('Starting batch duplicate detection', {
    entityCount: entities.length,
    entityType
  });

  // Get all existing entities once
  const existingDeals = await getAllDeals();

  // Process in batches to avoid memory issues
  for (let i = 0; i < entities.length; i += MATCH_CONFIG.BATCH_SIZE) {
    const batch = entities.slice(i, i + MATCH_CONFIG.BATCH_SIZE);

    for (const entity of batch) {
      const result = await detectDuplicateDeals(entity, { existingDeals });
      if (entity.id) {
        results.set(entity.id, result);
      }
    }

    logger.debug('Processed batch', {
      batchStart: i,
      batchSize: batch.length,
      totalProcessed: Math.min(i + MATCH_CONFIG.BATCH_SIZE, entities.length),
      total: entities.length
    });
  }

  logger.info('Batch duplicate detection completed', {
    totalEntities: entities.length,
    duplicatesFound: Array.from(results.values()).filter(r => r.isDuplicate).length
  });

  return results;
}

/**
 * Cluster duplicates (group all duplicates together)
 */
export async function clusterDuplicates(
  entities: DealData[]
): Promise<DuplicateCluster[]> {
  logger.info('Starting duplicate clustering', { entityCount: entities.length });

  // Build adjacency map
  const adjacencyMap = new Map<string, Set<string>>();

  for (const entity of entities) {
    if (!entity.id) continue;

    const result = await detectDuplicateDeals(entity, {
      existingDeals: entities.filter(e => e.id !== entity.id),
      threshold: MATCH_CONFIG.HIGH_CONFIDENCE_THRESHOLD
    });

    if (result.isDuplicate) {
      if (!adjacencyMap.has(entity.id)) {
        adjacencyMap.set(entity.id, new Set());
      }

      for (const match of result.matches) {
        adjacencyMap.get(entity.id)!.add(match.matchedEntityId);
      }
    }
  }

  // Find connected components (clusters)
  const visited = new Set<string>();
  const clusters: DuplicateCluster[] = [];

  function dfs(nodeId: string, cluster: Set<string>) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    cluster.add(nodeId);

    const neighbors = adjacencyMap.get(nodeId);
    if (neighbors) {
      for (const neighbor of neighbors) {
        dfs(neighbor, cluster);
      }
    }
  }

  for (const [entityId] of adjacencyMap) {
    if (!visited.has(entityId)) {
      const cluster = new Set<string>();
      dfs(entityId, cluster);

      if (cluster.size > 1) {
        const entityIds = Array.from(cluster);
        clusters.push({
          clusterId: generateClusterId(),
          clusterKey: generateClusterKey(entityIds),
          entityType: 'deal',
          entityIds,
          clusterSize: entityIds.length,
          confidenceScore: 0.85, // Calculate based on average similarity
          createdAt: new Date(),
          status: 'active'
        });
      }
    }
  }

  logger.info('Clustering completed', {
    totalEntities: entities.length,
    clustersFound: clusters.length,
    totalDuplicates: clusters.reduce((sum, c) => sum + c.clusterSize, 0)
  });

  return clusters;
}

// ============================================================================
// Database Helper Functions
// ============================================================================

/**
 * Get existing deals for duplicate detection
 */
async function getExistingDeals(deal: DealData): Promise<DealData[]> {
  try {
    // Get deals with similar customer name or same vendor
    const result = await query(
      `SELECT
        d.id, d.deal_name as "dealName", d.customer_name as "customerName",
        d.deal_value as "dealValue", d.currency, d.close_date as "closeDate",
        d.registration_date as "registrationDate", d.vendor_id as "vendorId",
        d.status, d.products
      FROM deal_registrations d
      WHERE
        d.status != 'rejected'
        AND (
          LOWER(d.customer_name) LIKE $1
          OR d.vendor_id = $2
        )
      ORDER BY d.created_at DESC
      LIMIT 200`,
      [
        `%${deal.customerName.toLowerCase()}%`,
        deal.vendorId || null
      ]
    );

    return result.rows;
  } catch (error: any) {
    logger.warn('Failed to get existing deals', { error: error.message });
    throw error;
  }
}

/**
 * Get all deals (for batch processing)
 */
async function getAllDeals(): Promise<DealData[]> {
  try {
    const result = await query(
      `SELECT
        d.id, d.deal_name as "dealName", d.customer_name as "customerName",
        d.deal_value as "dealValue", d.currency, d.close_date as "closeDate",
        d.registration_date as "registrationDate", d.vendor_id as "vendorId",
        d.status, d.products
      FROM deal_registrations d
      WHERE d.status != 'rejected'
      ORDER BY d.created_at DESC`
    );

    return result.rows;
  } catch (error: any) {
    logger.warn('Failed to get all deals', { error: error.message });
    throw error;
  }
}

/**
 * Log duplicate detection to database
 */
async function logDuplicateDetection(
  entityId: string,
  matchedEntityId: string,
  match: DuplicateMatch
): Promise<void> {
  try {
    await query(
      `INSERT INTO duplicate_detections (
        entity_type, entity_id_1, entity_id_2,
        similarity_score, confidence_level, detection_strategy,
        similarity_factors, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (entity_type, entity_id_1, entity_id_2)
      DO UPDATE SET
        similarity_score = $4,
        confidence_level = $5,
        detection_strategy = $6,
        similarity_factors = $7::jsonb,
        detected_at = CURRENT_TIMESTAMP`,
      [
        'deal',
        entityId,
        matchedEntityId,
        match.similarityScore,
        match.confidence,
        match.strategy,
        JSON.stringify(match.similarityFactors),
        'pending'
      ]
    );
  } catch (error: any) {
    logger.warn('Failed to log duplicate detection', { error: error.message });
  }
}

/**
 * Generate cluster ID
 */
function generateClusterId(): string {
  return `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate cluster key (deterministic based on sorted entity IDs)
 */
function generateClusterKey(entityIds: string[]): string {
  return entityIds.sort().join('|');
}

// ============================================================================
// Exports
// ============================================================================

// export { MATCH_CONFIG }; // Removed to avoid duplicate export

export default {
  detectDuplicateDeals,
  detectDuplicatesInBatch,
  clusterDuplicates,
  calculateSimilarityScore,
  MATCH_CONFIG
};
