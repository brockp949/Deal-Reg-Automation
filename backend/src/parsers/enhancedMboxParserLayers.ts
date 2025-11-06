/**
 * Enhanced MBOX Parser - Layers 2 & 3
 * Regex Extraction and Confidence Scoring
 */

import { REGEX_PATTERNS, TIER1_KEYWORDS, TIER2_KEYWORDS, TIER3_KEYWORDS, ExtractedDeal, ParsedEmailMessage, EmailThread } from './enhancedMboxParser';
import logger from '../utils/logger';
import {
  extractValueWithContext,
  extractCompaniesWithContext,
  extractProducts,
  detectDealStage,
  extractTimeline,
  calculateEnhancedConfidence,
} from './enhancedExtraction';

// ============================================================================
// LAYER 2: PATTERN-BASED EXTRACTION WITH REGEX
// ============================================================================

/**
 * Extract financial data from text
 */
export function extractFinancialData(text: string): { value: number; currency: string }[] {
  const results: { value: number; currency: string }[] = [];

  // Try USD patterns
  let matches = text.matchAll(REGEX_PATTERNS.currency.usd);
  for (const match of matches) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(value)) {
      results.push({ value, currency: 'USD' });
    }
  }

  // Try abbreviated format ($75k)
  matches = text.matchAll(REGEX_PATTERNS.currency.abbreviated);
  for (const match of matches) {
    const value = parseFloat(match[1]) * 1000;
    if (!isNaN(value)) {
      results.push({ value, currency: 'USD' });
    }
  }

  // Try labeled patterns (deal value: $250,000)
  matches = text.matchAll(REGEX_PATTERNS.currency.withLabel);
  for (const match of matches) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(value)) {
      results.push({ value, currency: 'USD' });
    }
  }

  return results;
}

/**
 * Extract dates from text
 */
