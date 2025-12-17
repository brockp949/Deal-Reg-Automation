/**
 * Intelligent Column Mapper Skill
 *
 * Uses Claude to dynamically map any spreadsheet column structure to canonical schema.
 * Handles:
 * - Semantic understanding of column purposes
 * - Variations: "Deal Value" = "Opportunity Amount" = "Project Budget"
 * - Multi-column composition: "First Name" + "Last Name" → "contact_name"
 * - Data transformations: date parsing, currency extraction
 *
 * Expected Impact:
 * - 95%+ custom format handling (vs 60% current)
 * - No code changes needed for new file formats
 */

import { getClaudeClient, ClaudeClientService } from '../services/ClaudeClientService';
import { getCache, IntelligentCacheService } from '../services/IntelligentCacheService';
import { isSkillEnabled, getSkillConfig } from '../config/claude';
import logger from '../utils/logger';

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'email' | 'phone' | 'url' | 'currency';
  required: boolean;
  description: string;
  examples?: string[];
}

export interface ColumnMappingRequest {
  headers: string[];
  sampleRows: Array<Record<string, any>>;
  targetSchema: Record<string, SchemaField>;
  context?: {
    fileType?: string;
    fileName?: string;
    intent?: string;
  };
}

export interface TransformationRule {
  type: 'parse_date' | 'parse_currency' | 'parse_number' | 'concat' | 'split' | 'lowercase' | 'uppercase' | 'trim';
  params?: Record<string, any>;
}

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string;
  confidence: number;
  transformation?: TransformationRule;
  reasoning: string;
}

export interface ColumnMappingResponse {
  mappings: ColumnMapping[];
  overallConfidence: number;
  warnings: Array<{
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestedFix?: string;
  }>;
  unmappedColumns: string[];
  unmappedFields: string[];
}

export class IntelligentColumnMapper {
  private claude: ClaudeClientService;
  private cache: IntelligentCacheService;
  private enabled: boolean;

  constructor() {
    this.enabled = isSkillEnabled('intelligentColumnMapper');

    if (this.enabled) {
      this.claude = getClaudeClient();
      this.cache = getCache();
      logger.info('IntelligentColumnMapper skill initialized');
    } else {
      logger.info('IntelligentColumnMapper skill disabled');
    }
  }

