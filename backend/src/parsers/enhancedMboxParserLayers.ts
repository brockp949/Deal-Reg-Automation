/**
 * Enhanced MBOX Parser - Layers 2 & 3
 * Regex Extraction and Confidence Scoring
 */

import { REGEX_PATTERNS, TIER1_KEYWORDS, TIER2_KEYWORDS, TIER3_KEYWORDS, NEXT_STEPS_KEYWORDS, DEAL_TYPE_KEYWORDS, PRICING_MODEL_KEYWORDS, ExtractedDeal, ParsedEmailMessage, EmailThread } from './enhancedMboxParser';
import logger from '../utils/logger';
import {
  extractValueWithContext,
  extractCompaniesWithContext,
  extractProducts,
  detectDealStage,
  extractTimeline,
  calculateEnhancedConfidence,
} from './enhancedExtraction';
import { getEntityExtractor } from '../skills/SemanticEntityExtractor';
import { isSkillEnabled } from '../config/claude';

const MIN_BODY_LENGTH = 20;

function getMessageBody(message: ParsedEmailMessage): string {
  const cleaned = message.cleaned_body?.trim() || '';
  if (cleaned.length >= MIN_BODY_LENGTH) {
    return cleaned;
  }

  const bodyText = message.body_text?.trim();
  if (bodyText) {
    return bodyText;
  }

  return cleaned || message.subject || '';
}

