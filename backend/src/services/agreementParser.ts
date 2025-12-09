/**
 * Agreement Parser Service
 * Parses vendor manufacturing/partner agreements and extracts
 * commission rates, key terms, and contract details using AI.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../config';
import { parsePDFFile } from '../parsers/pdfParser';
import logger from '../utils/logger';

// Types for agreement extraction
export interface CommissionRate {
  percentage: number;
  description?: string;
  min?: number;
  max?: number | null;
  product?: string;
}

export interface CommissionStructure {
  type: 'flat' | 'tiered' | 'product';
  rates: CommissionRate[];
}

export interface KeyTerms {
  exclusivity?: 'exclusive' | 'non-exclusive' | 'semi-exclusive';
  territory?: string;
  payment_terms?: string;
  min_order_quantity?: string;
  min_order_value?: number;
  termination_notice_days?: number;
  termination_clauses?: string;
  liability_limitation?: string;
  warranty_terms?: string;
  intellectual_property?: string;
  confidentiality?: string;
  insurance_requirements?: string;
  compliance_requirements?: string;
  additional_terms?: string[];
}

export interface AgreementExtraction {
  agreementType: 'manufacturing' | 'distribution' | 'reseller' | 'partnership' | 'other';
  effectiveDate: string | null;
  expirationDate: string | null;
  autoRenewal: boolean;
  renewalTerms: string | null;
  commissionStructure: CommissionStructure | null;
  keyTerms: KeyTerms;
  confidence: number;
  model: string;
  tokensUsed: number;
  extractionTimeMs: number;
}

// Anthropic client singleton
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic API key not configured. Set ANTHROPIC_API_KEY environment variable.');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

// OpenAI client singleton for fallback
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!openaiClient) {
    const apiKey = config.ai?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Agreement extraction prompt
 */
const AGREEMENT_EXTRACTION_PROMPT = `You are an expert contract analyst. Analyze the following vendor/manufacturing agreement and extract structured data.

Extract the following information:

1. AGREEMENT TYPE: Categorize as one of: manufacturing, distribution, reseller, partnership, or other

2. DATES:
   - Effective date (when the agreement starts)
   - Expiration date (when it ends)
   - Auto-renewal status (true/false)
   - Renewal terms (description)

3. COMMISSION STRUCTURE: Identify the commission/margin structure:
   - Type: "flat" (single rate), "tiered" (volume-based), or "product" (product-specific)
   - For flat: { type: "flat", rates: [{ percentage: X, description: "..." }] }
   - For tiered: { type: "tiered", rates: [{ min: X, max: Y, percentage: Z }, ...] }
   - For product: { type: "product", rates: [{ product: "Name", percentage: X }, ...] }

4. KEY TERMS: Extract these specific terms if present:
   - exclusivity: "exclusive", "non-exclusive", or "semi-exclusive"
   - territory: geographic scope
   - payment_terms: e.g., "Net 30", "2% 10 Net 30"
   - min_order_quantity: minimum order requirement
   - min_order_value: minimum order value in USD
   - termination_notice_days: number of days notice required
   - termination_clauses: summary of termination conditions
   - liability_limitation: any liability caps or limitations
   - warranty_terms: warranty provisions
   - intellectual_property: IP ownership/licensing terms
   - confidentiality: confidentiality requirements
   - insurance_requirements: any required insurance
   - compliance_requirements: regulatory/compliance requirements
   - additional_terms: array of other notable terms

Respond ONLY with valid JSON in this exact format (no markdown code blocks, no explanation):
{
  "agreementType": "manufacturing|distribution|reseller|partnership|other",
  "effectiveDate": "YYYY-MM-DD" or null,
  "expirationDate": "YYYY-MM-DD" or null,
  "autoRenewal": true or false,
  "renewalTerms": "string" or null,
  "commissionStructure": { "type": "...", "rates": [...] } or null,
  "keyTerms": { ... },
  "confidence": 0.0-1.0
}

AGREEMENT TEXT:
`;

/**
 * Extract agreement data from PDF file
 */
