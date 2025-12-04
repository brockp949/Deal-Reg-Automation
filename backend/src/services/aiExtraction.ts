import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config';
import { query } from '../db';
import logger from '../utils/logger';

// Types for AI extraction
export interface AIExtractionResult {
  entities: ExtractedEntity[];
  confidence: number;
  model: string;
  promptVersion: string;
  tokensUsed: number;
  extractionTimeMs: number;
  cached: boolean;
}

export interface ExtractedEntity {
  type: 'deal' | 'vendor' | 'contact';
  data: Record<string, any>;
  confidence: number;
  sourceLocation?: string;
  reasoning?: string;
}

export interface DealExtraction {
  dealName: string;
  customerName: string;
  dealValue?: number;
  currency?: string;
  closeDate?: string;
  registrationDate?: string;
  status?: string;
  vendorName?: string;
  description?: string;
  confidence: number;
  sourceLocation?: string;
  reasoning?: string;
}

export interface VendorExtraction {
  vendorName: string;
  normalizedName: string;
  aliases?: string[];
  emailDomains?: string[];
  products?: string[];
  confidence: number;
  reasoning?: string;
}

export interface ContactExtraction {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  company?: string;
  confidence: number;
  sourceLocation?: string;
  reasoning?: string;
}

export interface ValueExtraction {
  value: number;
  currency: string;
  confidence: number;
  sourceText: string;
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
      return null; // No OpenAI key configured, fallback not available
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// Check if fallback is available
function isFallbackAvailable(): boolean {
  return !!(config.ai?.openaiApiKey || process.env.OPENAI_API_KEY);
}

// Prompt template cache
const promptCache = new Map<string, string>();

/**
 * Load a prompt template from the prompts directory
 */
async function loadPromptTemplate(templateName: string): Promise<string> {
  if (promptCache.has(templateName)) {
    return promptCache.get(templateName)!;
  }

  try {
    const promptPath = join(__dirname, '../prompts', `${templateName}.md`);
    const content = await readFile(promptPath, 'utf-8');
    promptCache.set(templateName, content);
    return content;
  } catch (error: any) {
    logger.error(`Failed to load prompt template: ${templateName}`, { error: error.message });
    throw new Error(`Prompt template not found: ${templateName}`);
  }
}

/**
 * Generate SHA-256 hash of input text for caching
 */
function hashInput(text: string, extractionType: string, promptVersion: string): string {
  const combined = `${text}|${extractionType}|${promptVersion}`;
  return createHash('sha256').update(combined).digest('hex');
}

/**
 * Check cache for existing extraction
 */
async function checkCache(
  inputHash: string,
  extractionType: string
): Promise<any | null> {
  try {
    const result = await query(
      `SELECT cached_response, hit_count
       FROM ai_extraction_cache
       WHERE input_hash = $1 AND extraction_type = $2`,
      [inputHash, extractionType]
    );

    if (result.rows.length > 0) {
      // Update hit count and last used timestamp
      await query(
        `UPDATE ai_extraction_cache
         SET hit_count = hit_count + 1, last_used_at = CURRENT_TIMESTAMP
         WHERE input_hash = $1`,
        [inputHash]
      );

      logger.debug('AI extraction cache hit', { inputHash, extractionType });
      return result.rows[0].cached_response;
    }
  } catch (error: any) {
    logger.warn('Cache check failed', { error: error.message });
  }

  return null;
}

/**
 * Save extraction result to cache
 */
async function saveToCache(
  inputHash: string,
  extractionType: string,
  promptVersion: string,
  response: any
): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_extraction_cache (input_hash, extraction_type, prompt_version, cached_response)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (input_hash)
       DO UPDATE SET cached_response = $4::jsonb, last_used_at = CURRENT_TIMESTAMP`,
      [inputHash, extractionType, promptVersion, JSON.stringify(response)]
    );
  } catch (error: any) {
    logger.warn('Failed to save to cache', { error: error.message });
  }
}

/**
 * Log AI extraction to database
 */
async function logExtraction(params: {
  sourceFileId?: string;
  extractionType: string;
  inputText: string;
  inputHash: string;
  model: string;
  promptTemplate: string;
  promptVersion: string;
  rawResponse: any;
  extractedEntities: any;
  tokensUsed: number;
  extractionTimeMs: number;
  confidenceScore: number;
  success: boolean;
  errorMessage?: string;
}): Promise<string> {
  try {
    const result = await query(
      `INSERT INTO ai_extraction_logs (
        source_file_id, extraction_type, input_text, input_text_hash,
        ai_model, prompt_template, prompt_version, raw_response, extracted_entities,
        tokens_used, extraction_time_ms, confidence_score, success, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14)
      RETURNING id`,
      [
        params.sourceFileId || null,
        params.extractionType,
        params.inputText.substring(0, 10000), // Truncate very long inputs
        params.inputHash,
        params.model,
        params.promptTemplate,
        params.promptVersion,
        JSON.stringify(params.rawResponse),
        JSON.stringify(params.extractedEntities),
        params.tokensUsed,
        params.extractionTimeMs,
        params.confidenceScore,
        params.success,
        params.errorMessage || null,
      ]
    );
    return result.rows[0].id;
  } catch (error: any) {
    logger.error('Failed to log AI extraction', { error: error.message });
    throw error;
  }
}

/**
 * Update daily usage statistics
 */
async function updateUsageStats(extractionType: string, tokensUsed: number, confidenceScore: number, success: boolean): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_usage_stats (date, extraction_type, total_requests, total_tokens, average_confidence, success_rate)
       VALUES (CURRENT_DATE, $1, 1, $2, $3, $4::int)
       ON CONFLICT (date, extraction_type)
       DO UPDATE SET
         total_requests = ai_usage_stats.total_requests + 1,
         total_tokens = ai_usage_stats.total_tokens + $2,
         average_confidence = (ai_usage_stats.average_confidence * ai_usage_stats.total_requests + $3) / (ai_usage_stats.total_requests + 1),
         success_rate = ((ai_usage_stats.success_rate * ai_usage_stats.total_requests) + $4::int) / (ai_usage_stats.total_requests + 1)`,
      [extractionType, tokensUsed, confidenceScore, success ? 1 : 0]
    );
  } catch (error: any) {
    logger.warn('Failed to update usage stats', { error: error.message });
  }
}