function getKeywordScanText(message: ParsedEmailMessage): string {
  const body = getMessageBody(message);
  const subject = message.subject?.trim();
  if (subject && body) {
    return `${subject}\n${body}`;
  }
  return subject || body || '';
}

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

  // Try JPY patterns
  matches = text.matchAll(REGEX_PATTERNS.currency.jpy);
  for (const match of matches) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(value)) {
      results.push({ value, currency: 'JPY' });
    }
  }

  // Try INR patterns
  matches = text.matchAll(REGEX_PATTERNS.currency.inr);
  for (const match of matches) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(value)) {
      results.push({ value, currency: 'INR' });
    }
  }

  // Try CNY patterns
  matches = text.matchAll(REGEX_PATTERNS.currency.cny);
  for (const match of matches) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(value)) {
      results.push({ value, currency: 'CNY' });
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
  const text = getMessageBody(message);
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
// LAYER 2.5: SEMANTIC ENTITY EXTRACTION (AI-Powered)
// ============================================================================

/**
 * Apply semantic entity extraction using Claude skill
 * This replaces/enhances regex-based extraction with AI-powered understanding
 */
export async function applySemanticExtraction(message: ParsedEmailMessage): Promise<Partial<ExtractedDeal>> {
  const extracted: Partial<ExtractedDeal> = {};

  // Check if skill is enabled
  if (!isSkillEnabled('semanticEntityExtractor')) {
    logger.debug('SemanticEntityExtractor skill disabled, skipping semantic extraction');
    return extracted;
  }

  try {
    logger.info('Using SemanticEntityExtractor skill for email entity extraction');
    const extractor = getEntityExtractor();

    const text = `${getMessageBody(message)}\n\nSubject: ${message.subject}`;

    // Request comprehensive entity extraction
    const result = await extractor.extract({
      text,
      entityTypes: [
        'organization', // For end user / company names
        'person', // For decision makers
        'contact', // For contact information
        'email', // Email addresses
        'phone', // Phone numbers
        'value', // Deal values
        'currency', // Currency codes
        'date', // Timeline dates
        'product', // Product names
        'deal', // Deal names
      ],
      context: {
        documentType: 'email',
        language: 'auto-detect',
        additionalInfo: {
          subject: message.subject,
          from: message.from,
          hasKeywords: message.tier1_matches.length > 0 || message.tier2_matches.length > 0,
        },
      },
    });

    logger.info('Semantic entity extraction completed', {
      entityCount: result.entities.length,
      averageConfidence: result.summary.averageConfidence,
      byType: result.summary.byType,
    });

    // Map extracted entities to ExtractedDeal fields

    // Extract end user / customer organization
    const customerOrg = result.entities.find(e =>
      e.type === 'organization' &&
      e.confidence > 0.7 &&
      e.metadata?.role !== 'vendor'
    );
    if (customerOrg) {
      extracted.end_user_name = customerOrg.normalizedValue || customerOrg.value;
    }

    // Extract decision maker
    const decisionMaker = result.entities.find(e =>
      e.type === 'person' &&
      e.confidence > 0.7
    );
    if (decisionMaker) {
      extracted.decision_maker_contact = decisionMaker.normalizedValue || decisionMaker.value;
    }

    // Extract contact information
    const contactEmail = result.entities.find(e =>
      e.type === 'email' &&
      e.confidence > 0.7 &&
      !e.value.includes(message.from) // Exclude sender's own email
    );
    if (contactEmail) {
      extracted.decision_maker_email = contactEmail.value;
    }

    const contactPhone = result.entities.find(e =>
      e.type === 'phone' &&
      e.confidence > 0.7
    );
    if (contactPhone) {
      extracted.decision_maker_phone = contactPhone.normalizedValue || contactPhone.value;
    }

    // Extract deal value and currency
    const dealValue = result.entities.find(e =>
      e.type === 'value' &&
      e.confidence > 0.7
    );
    if (dealValue && dealValue.metadata?.numeric) {
      extracted.deal_value = dealValue.metadata.numeric;
      extracted.currency = dealValue.metadata.currency || 'USD';
    }

    // Extract dates for timeline
    const dates = result.entities
      .filter(e => e.type === 'date' && e.confidence > 0.6)
      .map(e => {
        const dateStr = e.normalizedValue || e.value;
        const date = new Date(dateStr);
        return !isNaN(date.getTime()) ? date : null;
      })
      .filter((d): d is Date => d !== null);

    if (dates.length > 0) {
      const now = new Date();
      const futureDates = dates.filter(d => d > now);
      if (futureDates.length > 0) {
        extracted.expected_close_date = futureDates[0];
      }
    }

    // Extract product names
    const products = result.entities
      .filter(e => e.type === 'product' && e.confidence > 0.6)
      .map(e => e.normalizedValue || e.value);
    if (products.length > 0) {
      extracted.product_name = products.join(', ');
    }

    // Extract deal/project name
    const dealName = result.entities.find(e =>
      e.type === 'deal' &&
      e.confidence > 0.7
    );
    if (dealName) {
      extracted.deal_name = dealName.normalizedValue || dealName.value;
    }

    // Extract relationships for additional context
    const customerRelationships = result.relationships.filter(r =>
      r.relation === 'works_for' ||
      r.relation === 'employed_by'
    );
    for (const rel of customerRelationships) {
      if (rel.entity2Type === 'organization' && !extracted.end_user_name) {
        extracted.end_user_name = rel.entity2;
      }
      if (rel.entity1Type === 'person' && !extracted.decision_maker_contact) {
        extracted.decision_maker_contact = rel.entity1;
      }
    }

    return extracted;
  } catch (error: any) {
    logger.error('Semantic entity extraction failed', {
      error: error.message,
      messageId: message.message_id,
    });
    // Return empty object on error - fallback to regex extraction will be used
    return {};
  }
}

// ============================================================================
// LAYER 3: CONTEXTUAL ENTITY EXTRACTION (Simplified NLP)
// ============================================================================

/**
 * Identify deal type from keywords
 */
export function identifyDealType(text: string): string | undefined {
  const textLower = text.toLowerCase();

  for (const [type, keywords] of Object.entries(DEAL_TYPE_KEYWORDS)) {
    if (keywords.some(keyword => textLower.includes(keyword))) {
      return type;
    }
  }

  return undefined;
}

/**
 * Identify pricing model
 */
export function identifyPricingModel(text: string): string | undefined {
  const textLower = text.toLowerCase();

  for (const [model, keywords] of Object.entries(PRICING_MODEL_KEYWORDS)) {
    if (keywords.some(keyword => textLower.includes(keyword))) {
      return model;
    }
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
 * Extract next steps
 */
export function extractNextSteps(text: string): string[] | undefined {
  const steps: string[] = [];
  const textLower = text.toLowerCase();

  // Check if any next steps keywords are present
  const hasKeywords = NEXT_STEPS_KEYWORDS.some(keyword => textLower.includes(keyword));
  if (!hasKeywords) return undefined;

  // Extract sentences or bullet points containing the keywords
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineLower = line.toLowerCase();

    if (NEXT_STEPS_KEYWORDS.some(keyword => lineLower.includes(keyword))) {
      // Found a header or sentence with keyword
      // If it's a header (short, ends with colon), grab following lines
      if (line.length < 50 && (line.endsWith(':') || i < lines.length - 1)) {
        // Grab up to 5 following lines that look like list items or short sentences
        for (let j = 1; j <= 5; j++) {
          if (i + j >= lines.length) break;
          const nextLine = lines[i + j].trim();
          if (!nextLine) continue;
          if (nextLine.match(/^[-*•\d.]/) || nextLine.length < 100) {
            steps.push(nextLine);
          } else {
            break; // Stop at first non-list-item looking line
          }
        }
      } else {
        // It's a sentence containing the keyword
        steps.push(line);
      }
    }
  }

  return steps.length > 0 ? steps : undefined;
}

/**
 * Apply Layer 3 contextual extraction
 */
export function applyLayer3Extraction(message: ParsedEmailMessage): Partial<ExtractedDeal> {
  const text = getMessageBody(message);
  const extracted: Partial<ExtractedDeal> = {};

  extracted.deal_type = identifyDealType(text);
  extracted.pricing_model = identifyPricingModel(text);
  extracted.deployment_environment = extractDeploymentEnvironment(text);
  extracted.pre_sales_efforts = extractPreSalesEfforts(text);
  extracted.next_steps = extractNextSteps(text);

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
 * Now async to support semantic extraction
 */
export async function processThread(thread: EmailThread): Promise<ExtractedDeal[]> {
  const extractedDeals: ExtractedDeal[] = [];

  // Scan all messages for keywords first
  for (const message of thread.messages) {
    const keywords = scanForKeywords(getKeywordScanText(message));
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

    // Apply Layer 2.5 (Semantic extraction with AI) - runs first for best results
    const semanticData = await applySemanticExtraction(message);

    // Apply Layer 2 (Regex extraction) - fallback for when semantic extraction is disabled
    const layer2Data = applyLayer2Extraction(message);

    // Apply Layer 3 (Contextual extraction)
    const layer3Data = applyLayer3Extraction(message);

    // Extract sender email and domain for vendor identification
    const senderEmail = message.from || '';
    const senderDomain = senderEmail.includes('@')
      ? senderEmail.split('@')[1].toLowerCase()
      : '';

    // Combine data from all layers (semantic data takes priority)
    const combinedDeal: Partial<ExtractedDeal> = {
      ...layer2Data, // Base layer (regex fallback)
      ...layer3Data, // Enhanced contextual extraction
      ...semanticData, // AI-powered extraction (highest priority)
      source_email_id: message.message_id,
      source_email_from: senderEmail,
      source_email_domain: senderDomain,
      tier1_matches: message.tier1_matches,
      tier2_matches: message.tier2_matches,
      tier3_matches: message.tier3_matches,
      extraction_method: Object.keys(semanticData).length > 0 ? 'semantic-ai' : 'multi-layer',
      registration_date: message.date,
    };

    // Calculate confidence score
    const confidence = calculateConfidenceScore(combinedDeal, message);
    combinedDeal.confidence_score = confidence;

    // Boost confidence if semantic extraction was used and successful
    if (Object.keys(semanticData).length > 3) {
      combinedDeal.confidence_score = Math.min(confidence * 1.2, 1.0);
      logger.info('Semantic extraction boosted confidence', {
        original: confidence,
        boosted: combinedDeal.confidence_score,
      });
    }

    // Lower confidence threshold to 0.15 (from 0.3)
    if (combinedDeal.confidence_score >= 0.15) {
      extractedDeals.push(combinedDeal as ExtractedDeal);
      logger.info(`Extracted deal with confidence ${combinedDeal.confidence_score.toFixed(2)}`, {
        email_id: message.message_id,
        end_user: combinedDeal.end_user_name,
        deal_value: combinedDeal.deal_value,
        extraction_method: combinedDeal.extraction_method,
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
  applySemanticExtraction,
  applyLayer3Extraction,
  calculateConfidenceScore,
  scanForKeywords,
  processThread,
};