export async function extractAgreementFromPDF(filePath: string): Promise<AgreementExtraction> {
  const startTime = Date.now();

  // Extract text from PDF
  logger.info('Extracting text from agreement PDF', { filePath });
  const text = await parsePDFFile(filePath);

  if (!text || text.trim().length < 100) {
    throw new Error('PDF appears to be empty or contains insufficient text');
  }

  // Truncate text if too long (Claude has context limits)
  const maxTextLength = 100000; // ~100k chars should be within limits
  const truncatedText = text.length > maxTextLength
    ? text.substring(0, maxTextLength) + '\n\n[Document truncated due to length]'
    : text;

  logger.info('Calling AI for agreement extraction', {
    filePath,
    textLength: truncatedText.length,
  });

  try {
    // Try Claude first
    const result = await extractWithClaude(truncatedText);
    result.extractionTimeMs = Date.now() - startTime;
    return result;
  } catch (claudeError: unknown) {
    const claudeMessage = claudeError instanceof Error ? claudeError.message : 'Unknown error';
    logger.warn('Claude extraction failed, trying OpenAI fallback', {
      error: claudeMessage,
    });

    // Try OpenAI fallback
    const openai = getOpenAIClient();
    if (openai) {
      try {
        const result = await extractWithOpenAI(truncatedText);
        result.extractionTimeMs = Date.now() - startTime;
        return result;
      } catch (openaiError: unknown) {
        const openaiMessage = openaiError instanceof Error ? openaiError.message : 'Unknown error';
        logger.error('OpenAI fallback also failed', { error: openaiMessage });
        throw new Error(`Both Claude and OpenAI extraction failed: Claude: ${claudeMessage}, OpenAI: ${openaiMessage}`);
      }
    }

    throw claudeError;
  }
}

/**
 * Extract using Claude
 */
async function extractWithClaude(text: string): Promise<AgreementExtraction> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: AGREEMENT_EXTRACTION_PROMPT + text,
      },
    ],
  });

  // Extract text response
  const responseContent = response.content[0];
  if (responseContent.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  const responseText = responseContent.text.trim();

  // Parse JSON response
  let parsed: Record<string, unknown>;
  try {
    // Try to parse directly
    parsed = JSON.parse(responseText);
  } catch {
    // Try to extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse Claude response as JSON');
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  return {
    agreementType: (parsed.agreementType as AgreementExtraction['agreementType']) || 'other',
    effectiveDate: (parsed.effectiveDate as string) || null,
    expirationDate: (parsed.expirationDate as string) || null,
    autoRenewal: (parsed.autoRenewal as boolean) || false,
    renewalTerms: (parsed.renewalTerms as string) || null,
    commissionStructure: parsed.commissionStructure as CommissionStructure | null,
    keyTerms: (parsed.keyTerms as KeyTerms) || {},
    confidence: (parsed.confidence as number) || 0.7,
    model: 'claude-sonnet-4-20250514',
    tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0,
    extractionTimeMs: 0,
  };
}

/**
 * Extract using OpenAI (fallback)
 */
async function extractWithOpenAI(text: string): Promise<AgreementExtraction> {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OpenAI client not available');
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: AGREEMENT_EXTRACTION_PROMPT + text,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const responseText = response.choices[0]?.message?.content?.trim();
  if (!responseText) {
    throw new Error('Empty response from OpenAI');
  }

  const parsed = JSON.parse(responseText) as Record<string, unknown>;

  return {
    agreementType: (parsed.agreementType as AgreementExtraction['agreementType']) || 'other',
    effectiveDate: (parsed.effectiveDate as string) || null,
    expirationDate: (parsed.expirationDate as string) || null,
    autoRenewal: (parsed.autoRenewal as boolean) || false,
    renewalTerms: (parsed.renewalTerms as string) || null,
    commissionStructure: parsed.commissionStructure as CommissionStructure | null,
    keyTerms: (parsed.keyTerms as KeyTerms) || {},
    confidence: (parsed.confidence as number) || 0.7,
    model: 'gpt-4-turbo-preview',
    tokensUsed: response.usage?.total_tokens || 0,
    extractionTimeMs: 0,
  };
}

/**
 * Validate and normalize commission structure
 */
export function validateCommissionStructure(structure: CommissionStructure | null): CommissionStructure | null {
  if (!structure) return null;

  const { type, rates } = structure;

  if (!type || !['flat', 'tiered', 'product'].includes(type)) {
    return null;
  }

  if (!Array.isArray(rates) || rates.length === 0) {
    return null;
  }

  // Validate rates based on type
  const validRates = rates.filter((rate) => {
    if (typeof rate.percentage !== 'number' || rate.percentage < 0 || rate.percentage > 100) {
      return false;
    }

    if (type === 'tiered') {
      if (typeof rate.min !== 'number') return false;
    }

    if (type === 'product') {
      if (!rate.product || typeof rate.product !== 'string') return false;
    }

    return true;
  });

  if (validRates.length === 0) return null;

  return {
    type,
    rates: validRates,
  };
}

/**
 * Format commission structure for display
 */
export function formatCommissionStructure(structure: CommissionStructure | null): string {
  if (!structure) return 'Not specified';

  const { type, rates } = structure;

  if (type === 'flat' && rates.length > 0) {
    return `${rates[0].percentage}% flat rate`;
  }

  if (type === 'tiered') {
    return `Tiered: ${rates.length} tiers (${rates[0].percentage}% - ${rates[rates.length - 1].percentage}%)`;
  }

  if (type === 'product') {
    return `Product-specific: ${rates.length} product rates`;
  }

  return 'Custom structure';
}

export default {
  extractAgreementFromPDF,
  validateCommissionStructure,
  formatCommissionStructure,
};