/**
 * Call Anthropic API with retry logic
 */
async function callAnthropicAPI(
  prompt: string,
  systemPrompt: string,
  maxRetries: number = 3
): Promise<{ content: string; tokensUsed: number }> {
  const client = getAnthropicClient();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`Calling Anthropic API (attempt ${attempt}/${maxRetries})`);

      const response = await client.messages.create({
        model: config.aiModel || 'claude-3-5-sonnet-20241022',
        max_tokens: config.aiMaxTokens || 4000,
        temperature: config.aiTemperature || 0.0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Anthropic API');
      }

      const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

      logger.debug('Anthropic API call successful', {
        tokensUsed,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      });

      return {
        content: content.text,
        tokensUsed,
      };
    } catch (error: any) {
      lastError = error;
      logger.warn(`Anthropic API call failed (attempt ${attempt}/${maxRetries})`, {
        error: error.message,
        statusCode: error.status,
      });

      // Don't retry on client errors (4xx)
      if (error.status && error.status >= 400 && error.status < 500) {
        throw error;
      }

      // Exponential backoff
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000;
        logger.debug(`Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('Anthropic API call failed after retries');
}

/**
 * Call OpenAI API with retry logic (fallback provider)
 */
async function callOpenAIAPI(
  prompt: string,
  systemPrompt: string,
  maxRetries: number = 3
): Promise<{ content: string; tokensUsed: number; model: string }> {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OpenAI API key not configured for fallback');
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`Calling OpenAI API (attempt ${attempt}/${maxRetries})`);

      const response = await client.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        max_tokens: config.aiMaxTokens || 4000,
        temperature: config.aiTemperature || 0.0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI API');
      }

      const tokensUsed = (response.usage?.total_tokens) || 0;

      logger.debug('OpenAI API call successful', {
        tokensUsed,
        model: response.model,
      });

      return {
        content,
        tokensUsed,
        model: response.model,
      };
    } catch (error: any) {
      lastError = error;
      logger.warn(`OpenAI API call failed (attempt ${attempt}/${maxRetries})`, {
        error: error.message,
      });

      // Exponential backoff
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('OpenAI API call failed after retries');
}

/**
 * Call AI API with automatic fallback from Claude to OpenAI
 */
async function callAIWithFallback(
  prompt: string,
  systemPrompt: string
): Promise<{ content: string; tokensUsed: number; model: string; usedFallback: boolean }> {
  // Try Claude first
  try {
    const result = await callAnthropicAPI(prompt, systemPrompt);
    return {
      ...result,
      model: config.aiModel || 'claude-3-5-sonnet-20241022',
      usedFallback: false,
    };
  } catch (anthropicError: any) {
    logger.warn('Claude failed, checking for OpenAI fallback', {
      error: anthropicError.message,
      fallbackAvailable: isFallbackAvailable(),
    });

    // Try OpenAI fallback if available
    if (isFallbackAvailable()) {
      try {
        logger.info('Attempting OpenAI fallback');
        const result = await callOpenAIAPI(prompt, systemPrompt);
        return {
          ...result,
          usedFallback: true,
        };
      } catch (openaiError: any) {
        logger.error('OpenAI fallback also failed', { error: openaiError.message });
        // Throw original error if both fail
        throw anthropicError;
      }
    }

    // No fallback available, throw original error
    throw anthropicError;
  }
}

/**
 * Extract entities from text using AI
 */
export async function extractEntitiesWithAI(
  text: string,
  extractionType: 'deal' | 'vendor' | 'contact' | 'all' = 'all',
  context?: {
    sourceFileId?: string;
    sourceType?: string;
    vendorHints?: string[];
  }
): Promise<AIExtractionResult> {
  const startTime = Date.now();
  const promptVersion = 'v1.0.0'; // Update when prompts change

  // Generate hash for caching
  const inputHash = hashInput(text, extractionType, promptVersion);

  // Check cache if enabled
  if (config.aiCacheEnabled !== false) {
    const cachedResult = await checkCache(inputHash, extractionType);
    if (cachedResult) {
      await updateUsageStats(extractionType, 0, cachedResult.confidence, true);
      return {
        ...cachedResult,
        cached: true,
        extractionTimeMs: Date.now() - startTime,
      };
    }
  }

  try {
    // Load prompt template
    const promptTemplate = await loadPromptTemplate('entity-extraction');

    // Build system prompt
    const systemPrompt = `You are an expert at extracting structured deal registration information from unstructured text.
Extract deals, vendors, and contacts with high accuracy. Always provide confidence scores.
Output valid JSON only, with no additional text or formatting.`;

    // Build user prompt with context
    let userPrompt = promptTemplate.replace('{{TEXT}}', text);
    if (context?.vendorHints && context.vendorHints.length > 0) {
      userPrompt += `\n\nKnown Vendors: ${context.vendorHints.join(', ')}`;
    }
    userPrompt += `\n\nExtraction Type: ${extractionType}`;

    // Call AI API with fallback support
    const { content, tokensUsed, model, usedFallback } = await callAIWithFallback(userPrompt, systemPrompt);

    if (usedFallback) {
      logger.info('Used OpenAI fallback for extraction', { extractionType });
    }

    // Parse JSON response
    let parsedResponse: any;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
      const jsonString = jsonMatch ? jsonMatch[1] : content;
      parsedResponse = JSON.parse(jsonString.trim());
    } catch (error: any) {
      logger.error('Failed to parse AI response as JSON', {
        error: error.message,
        response: content.substring(0, 500)
      });
      throw new Error('Invalid JSON response from AI');
    }

    // Extract entities and confidence
    const entities: ExtractedEntity[] = [];
    let avgConfidence = 0;

    if (parsedResponse.deals) {
      parsedResponse.deals.forEach((deal: any) => {
        entities.push({
          type: 'deal',
          data: deal,
          confidence: deal.confidence || 0.5,
          sourceLocation: deal.sourceLocation,
          reasoning: deal.reasoning,
        });
        avgConfidence += deal.confidence || 0.5;
      });
    }

    if (parsedResponse.vendors) {
      parsedResponse.vendors.forEach((vendor: any) => {
        entities.push({
          type: 'vendor',
          data: vendor,
          confidence: vendor.confidence || 0.5,
          reasoning: vendor.reasoning,
        });
        avgConfidence += vendor.confidence || 0.5;
      });
    }

    if (parsedResponse.contacts) {
      parsedResponse.contacts.forEach((contact: any) => {
        entities.push({
          type: 'contact',
          data: contact,
          confidence: contact.confidence || 0.5,
          sourceLocation: contact.sourceLocation,
          reasoning: contact.reasoning,
        });
        avgConfidence += contact.confidence || 0.5;
      });
    }

    // Calibrate confidence scores
    entities.forEach(entity => {
      entity.confidence = calibrateConfidence(entity.confidence, entity.type, entity.data);
    });

    avgConfidence = entities.length > 0
      ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
      : 0;

    const extractionTimeMs = Date.now() - startTime;
    // Use model from API response (already defined above from callAIWithFallback)

    const result: AIExtractionResult = {
      entities,
      confidence: avgConfidence,
      model,
      promptVersion,
      tokensUsed,
      extractionTimeMs,
      cached: false,
    };

    // Log extraction
    await logExtraction({
      sourceFileId: context?.sourceFileId,
      extractionType,
      inputText: text,
      inputHash,
      model,
      promptTemplate: 'entity-extraction',
      promptVersion,
      rawResponse: parsedResponse,
      extractedEntities: entities,
      tokensUsed,
      extractionTimeMs,
      confidenceScore: avgConfidence,
      success: true,
    });

    // Update usage stats
    await updateUsageStats(extractionType, tokensUsed, avgConfidence, true);

    // Save to cache
    if (config.aiCacheEnabled !== false) {
      await saveToCache(inputHash, extractionType, promptVersion, result);
    }

    logger.info('AI extraction completed', {
      extractionType,
      entitiesFound: entities.length,
      confidence: avgConfidence,
      tokensUsed,
      extractionTimeMs,
    });

    return result;
  } catch (error: any) {
    const extractionTimeMs = Date.now() - startTime;

    // Log failed extraction
    try {
      await logExtraction({
        sourceFileId: context?.sourceFileId,
        extractionType,
        inputText: text,
        inputHash,
        model: config.aiModel || 'claude-3-5-sonnet-20241022',
        promptTemplate: 'entity-extraction',
        promptVersion,
        rawResponse: {},
        extractedEntities: [],
        tokensUsed: 0,
        extractionTimeMs,
        confidenceScore: 0,
        success: false,
        errorMessage: error.message,
      });

      await updateUsageStats(extractionType, 0, 0, false);
    } catch (logError: any) {
      logger.error('Failed to log extraction error', { error: logError.message });
    }

    logger.error('AI extraction failed', {
      error: error.message,
      extractionType,
      textLength: text.length,
    });

    throw error;
  }
}

/**
 * Extract deals from text
 */
export async function extractDealsFromText(
  text: string,
  context?: { sourceFileId?: string; vendorHints?: string[] }
): Promise<DealExtraction[]> {
  const result = await extractEntitiesWithAI(text, 'deal', context);
  return result.entities
    .filter(e => e.type === 'deal')
    .map(e => e.data as DealExtraction);
}

/**
 * Extract vendors from text
 */
export async function extractVendorsFromText(
  text: string,
  context?: { sourceFileId?: string }
): Promise<VendorExtraction[]> {
  const result = await extractEntitiesWithAI(text, 'vendor', context);
  return result.entities
    .filter(e => e.type === 'vendor')
    .map(e => e.data as VendorExtraction);
}

/**
 * Extract contacts from text
 */
export async function extractContactsFromText(
  text: string,
  context?: { sourceFileId?: string }
): Promise<ContactExtraction[]> {
  const result = await extractEntitiesWithAI(text, 'contact', context);
  return result.entities
    .filter(e => e.type === 'contact')
    .map(e => e.data as ContactExtraction);
}

/**
 * Extract deal value from text
 */
export async function extractDealValue(text: string): Promise<ValueExtraction | null> {
  const systemPrompt = `Extract monetary values from text. Return JSON with value, currency, confidence, and source text.`;
  const userPrompt = `Extract the deal value from this text:\n\n${text}\n\nReturn JSON: {"value": number, "currency": "USD", "confidence": 0.9, "sourceText": "the relevant quote"}`;

  try {
    const { content } = await callAnthropicAPI(userPrompt, systemPrompt);
    const parsed = JSON.parse(content);

    if (parsed.value && parsed.currency) {
      return parsed as ValueExtraction;
    }
  } catch (error: any) {
    logger.warn('Failed to extract deal value', { error: error.message });
  }

  return null;
}

/**
 * Clear AI extraction cache
 */
export async function clearAICache(): Promise<number> {
  try {
    const result = await query('DELETE FROM ai_extraction_cache');
    const deletedCount = result.rowCount || 0;
    logger.info(`Cleared AI extraction cache (${deletedCount} entries)`);
    return deletedCount;
  } catch (error: any) {
    logger.error('Failed to clear AI cache', { error: error.message });
    throw error;
  }
}

/**
 * Get AI usage statistics
 */
export async function getAIUsageStats(params?: {
  startDate?: string;
  endDate?: string;
  extractionType?: string;
}): Promise<any[]> {
  try {
    let queryText = 'SELECT * FROM ai_usage_stats WHERE 1=1';
    const queryParams: any[] = [];
    let paramCount = 1;

    if (params?.startDate) {
      queryText += ` AND date >= $${paramCount}`;
      queryParams.push(params.startDate);
      paramCount++;
    }

    if (params?.endDate) {
      queryText += ` AND date <= $${paramCount}`;
      queryParams.push(params.endDate);
      paramCount++;
    }

    if (params?.extractionType) {
      queryText += ` AND extraction_type = $${paramCount}`;
      queryParams.push(params.extractionType);
    }

    queryText += ' ORDER BY date DESC, extraction_type';

    const result = await query(queryText, queryParams);
    return result.rows;
  } catch (error: any) {
    logger.error('Failed to get AI usage stats', { error: error.message });
    throw error;
  }
}

/**
 * Extract and validate entities with AI (System 1 + System 2 pipeline)
 * Combines fast AI extraction with logical validation
 */
export async function extractAndValidateEntities(
  text: string,
  extractionType: 'deal' | 'vendor' | 'contact' | 'all' = 'all',
  context?: {
    sourceFileId?: string;
    sourceType?: string;
    vendorHints?: string[];
    existingDeals?: any[];
    vendors?: any[];
  }
): Promise<{
  extraction: AIExtractionResult;
  validations: Map<string, any>; // Map of entity ID to validation result
}> {
  // Import validation engine (dynamic to avoid circular deps)
  const { validateDeal } = await import('./validationEngine');

  // Step 1: System 1 - Fast AI extraction
  logger.info('Starting System 1 + System 2 pipeline', {
    extractionType,
    textLength: text.length,
  });

  const extraction = await extractEntitiesWithAI(text, extractionType, context);

  // Step 2: System 2 - Logical validation
  const validations = new Map<string, any>();

  for (const entity of extraction.entities) {
    if (entity.type === 'deal') {
      try {
        const validation = await validateDeal(entity.data, {
          sourceText: text,
          existingDeals: context?.existingDeals,
          vendors: context?.vendors,
        });

        // Store validation result
        validations.set(entity.data.dealName || 'unknown', validation);

        // Update entity confidence with validated score
        entity.confidence = validation.finalConfidence;

        logger.info('Deal validated', {
          dealName: entity.data.dealName,
          originalConfidence: entity.data.confidence,
          finalConfidence: validation.finalConfidence,
          isValid: validation.isValid,
          errors: validation.errors.length,
          warnings: validation.warnings.length,
        });
      } catch (error: any) {
        logger.warn('Failed to validate deal', {
          dealName: entity.data.dealName,
          error: error.message,
        });
      }
    }
    // TODO: Add validation for vendors and contacts
  }

  logger.info('System 1 + System 2 pipeline completed', {
    entitiesExtracted: extraction.entities.length,
    entitiesValidated: validations.size,
  });

  return {
    extraction,
    validations,
  };
}

/**
 * Calibrate confidence score based on entity type and data quality
 */
export function calibrateConfidence(rawConfidence: number, type: string, data: any): number {
  let score = rawConfidence;

  // 1. Penalize for missing critical fields
  if (type === 'deal') {
    if (!data.dealName) score *= 0.8;
    if (!data.customerName) score *= 0.8;
    if (!data.dealValue && !data.value) score *= 0.95;
  } else if (type === 'vendor') {
    if (!data.name) score *= 0.8;
  } else if (type === 'contact') {
    if (!data.name) score *= 0.8;
    if (!data.email && !data.phone) score *= 0.9;
  }

  // 2. Boost for high-quality indicators
  if (type === 'deal') {
    // Currency symbol presence suggests better value extraction
    if (data.currency || (typeof data.dealValue === 'string' && /[$€£¥]/.test(data.dealValue))) {
      score = Math.min(0.99, score * 1.05);
    }
    // Specific date format usually indicates better extraction
    if (data.closeDate && !isNaN(Date.parse(data.closeDate))) {
      score = Math.min(0.99, score * 1.05);
    }
  }

  // 3. Clamp between 0 and 1
  return Math.max(0, Math.min(1, score));
}