  /**
   * Map spreadsheet columns to canonical schema
   */
  async mapColumns(request: ColumnMappingRequest): Promise<ColumnMappingResponse> {
    if (!this.enabled) {
      throw new Error('IntelligentColumnMapper skill is disabled');
    }

    // Generate cache key
    const cacheKey = this.cache.generateCacheKey('column_mapping', {
      headers: request.headers.sort(),
      schema: Object.keys(request.targetSchema).sort(),
    });

    // Check cache
    const cached = await this.cache.get<ColumnMappingResponse>(cacheKey);
    if (cached) {
      logger.info('Column mapping retrieved from cache');
      return cached;
    }

    logger.info('Generating column mapping with Claude', {
      headerCount: request.headers.length,
      schemaFieldCount: Object.keys(request.targetSchema).length,
    });

    // Build the mapping tool schema
    const mappingTool = {
      name: 'map_columns',
      description: 'Map source spreadsheet columns to target schema fields with confidence scores and transformations',
      input_schema: {
        type: 'object',
        properties: {
          mappings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sourceColumn: {
                  type: 'string',
                  description: 'Name of the source column in the spreadsheet',
                },
                targetField: {
                  type: 'string',
                  description: 'Name of the target field in the canonical schema',
                },
                confidence: {
                  type: 'number',
                  description: 'Confidence score from 0-1 for this mapping',
                },
                transformation: {
                  type: 'object',
                  description: 'Optional data transformation to apply',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['parse_date', 'parse_currency', 'parse_number', 'concat', 'split', 'lowercase', 'uppercase', 'trim'],
                    },
                    params: {
                      type: 'object',
                      description: 'Parameters for the transformation',
                    },
                  },
                },
                reasoning: {
                  type: 'string',
                  description: 'Brief explanation of why this mapping makes sense',
                },
              },
              required: ['sourceColumn', 'targetField', 'confidence', 'reasoning'],
            },
          },
          warnings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: {
                  type: 'string',
                  enum: ['error', 'warning', 'info'],
                },
                message: {
                  type: 'string',
                },
                suggestedFix: {
                  type: 'string',
                },
              },
              required: ['severity', 'message'],
            },
          },
        },
        required: ['mappings', 'warnings'],
      },
    };

    // Build the prompt
    const prompt = this.buildMappingPrompt(request);

    try {
      const config = getSkillConfig('intelligentColumnMapper');

      // Send structured request to Claude
      const result = await this.claude.sendStructuredRequest<{
        mappings: ColumnMapping[];
        warnings: ColumnMappingResponse['warnings'];
      }>(prompt, mappingTool, {
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
      });

      // Calculate overall confidence
      const overallConfidence =
        result.mappings.length > 0
          ? result.mappings.reduce((sum, m) => sum + m.confidence, 0) / result.mappings.length
          : 0;

      // Identify unmapped columns and fields
      const mappedColumns = new Set(result.mappings.map(m => m.sourceColumn));
      const mappedFields = new Set(result.mappings.map(m => m.targetField));

      const unmappedColumns = request.headers.filter(h => !mappedColumns.has(h));
      const unmappedFields = Object.keys(request.targetSchema).filter(f => {
        const schemaField = request.targetSchema[f];
        return schemaField.required && !mappedFields.has(f);
      });

      const response: ColumnMappingResponse = {
        mappings: result.mappings,
        overallConfidence,
        warnings: result.warnings,
        unmappedColumns,
        unmappedFields,
      };

      // Add warnings for unmapped required fields
      if (unmappedFields.length > 0) {
        response.warnings.push({
          severity: 'error',
          message: `Required fields not mapped: ${unmappedFields.join(', ')}`,
          suggestedFix: 'Ensure your spreadsheet contains columns for these required fields',
        });
      }

      // Cache the result
      if (config.cacheEnabled) {
        await this.cache.set(cacheKey, response, config.cacheTTL * 3600); // TTL in seconds
      }

      logger.info('Column mapping generated successfully', {
        mappingCount: result.mappings.length,
        overallConfidence,
        warningCount: response.warnings.length,
      });

      return response;
    } catch (error: any) {
      logger.error('Column mapping failed', {
        error: error.message,
        headers: request.headers,
      });
      throw new Error(`Column mapping failed: ${error.message}`);
    }
  }

  /**
   * Build the mapping prompt for Claude
   */
  private buildMappingPrompt(request: ColumnMappingRequest): string {
    const { headers, sampleRows, targetSchema, context } = request;

    // Build target schema description
    const schemaDescription = Object.entries(targetSchema)
      .map(([fieldName, field]) => {
        const requiredText = field.required ? 'REQUIRED' : 'optional';
        const examplesText = field.examples ? ` Examples: ${field.examples.join(', ')}` : '';
        return `- ${fieldName} (${field.type}, ${requiredText}): ${field.description}${examplesText}`;
      })
      .join('\n');

    // Format sample data for better readability
    const sampleDataText = sampleRows
      .slice(0, 5) // Limit to first 5 rows
      .map((row, idx) => {
        const rowData = headers
          .map(h => `${h}: ${JSON.stringify(row[h])}`)
          .join(', ');
        return `Row ${idx + 1}: { ${rowData} }`;
      })
      .join('\n');

    const contextText = context
      ? `
File Context:
- File Type: ${context.fileType || 'unknown'}
- File Name: ${context.fileName || 'unknown'}
- Upload Intent: ${context.intent || 'auto'}
`
      : '';

    return `You are a data mapping expert analyzing a spreadsheet for a deal registration automation system.

${contextText}
Source Spreadsheet Headers:
${headers.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

Sample Data (first 5 rows):
${sampleDataText}

Target Schema Fields:
${schemaDescription}

Your Task:
1. Analyze the source columns and target schema
2. Map each source column to the most appropriate target field
3. For each mapping, provide:
   - Confidence score (0-1): How certain you are this is the correct mapping
   - Reasoning: Brief explanation of why this mapping makes sense
   - Transformation (if needed): Any data transformation required (e.g., parsing dates, extracting currency)

Mapping Guidelines:
- Consider semantic similarity, not just exact string matching
- Handle common variations:
  - "Deal Value" = "Opportunity Amount" = "Project Budget" = "Deal $" → deal_value
  - "Company" = "Organization" = "Account" = "Customer" → customer_name
  - "Contact Email" = "Email Address" = "E-mail" → contact_email
- Detect multi-column compositions:
  - "First Name" + "Last Name" → contact_name (use concat transformation)
  - "Street", "City", "State" → address (use concat transformation)
- Recognize data types from sample data:
  - "$500K", "500000 USD" → parse_currency transformation needed
  - "01/15/2024", "2024-01-15" → parse_date transformation needed
  - "10%" → parse_number transformation needed

Quality Checks:
- Flag unmapped required fields as errors
- Warn about low-confidence mappings (< 0.7)
- Suggest fixes for data quality issues (invalid formats, missing data)
- Identify columns that don't map to any schema field (they'll be ignored)

Return your mapping analysis using the tool.`;
  }

  /**
   * Apply a mapped transformation to a value
   */
  applyTransformation(value: any, transformation?: TransformationRule): any {
    if (!transformation) {
      return value;
    }

    try {
      switch (transformation.type) {
        case 'parse_currency':
          return this.parseCurrency(value);

        case 'parse_number':
          return this.parseNumber(value);

        case 'parse_date':
          return this.parseDate(value);

        case 'concat':
          // For concat, value should be an array of values to concatenate
          if (Array.isArray(value)) {
            const separator = transformation.params?.separator || ' ';
            return value.filter(v => v != null && v !== '').join(separator);
          }
          return value;

        case 'split':
          if (typeof value === 'string') {
            const separator = transformation.params?.separator || ',';
            const index = transformation.params?.index;
            const parts = value.split(separator).map(p => p.trim());
            return index !== undefined ? parts[index] : parts;
          }
          return value;

        case 'lowercase':
          return typeof value === 'string' ? value.toLowerCase() : value;

        case 'uppercase':
          return typeof value === 'string' ? value.toUpperCase() : value;

        case 'trim':
          return typeof value === 'string' ? value.trim() : value;

        default:
          logger.warn('Unknown transformation type', { type: transformation.type });
          return value;
      }
    } catch (error: any) {
      logger.error('Transformation failed', {
        transformationType: transformation.type,
        value,
        error: error.message,
      });
      return value;
    }
  }

  /**
   * Parse currency value from various formats
   */
  private parseCurrency(value: any): number | null {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return value;

    const str = String(value).trim();

    // Remove currency symbols and common formatting
    const cleaned = str
      .replace(/[$€£¥₹]/g, '')
      .replace(/[,\s]/g, '')
      .trim();

    // Handle "K" (thousands) and "M" (millions) suffixes
    let multiplier = 1;
    let numStr = cleaned;

    if (/k$/i.test(cleaned)) {
      multiplier = 1000;
      numStr = cleaned.slice(0, -1);
    } else if (/m$/i.test(cleaned)) {
      multiplier = 1000000;
      numStr = cleaned.slice(0, -1);
    }

    const parsed = parseFloat(numStr);
    return isNaN(parsed) ? null : parsed * multiplier;
  }

  /**
   * Parse number from various formats
   */
  private parseNumber(value: any): number | null {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return value;

    const str = String(value).trim();

    // Handle percentages
    if (str.endsWith('%')) {
      const num = parseFloat(str.slice(0, -1));
      return isNaN(num) ? null : num / 100;
    }

    // Remove commas and parse
    const cleaned = str.replace(/,/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Parse date from various formats
   */
  private parseDate(value: any): string | null {
    if (value == null || value === '') return null;
    if (value instanceof Date) return value.toISOString().split('T')[0];

    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) return null;
      return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
    } catch {
      return null;
    }
  }
}

// Singleton instance
let mapperInstance: IntelligentColumnMapper | null = null;

/**
 * Get the singleton column mapper instance
 */
export function getColumnMapper(): IntelligentColumnMapper {
  if (!mapperInstance) {
    mapperInstance = new IntelligentColumnMapper();
  }
  return mapperInstance;
}

export default {
  IntelligentColumnMapper,
  getColumnMapper,
};
