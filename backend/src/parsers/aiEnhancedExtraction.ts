/**
 * AI-Enhanced Extraction Helpers
 *
 * Wrapper functions that use Claude Skills when enabled,
 * with automatic fallback to regex-based extraction.
 *
 * This provides a clean integration point for existing parsers
 * without requiring major refactoring.
 */

import { getEntityExtractor, type EntityType } from '../skills/SemanticEntityExtractor';
import { getBuyingSignalAnalyzer, type BuyingSignalRequest } from '../skills/BuyingSignalAnalyzer';
import { config } from '../config';
import logger from '../utils/logger';

/**
 * Extract entities from text using AI when enabled
 *
 * @param text Text to extract entities from
 * @param entityTypes Types of entities to extract
 * @param context Optional context (document type, vendor name, etc.)
 * @param fallbackExtractor Fallback function if AI is disabled or fails
 * @returns Extracted entities
 */
export async function extractEntitiesWithAI<T>(
  text: string,
  entityTypes: EntityType[],
  context?: {
    documentType?: string;
    language?: string;
    vendorName?: string;
  },
  fallbackExtractor?: () => T
): Promise<T> {
  // Check if AI extraction is enabled
  if (!config.featureFlags.semanticEntityExtraction) {
    logger.debug('Semantic entity extraction disabled, using fallback');
    return fallbackExtractor ? fallbackExtractor() : ({} as T);
  }

  try {
    logger.debug('Attempting AI-powered entity extraction', {
      textLength: text.length,
      entityTypes,
    });

    const extractor = getEntityExtractor();
    const result = await extractor.extract({
      text,
      entityTypes,
      context,
    });

    logger.info('AI entity extraction completed', {
      entityCount: result.entities.length,
      averageConfidence: result.summary.averageConfidence,
    });

    // Convert to expected format
    const extracted: any = {};

    // Extract specific entities
    for (const entity of result.entities) {
      if (entity.confidence >= 0.7) {
        // Only use high-confidence extractions
        switch (entity.type) {
          case 'vendor':
            if (!extracted.vendor_name && entity.normalizedValue) {
              extracted.vendor_name = entity.normalizedValue;
            }
            break;
          case 'deal':
            if (!extracted.deal_name) {
              extracted.deal_name = entity.value;
            }
            break;
          case 'contact':
          case 'person':
            if (!extracted.contact_name) {
              extracted.contact_name = entity.value;
            }
            break;
          case 'email':
            if (!extracted.contact_email) {
              extracted.contact_email = entity.value;
            }
            break;
          case 'phone':
            if (!extracted.contact_phone && entity.normalizedValue) {
              extracted.contact_phone = entity.normalizedValue;
            }
            break;
          case 'value':
          case 'currency':
            if (entity.metadata?.numeric && !extracted.deal_value) {
              extracted.deal_value = entity.metadata.numeric;
              extracted.currency = entity.metadata.currency || 'USD';
            }
            break;
          case 'date':
            if (entity.normalizedValue && !extracted.date) {
              extracted.date = entity.normalizedValue;
            }
            break;
        }
      }
    }

    // Add relationships as notes
    if (result.relationships.length > 0) {
      const relationshipNotes = result.relationships
        .map(r => `${r.entity1} ${r.relation} ${r.entity2}`)
        .join('; ');
      extracted.relationships = relationshipNotes;
    }

    return extracted as T;
  } catch (error: any) {
    logger.error('AI entity extraction failed, using fallback', {
      error: error.message,
    });

    // Fallback to regex-based extraction
    return fallbackExtractor ? fallbackExtractor() : ({} as T);
  }
}

/**
 * Analyze buying signals using AI when enabled
 *
 * @param request Buying signal analysis request
 * @param fallbackAnalyzer Fallback function if AI is disabled or fails
 * @returns Buying signal analysis
 */
