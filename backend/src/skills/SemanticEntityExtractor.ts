// @ts-nocheck
/**
 * Semantic Entity Extractor Skill
 *
 * Uses Claude to extract entities with semantic understanding, replacing regex patterns.
 * Handles:
 * - Context-aware entity recognition
 * - Complex formats: "$500K USD" → {value: 500000, currency: 'USD'}
 * - Multi-language: "Acme GmbH" recognized as vendor
 * - Relationships between entities
 *
 * Expected Impact:
 * - 85%+ accuracy (vs 60% current)
 * - Multi-language support
 * - Relationship extraction
 */

import { getClaudeClient, ClaudeClientService } from '../services/ClaudeClientService';
import { getCache, IntelligentCacheService } from '../services/IntelligentCacheService';
import { isSkillEnabled, getSkillConfig } from '../config/claude';
import logger from '../utils/logger';

export type EntityType =
  | 'vendor'
  | 'deal'
  | 'contact'
  | 'currency'
  | 'date'
  | 'value'
  | 'email'
  | 'phone'
  | 'url'
  | 'address'
  | 'organization'
  | 'person'
  | 'product';

export interface EntityExtractionRequest {
  text: string;
  entityTypes: EntityType[];
  context?: {
    documentType?: string;
    language?: string;
    additionalInfo?: Record<string, any>;
  };
}

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  normalizedValue?: string;
  confidence: number;
  position?: {
    start: number;
    end: number;
  };
  metadata: Record<string, any>;
}

export interface EntityRelationship {
  entity1: string;
  entity1Type: EntityType;
  relation: string;
  entity2: string;
  entity2Type: EntityType;
  confidence: number;
}

export interface EntityExtractionResponse {
  entities: ExtractedEntity[];
  relationships: EntityRelationship[];
  summary: {
    totalEntities: number;
    byType: Record<string, number>;
    averageConfidence: number;
  };
}

export class SemanticEntityExtractor {
  private claude?: ClaudeClientService;
  private cache?: IntelligentCacheService;
  private enabled: boolean;

  constructor() {
    this.enabled = isSkillEnabled('semanticEntityExtractor');

    if (this.enabled) {
      this.claude = getClaudeClient();
      this.cache = getCache();
      logger.info('SemanticEntityExtractor skill initialized');
    } else {
      logger.info('SemanticEntityExtractor skill disabled');
    }
  }