export function extractDates(text: string): Date[] {
  const dates: Date[] = [];

  // ISO format (YYYY-MM-DD)
  let matches = text.matchAll(REGEX_PATTERNS.date.iso);
  for (const match of matches) {
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}`);
    if (!isNaN(date.getTime())) {
      dates.push(date);
    }
  }

  // Month Day, Year format
  matches = text.matchAll(REGEX_PATTERNS.date.monthDayYear);
  for (const match of matches) {
    const dateStr = `${match[1]} ${match[2]}, ${match[3]}`;
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      dates.push(date);
    }
  }

  // MM/DD/YYYY format
  matches = text.matchAll(REGEX_PATTERNS.date.mmddyyyy);
  for (const match of matches) {
    const date = new Date(`${match[3]}-${match[1]}-${match[2]}`);
    if (!isNaN(date.getTime())) {
      dates.push(date);
    }
  }

  return dates;
}

/**
 * Extract contact information
 */
export function extractContactInfo(text: string): {
  emails: string[];
  phones: string[];
  names: string[];
} {
  const emails: string[] = [];
  const phones: string[] = [];
  const names: string[] = [];

  // Extract emails
  const emailMatches = text.matchAll(REGEX_PATTERNS.email);
  for (const match of emailMatches) {
    emails.push(match[0]);
  }

  // Extract phone numbers
  const phoneMatches = text.matchAll(REGEX_PATTERNS.phone);
  for (const match of phoneMatches) {
    phones.push(match[0]);
  }

  // Extract decision maker names
  const nameMatches = text.matchAll(REGEX_PATTERNS.decisionMaker);
  for (const match of nameMatches) {
    names.push(match[1].trim());
  }

  return { emails, phones, names };
}

/**
 * Extract company/organization names with improved filtering
 */
export function extractCompanyNames(text: string): string[] {
  const companies: string[] = [];

  // Look for formal company names (Inc, LLC, Corp, etc.)
  const matches = text.matchAll(REGEX_PATTERNS.company);
  for (const match of matches) {
    const companyName = match[1].trim();

    // Filter out overly long company names (likely false positives)
    if (companyName.length <= 60) {
      companies.push(companyName);
    }
  }

  // Look for contextual end-user patterns
  const endUserMatches = text.matchAll(REGEX_PATTERNS.endUser);
  for (const match of endUserMatches) {
    const companyName = match[1].trim();
    if (companyName.length <= 60) {
      companies.push(companyName);
    }
  }

  // Look for company names in email signatures (after "Thank you," or similar)
  const signaturePattern = /(?:thank you,?|thanks,?|regards,?|best,?)\s*\n?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*\n?\s*((?:[A-Z][A-Za-z0-9&.,'-]+\s*){1,5}(?:Inc|LLC|Corp|Corporation|Ltd|Limited|GmbH)\.?)/gi;
  const signatureMatches = text.matchAll(signaturePattern);
  for (const match of signatureMatches) {
    const companyName = match[1].trim();
    if (companyName.length <= 60) {
      companies.push(companyName);
    }
  }

  // Deduplicate and sort by length (prefer shorter, more specific names)
  const uniqueCompanies = [...new Set(companies)];
  return uniqueCompanies.sort((a, b) => a.length - b.length);
}

/**
 * Extract project names
 */
export function extractProjectNames(text: string): string[] {
  const projects: string[] = [];

  const matches = text.matchAll(REGEX_PATTERNS.projectName);
  for (const match of matches) {
    projects.push(match[1].trim());
  }

  return projects;
}

/**
 * Apply Layer 2 Regex-based extraction to a message
 * ENHANCED with advanced extraction intelligence
 */
export function applyLayer2Extraction(message: ParsedEmailMessage): Partial<ExtractedDeal> {
  const text = message.cleaned_body;
  const extracted: Partial<ExtractedDeal> = {};

  // ENHANCED: Extract financial data with context
  const valueResults = extractValueWithContext(text);
  if (valueResults.length > 0) {
    // Use highest confidence value
    const best = valueResults[0];
    extracted.deal_value = best.value;
    extracted.currency = best.currency;

    logger.info('Enhanced value extraction', {
      value: best.value,
      confidence: best.confidence,
      label: best.label
    });
  } else {
    // Fallback to old method
    const financials = extractFinancialData(text);
    if (financials.length > 0) {
      const largest = financials.reduce((max, curr) => curr.value > max.value ? curr : max);
      extracted.deal_value = largest.value;
      extracted.currency = largest.currency;
    }
  }

  // ENHANCED: Extract companies with context and role identification
  const companyResults = extractCompaniesWithContext(text);
  if (companyResults.length > 0) {
    // Prefer customers over other types
    const customer = companyResults.find(c => c.type === 'customer') || companyResults[0];
    extracted.end_user_name = customer.name;

    logger.info('Enhanced company extraction', {
      name: customer.name,
      type: customer.type,
      confidence: customer.confidence
    });
  } else {
    // Fallback to old method
    const companies = extractCompanyNames(text);
    if (companies.length > 0) {
      extracted.end_user_name = companies[0];
    }
  }

  // ENHANCED: Extract products/commodities
  const productResults = extractProducts(text);
  if (productResults.length > 0) {
    const products = productResults.map(p => p.product).join(', ');
    extracted.product_name = products;
    extracted.solution_category = productResults[0].category;

    logger.info('Product extraction', {
      products: products,
      category: productResults[0].category
    });
  }

  // ENHANCED: Detect deal stage
  const stageInfo = detectDealStage(text);
  if (stageInfo.confidence > 0.7) {
    extracted.deal_type = stageInfo.stage;

    logger.info('Deal stage detected', {
      stage: stageInfo.stage,
      confidence: stageInfo.confidence,
      indicators: stageInfo.indicators
    });
  }

  // ENHANCED: Extract timeline information
  const timeline = extractTimeline(text);
  if (timeline.closeDate) {
    extracted.expected_close_date = timeline.closeDate;
  }
  if (timeline.durationDays) {
    extracted.registration_term_days = timeline.durationDays;
  }

  // Extract dates (fallback)
  const dates = extractDates(text);
  if (dates.length > 0 && !extracted.expected_close_date) {
    const now = new Date();
    const futureDates = dates.filter(d => d > now);
    if (futureDates.length > 0) {
      extracted.expected_close_date = futureDates[0];
    }
  }

  // Extract contact info
  const contacts = extractContactInfo(text);
  if (contacts.names.length > 0) {
    extracted.decision_maker_contact = contacts.names[0];
  }
  if (contacts.emails.length > 0) {
    extracted.decision_maker_email = contacts.emails[0];
  }
  if (contacts.phones.length > 0) {
    extracted.decision_maker_phone = contacts.phones[0];
  }

  // Extract project names
  const projects = extractProjectNames(text);
  if (projects.length > 0) {
    extracted.project_name = projects[0];
  }

  return extracted;
}

// ============================================================================
// LAYER 3: CONTEXTUAL ENTITY EXTRACTION (Simplified NLP)
// ============================================================================

/**
 * Identify deal type from keywords
 */
export function identifyDealType(text: string): string | undefined {
  const textLower = text.toLowerCase();

  // Check for co-sell
  if (textLower.match(/co[-\s]?sell|joint[-\s]?sell/i)) {
    return 'co-sell';
  }

  // Check for partner-led
  if (textLower.match(/partner[-\s]?led|partner[-\s]?driven/i)) {
    return 'partner-led';
  }

  // Check for RFP/tender
  if (textLower.match(/\brfp\b|request for proposal|tender|bid/i)) {
    return 'rfp';
  }

  // Check for public tender
  if (textLower.match(/public[-\s]?tender|government[-\s]?bid/i)) {
    return 'public-tender';
  }

  return undefined;
}

/**
 * Identify pricing model
 */
export function identifyPricingModel(text: string): string | undefined {
  const textLower = text.toLowerCase();

  if (textLower.match(/subscription|saas|monthly|annual subscription/i)) {
    return 'subscription';
  }

  if (textLower.match(/perpetual|one[-\s]?time|permanent license/i)) {
    return 'perpetual';
  }

  if (textLower.match(/pay[-\s]?as[-\s]?you[-\s]?go|payg|usage[-\s]?based|consumption/i)) {
    return 'pay-as-you-go';
  }

  return undefined;
}

/**
 * Extract deployment environment
 */
export function extractDeploymentEnvironment(text: string): string | undefined {
  const textLower = text.toLowerCase();

  if (textLower.match(/\bazure\b/i)) {
    return 'Azure';
  }

  if (textLower.match(/\baws\b|amazon web services/i)) {
    return 'AWS';
  }

  if (textLower.match(/\bgcp\b|google cloud/i)) {
    return 'GCP';
  }

  if (textLower.match(/on[-\s]?premise|on[-\s]?prem/i)) {
    return 'on-premise';
  }

  if (textLower.match(/hybrid cloud/i)) {
    return 'hybrid';
  }

  return undefined;
}

/**
 * Extract pre-sales efforts
 */
export function extractPreSalesEfforts(text: string): string | undefined {
  const patterns = [
    /(?:qualified the deal|helped (?:with )?budget|met with|demo|presentation|poc|proof of concept)/gi,
  ];

  const efforts: string[] = [];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      // Get surrounding context (±50 chars)
      const startIdx = Math.max(0, match.index! - 50);
      const endIdx = Math.min(text.length, match.index! + match[0].length + 50);
      const context = text.substring(startIdx, endIdx).trim();
      efforts.push(context);
    }
  }

  return efforts.length > 0 ? efforts.join('; ') : undefined;
}

/**
 * Apply Layer 3 contextual extraction
 */
export function applyLayer3Extraction(message: ParsedEmailMessage): Partial<ExtractedDeal> {
  const text = message.cleaned_body;
  const extracted: Partial<ExtractedDeal> = {};

  extracted.deal_type = identifyDealType(text);
  extracted.pricing_model = identifyPricingModel(text);
  extracted.deployment_environment = extractDeploymentEnvironment(text);
  extracted.pre_sales_efforts = extractPreSalesEfforts(text);

  return extracted;
}

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

/**
 * Calculate confidence score for an extracted deal
 */
export function calculateConfidenceScore(
  deal: Partial<ExtractedDeal>,
  message: ParsedEmailMessage
): number {
  let score = 0.0;
  const weights = {
    tier1Match: 0.30,
    tier2Match: 0.15,
    tier3Match: 0.05,
    completeness: 0.30,
    corroboration: 0.20,
  };

  // Score based on keyword tier matches
  if (message.tier1_matches.length > 0) {
    score += weights.tier1Match * Math.min(message.tier1_matches.length / 3, 1.0);
  }

  if (message.tier2_matches.length > 0) {
    score += weights.tier2Match * Math.min(message.tier2_matches.length / 5, 1.0);
  }

  if (message.tier3_matches.length > 0) {
    score += weights.tier3Match * Math.min(message.tier3_matches.length / 10, 1.0);
  }

  // Score based on data completeness
  const coreFields = [
    'end_user_name',
    'deal_value',
    'product_name',
    'deal_type',
    'decision_maker_contact',
  ];

  const populatedFields = coreFields.filter(field =>
    deal[field as keyof ExtractedDeal] !== undefined &&
    deal[field as keyof ExtractedDeal] !== null &&
    deal[field as keyof ExtractedDeal] !== ''
  );

  const completenessRatio = populatedFields.length / coreFields.length;
  score += weights.completeness * completenessRatio;

  // Corroboration bonus: if multiple extraction methods found the same data
  let corroborationBonus = 0;
  if (deal.deal_value && deal.deal_value > 0) {
    corroborationBonus += 0.05; // Financial data found
  }
  if (deal.end_user_name) {
    corroborationBonus += 0.05; // Company name found
  }
  if (deal.decision_maker_contact || deal.decision_maker_email) {
    corroborationBonus += 0.05; // Contact info found
  }
  if (deal.deal_type) {
    corroborationBonus += 0.05; // Deal type identified
  }

  score += Math.min(corroborationBonus, weights.corroboration);

  return Math.min(score, 1.0); // Cap at 1.0
}

/**
 * Scan message for tiered keywords
 */
export function scanForKeywords(text: string): {
  tier1: string[];
  tier2: string[];
  tier3: string[];
} {
  const textLower = text.toLowerCase();
  const tier1: string[] = [];
  const tier2: string[] = [];
  const tier3: string[] = [];

  for (const keyword of TIER1_KEYWORDS) {
    if (textLower.includes(keyword)) {
      tier1.push(keyword);
    }
  }

  for (const keyword of TIER2_KEYWORDS) {
    if (textLower.includes(keyword)) {
      tier2.push(keyword);
    }
  }

  for (const keyword of TIER3_KEYWORDS) {
    if (textLower.includes(keyword)) {
      tier3.push(keyword);
    }
  }

  return { tier1, tier2, tier3 };
}

// ============================================================================
// SYNTHESIS - COMBINE ALL LAYERS
// ============================================================================

/**
 * Process email thread and extract deals
 */
export function processThread(thread: EmailThread): ExtractedDeal[] {
  const extractedDeals: ExtractedDeal[] = [];

  // Scan all messages for keywords first
  for (const message of thread.messages) {
    const keywords = scanForKeywords(message.cleaned_body);
    message.tier1_matches = keywords.tier1;
    message.tier2_matches = keywords.tier2;
    message.tier3_matches = keywords.tier3;
  }

  // Process each message with any keyword matches (including Tier 3)
  for (const message of thread.messages) {
    // Skip if no keywords found at all
    if (message.tier1_matches.length === 0 &&
        message.tier2_matches.length === 0 &&
        message.tier3_matches.length === 0) {
      continue;
    }

    // Apply Layer 2 (Regex extraction)
    const layer2Data = applyLayer2Extraction(message);

    // Apply Layer 3 (Contextual extraction)
    const layer3Data = applyLayer3Extraction(message);

    // Extract sender email and domain for vendor identification
    const senderEmail = message.from || '';
    const senderDomain = senderEmail.includes('@')
      ? senderEmail.split('@')[1].toLowerCase()
      : '';

    // Combine data from all layers
    const combinedDeal: Partial<ExtractedDeal> = {
      ...layer2Data,
      ...layer3Data,
      source_email_id: message.message_id,
      source_email_from: senderEmail,
      source_email_domain: senderDomain,
      tier1_matches: message.tier1_matches,
      tier2_matches: message.tier2_matches,
      tier3_matches: message.tier3_matches,
      extraction_method: 'multi-layer',
      registration_date: message.date,
    };

    // Calculate confidence score
    const confidence = calculateConfidenceScore(combinedDeal, message);
    combinedDeal.confidence_score = confidence;

    // Lower confidence threshold to 0.15 (from 0.3)
    if (confidence >= 0.15) {
      extractedDeals.push(combinedDeal as ExtractedDeal);
      logger.info(`Extracted deal with confidence ${confidence.toFixed(2)}`, {
        email_id: message.message_id,
        end_user: combinedDeal.end_user_name,
        deal_value: combinedDeal.deal_value,
      });
    }
  }

  return extractedDeals;
}

export default {
  extractFinancialData,
  extractDates,
  extractContactInfo,
  extractCompanyNames,
  extractProjectNames,
  applyLayer2Extraction,
  applyLayer3Extraction,
  calculateConfidenceScore,
  scanForKeywords,
  processThread,
};