export async function analyzeBuyingSignalsWithAI<T>(
  request: BuyingSignalRequest,
  fallbackAnalyzer?: () => T
): Promise<T | {
  overallScore: number;
  signals: Array<{ type: string; category: string; text: string; score: number; sentiment: string }>;
  objections: Array<{ type: string; severity: string; text: string }>;
  isRegisterable: boolean;
  confidence: number;
  summary: string;
  momentum: { direction: string; velocity: number; confidence: number };
  recommendations: string[];
}> {
  // Check if AI analysis is enabled
  if (!config.featureFlags.buyingSignalAnalyzer) {
    logger.debug('Buying signal analyzer disabled, using fallback');
    return fallbackAnalyzer ? fallbackAnalyzer() : ({
      overallScore: 0,
      signals: [],
      objections: [],
      isRegisterable: false,
      confidence: 0,
      summary: 'AI analysis disabled',
      momentum: { direction: 'stable' as const, velocity: 0, confidence: 0 },
      recommendations: [],
    } as T);
  }

  try {
    logger.debug('Attempting AI-powered buying signal analysis', {
      hasTranscript: !!request.transcript,
      emailCount: request.emailThread?.length || 0,
    });

    const analyzer = getBuyingSignalAnalyzer();
    const result = await analyzer.analyze(request);

    logger.info('AI buying signal analysis completed', {
      overallScore: result.overallScore,
      signalCount: result.signals.length,
      isRegisterable: result.isRegisterable,
      confidence: result.confidence,
    });

    return result as any;
  } catch (error: any) {
    logger.error('AI buying signal analysis failed, using fallback', {
      error: error.message,
    });

    // Fallback to regex-based analysis
    return fallbackAnalyzer ? fallbackAnalyzer() : ({
      overallScore: 0,
      signals: [],
      objections: [],
      isRegisterable: false,
      confidence: 0,
      summary: 'Fallback: AI analysis failed',
      momentum: { direction: 'stable' as const, velocity: 0, confidence: 0 },
      recommendations: [],
    } as T);
  }
}

/**
 * Helper to extract vendor name from text using AI
 */
export async function extractVendorNameWithAI(
  text: string,
  fallback?: string
): Promise<string | null> {
  const result = await extractEntitiesWithAI<{ vendor_name?: string }>(
    text,
    ['vendor', 'organization'],
    { documentType: 'email' },
    () => ({ vendor_name: fallback })
  );

  return result.vendor_name || fallback || null;
}

/**
 * Helper to extract deal name from text using AI
 */
export async function extractDealNameWithAI(
  text: string,
  fallback?: string
): Promise<string | null> {
  const result = await extractEntitiesWithAI<{ deal_name?: string }>(
    text,
    ['deal', 'product'],
    { documentType: 'email' },
    () => ({ deal_name: fallback })
  );

  return result.deal_name || fallback || null;
}

/**
 * Helper to extract contact information from text using AI
 */
export async function extractContactWithAI(
  text: string,
  fallback?: { name?: string; email?: string; phone?: string }
): Promise<{ name?: string; email?: string; phone?: string }> {
  const result = await extractEntitiesWithAI<{
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
  }>(
    text,
    ['contact', 'person', 'email', 'phone'],
    { documentType: 'email' },
    () => ({
      contact_name: fallback?.name,
      contact_email: fallback?.email,
      contact_phone: fallback?.phone,
    })
  );

  return {
    name: result.contact_name || fallback?.name,
    email: result.contact_email || fallback?.email,
    phone: result.contact_phone || fallback?.phone,
  };
}

/**
 * Helper to extract monetary value from text using AI
 */
export async function extractDealValueWithAI(
  text: string,
  fallback?: number
): Promise<{ value: number | null; currency: string }> {
  const result = await extractEntitiesWithAI<{
    deal_value?: number;
    currency?: string;
  }>(
    text,
    ['value', 'currency'],
    { documentType: 'email' },
    () => ({ deal_value: fallback, currency: 'USD' })
  );

  return {
    value: result.deal_value || fallback || null,
    currency: result.currency || 'USD',
  };
}

export default {
  extractEntitiesWithAI,
  analyzeBuyingSignalsWithAI,
  extractVendorNameWithAI,
  extractDealNameWithAI,
  extractContactWithAI,
  extractDealValueWithAI,
};