  /**
   * Extract entities from text using semantic understanding
   */
  async extract(request: EntityExtractionRequest): Promise<EntityExtractionResponse> {
    if (!this.enabled) {
      throw new Error('SemanticEntityExtractor skill is disabled');
    }

    // Generate cache key
    const cacheKey = this.cache.generateCacheKey('entity_extraction', {
      text: request.text.substring(0, 500), // Use first 500 chars for cache key
      entityTypes: request.entityTypes.sort(),
    });

    // Check cache
    const cached = await this.cache.get<EntityExtractionResponse>(cacheKey);
    if (cached) {
      logger.info('Entity extraction retrieved from cache');
      return cached;
    }

    logger.info('Extracting entities with Claude', {
      textLength: request.text.length,
      entityTypes: request.entityTypes,
    });

    // Build extraction tool schema
    const extractionTool = {
      name: 'extract_entities',
      description: 'Extract named entities and their relationships from text with confidence scores',
      input_schema: {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'vendor',
                    'deal',
                    'contact',
                    'currency',
                    'date',
                    'value',
                    'email',
                    'phone',
                    'url',
                    'address',
                    'organization',
                    'person',
                    'product',
                  ],
                },
                value: {
                  type: 'string',
                  description: 'The raw extracted value as it appears in the text',
                },
                normalizedValue: {
                  type: 'string',
                  description: 'Normalized/standardized version of the value',
                },
                confidence: {
                  type: 'number',
                  description: 'Confidence score from 0-1',
                },
                position: {
                  type: 'object',
                  properties: {
                    start: { type: 'number' },
                    end: { type: 'number' },
                  },
                },
                metadata: {
                  type: 'object',
                  description: 'Additional context-specific metadata',
                },
              },
              required: ['type', 'value', 'confidence'],
            },
          },
          relationships: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entity1: { type: 'string' },
                entity1Type: { type: 'string' },
                relation: {
                  type: 'string',
                  description: 'Type of relationship (e.g., works_for, manages, located_in)',
                },
                entity2: { type: 'string' },
                entity2Type: { type: 'string' },
                confidence: { type: 'number' },
              },
              required: ['entity1', 'entity1Type', 'relation', 'entity2', 'entity2Type', 'confidence'],
            },
          },
        },
        required: ['entities', 'relationships'],
      },
    };

    // Build prompt
    const prompt = this.buildExtractionPrompt(request);

    try {
      const config = getSkillConfig('semanticEntityExtractor');

      // Send structured request
      const result = await this.claude.sendStructuredRequest<{
        entities: ExtractedEntity[];
        relationships: EntityRelationship[];
      }>(prompt, extractionTool, {
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
      });

      // Calculate summary statistics
      const byType: Record<string, number> = {};
      let totalConfidence = 0;

      for (const entity of result.entities) {
        byType[entity.type] = (byType[entity.type] || 0) + 1;
        totalConfidence += entity.confidence;
      }

      const response: EntityExtractionResponse = {
        entities: result.entities,
        relationships: result.relationships,
        summary: {
          totalEntities: result.entities.length,
          byType,
          averageConfidence:
            result.entities.length > 0 ? totalConfidence / result.entities.length : 0,
        },
      };

      // Cache the result
      if (config.cacheEnabled) {
        await this.cache.set(cacheKey, response, config.cacheTTL * 3600);
      }

      logger.info('Entity extraction completed', {
        entityCount: result.entities.length,
        relationshipCount: result.relationships.length,
        averageConfidence: response.summary.averageConfidence,
      });

      return response;
    } catch (error: any) {
      logger.error('Entity extraction failed', {
        error: error.message,
        textLength: request.text.length,
      });
      throw new Error(`Entity extraction failed: ${error.message}`);
    }
  }

  /**
   * Build extraction prompt for Claude
   */
  private buildExtractionPrompt(request: EntityExtractionRequest): string {
    const { text, entityTypes, context } = request;

    const contextText = context
      ? `
Document Context:
- Type: ${context.documentType || 'unknown'}
- Language: ${context.language || 'auto-detect'}
${context.additionalInfo?.fileName ? `- File Name: ${context.additionalInfo.fileName}` : ''}
${context.additionalInfo?.subject ? `- Subject: ${context.additionalInfo.subject}` : ''}
${context.additionalInfo?.sender ? `- Sender: ${context.additionalInfo.sender}` : ''}
${context.additionalInfo?.recipients ? `- Recipients: ${context.additionalInfo.recipients}` : ''}
${context.additionalInfo ? `- Additional Info: ${JSON.stringify(context.additionalInfo)}` : ''}
`
      : '';

    const entityTypeDescriptions = {
      vendor: 'Company or organization that partners with us (e.g., "Acme Corporation", "Acme Inc", "Acme GmbH")',
      deal: 'Business deal, opportunity, or project name',
      contact: 'Person name (full name or first/last separately)',
      currency: 'Currency code or symbol (USD, EUR, $, €)',
      date: 'Date or timestamp in any format',
      value: 'Numeric value, especially monetary amounts (e.g., "$500K", "2.5M", "500000")',
      email: 'Email address',
      phone: 'Phone number in any format',
      url: 'Website URL or domain',
      address: 'Physical address',
      organization: 'Any company, institution, or organization name',
      person: 'Person name',
      product: 'Product or service name',
    };

    const requestedTypes = entityTypes
      .map(type => `- ${type}: ${entityTypeDescriptions[type] || 'Entity of this type'}`)
      .join('\n');

    return `You are an expert at extracting structured information from unstructured text.

${contextText}
Text to Analyze:
"""
${text}
"""

Entity Types to Extract:
${requestedTypes}

Instructions:
1. Extract ALL instances of the requested entity types from the text
2. For each entity, provide:
   - type: The entity type
   - value: The exact text as it appears
   - normalizedValue: Standardized version (e.g., "Acme Inc" → "Acme Incorporated", "$500K" → "500000")
   - confidence: Your confidence (0-1) that this is correctly identified and typed
   - position: Character start/end positions in the text
   - metadata: Additional context (e.g., for currency: {numeric: 500000, currency: "USD"})

3. Identify relationships between entities:
   - Example: "John Smith from Acme Corp" → works_for relationship
   - Example: "Deal value of $500K" → has_value relationship
   - Common relations: works_for, manages, located_in, has_value, has_contact, associated_with

Guidelines:
- Handle variations: "Acme Inc" = "Acme Corporation" = "ACME" = "Acme, Incorporated"
- Recognize multi-language: "Acme GmbH" (German), "Acme SA" (French), "Acme Ltd" (British)
- Parse complex formats:
  - "$500K USD" → value: 500000, currency: USD
  - "Q2 2024" → date: "2024-04-01" (approximate)
  - "555-1234" or "(555) 123-4567" → standardize phone format
- Extract relationships: "Jane Doe (jane@acme.com) from Acme Corp" → 3 entities + 2 relationships
- Use high confidence (>0.8) for explicit mentions, lower (<0.6) for inferred/ambiguous
- Consider context: "Apple" could be organization or fruit - use surrounding text to decide

Be thorough but accurate. When in doubt about entity type or boundaries, choose the most specific type and explain reasoning in metadata.`;
  }

  /**
   * Find entities of a specific type
   */
  findEntitiesByType(
    extraction: EntityExtractionResponse,
    type: EntityType
  ): ExtractedEntity[] {
    return extraction.entities.filter(e => e.type === type);
  }

  /**
   * Get the highest confidence entity of a given type
   */
  getBestEntity(extraction: EntityExtractionResponse, type: EntityType): ExtractedEntity | null {
    const entities = this.findEntitiesByType(extraction, type);
    if (entities.length === 0) return null;

    return entities.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );
  }

  /**
   * Find relationships involving a specific entity
   */
  findRelationships(
    extraction: EntityExtractionResponse,
    entityValue: string
  ): EntityRelationship[] {
    return extraction.relationships.filter(
      r => r.entity1 === entityValue || r.entity2 === entityValue
    );
  }
}

// Singleton instance
let extractorInstance: SemanticEntityExtractor | null = null;

/**
 * Get the singleton entity extractor instance
 */
export function getEntityExtractor(): SemanticEntityExtractor {
  if (!extractorInstance) {
    extractorInstance = new SemanticEntityExtractor();
  }
  return extractorInstance;
}

export default {
  SemanticEntityExtractor,
  getEntityExtractor,
};
