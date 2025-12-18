// @ts-nocheck
/**
 * File Validation & Pre-processing Agent
 *
 * Autonomous agent that validates files before upload and provides:
 * - Intent detection and confidence scoring
 * - Pre-upload warnings with suggested fixes
 * - Estimated processing time
 * - Preview of extracted data
 *
 * Expected Impact:
 * - 90% reduction in processing failures
 * - Pre-upload warnings prevent bad imports
 * - Users see exactly what will be extracted
 */

import { getClaudeClient, ClaudeClientService } from '../services/ClaudeClientService';
import { getCache, IntelligentCacheService } from '../services/IntelligentCacheService';
import { isAgentEnabled, getAgentConfig } from '../config/claude';
import { type FileIntent } from '../parsers/ParserRegistry';
import logger from '../utils/logger';

export interface ValidationAgentRequest {
  file: {
    name: string;
    type: string;
    size: number;
    sampleContent: string; // First 5KB or 50 rows
  };
  userIntent?: FileIntent; // Optional user-specified intent
}

export interface ValidationWarning {
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestedFix?: string;
  affectedRows?: number;
  canAutoFix?: boolean;
}

export interface PreprocessingStep {
  name: string;
  description: string;
  required: boolean;
  autoApplicable: boolean;
}

export interface ValidationAgentResponse {
  isValid: boolean;
  confidence: number; // 0-1 confidence in validation results
  detectedIntent: FileIntent;
  intentConfidence: number; // 0-1 confidence in intent detection
  warnings: ValidationWarning[];
  preprocessing: {
    requiredTransformations: PreprocessingStep[];
    estimatedProcessingTime: number; // in seconds
  };
  preview: {
    estimatedRecords: number;
    sampleExtractedRecords: Array<{
      type: 'vendor' | 'deal' | 'contact';
      data: Record<string, any>;
      confidence: number;
    }>;
  };
  recommendations: string[];
}

export class FileValidationAgent {
  private claude?: ClaudeClientService;
  private cache?: IntelligentCacheService;
  private enabled: boolean;

  constructor() {
    this.enabled = isAgentEnabled('fileValidation');

    if (this.enabled) {
      this.claude = getClaudeClient();
      this.cache = getCache();
      logger.info('FileValidationAgent initialized');
    } else {
      logger.info('FileValidationAgent disabled');
    }
  }

  /**
   * Validate a file before full upload
   */
  async validate(request: ValidationAgentRequest): Promise<ValidationAgentResponse> {
    if (!this.enabled) {
      throw new Error('FileValidationAgent is disabled');
    }

    const { file } = request;

    // Generate cache key
    const cacheKey = this.cache.generateCacheKey('file_validation', {
      name: file.name,
      type: file.type,
      size: file.size,
      sample: file.sampleContent.substring(0, 200),
    });

    // Check cache
    const cached = await this.cache.get<ValidationAgentResponse>(cacheKey);
    if (cached) {
      logger.info('File validation retrieved from cache', { fileName: file.name });
      return cached;
    }

    logger.info('Validating file with Claude', {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      sampleLength: file.sampleContent.length,
    });

    // Build validation tool schema
    const validationTool = {
      name: 'validate_file',
      description: 'Validate file structure and detect processing issues before upload',
      input_schema: {
        type: 'object',
        properties: {
          isValid: {
            type: 'boolean',
            description: 'Whether the file is valid and can be processed',
          },
          confidence: {
            type: 'number',
            description: 'Confidence in validation results (0-1)',
          },
          detectedIntent: {
            type: 'string',
            enum: ['vendor_list', 'deal_list', 'vendor_spreadsheet', 'mbox', 'transcript', 'unknown'],
            description: 'Detected file intent',
          },
          intentConfidence: {
            type: 'number',
            description: 'Confidence in intent detection (0-1)',
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
                  description: 'Clear, actionable warning message',
                },
                suggestedFix: {
                  type: 'string',
                  description: 'How to fix this issue',
                },
                affectedRows: {
                  type: 'number',
                  description: 'Estimated number of affected rows',
                },
                canAutoFix: {
                  type: 'boolean',
                  description: 'Whether this can be automatically fixed',
                },
              },
              required: ['severity', 'message'],
            },
          },
          preprocessing: {
            type: 'object',
            properties: {
              requiredTransformations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Transformation name',
                    },
                    description: {
                      type: 'string',
                      description: 'What this transformation does',
                    },
                    required: {
                      type: 'boolean',
                      description: 'Whether this is required',
                    },
                    autoApplicable: {
                      type: 'boolean',
                      description: 'Can be applied automatically',
                    },
                  },
                  required: ['name', 'description', 'required', 'autoApplicable'],
                },
              },
              estimatedProcessingTime: {
                type: 'number',
                description: 'Estimated processing time in seconds',
              },
            },
            required: ['requiredTransformations', 'estimatedProcessingTime'],
          },
          preview: {
            type: 'object',
            properties: {
              estimatedRecords: {
                type: 'number',
                description: 'Estimated total number of records',
              },
              sampleExtractedRecords: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['vendor', 'deal', 'contact'],
                    },
                    data: {
                      type: 'object',
                      description: 'Extracted data preview',
                    },
                    confidence: {
                      type: 'number',
                      description: 'Confidence in this extraction (0-1)',
                    },
                  },
                  required: ['type', 'data', 'confidence'],
                },
              },
            },
            required: ['estimatedRecords', 'sampleExtractedRecords'],
          },
          recommendations: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Actionable recommendations for the user',
          },
        },
        required: [
          'isValid',
          'confidence',
          'detectedIntent',
          'intentConfidence',
          'warnings',
          'preprocessing',
          'preview',
          'recommendations',
        ],
      },
    };

    // Build prompt
    const prompt = this.buildValidationPrompt(request);

    try {
      const config = getAgentConfig('fileValidation');

      // Send structured request
      const result = await this.claude.sendStructuredRequest<ValidationAgentResponse>(
        prompt,
        validationTool,
        {
          model: config.model,
          maxTokens: config.maxTokens,
          temperature: config.temperature,
        }
      );

      // Cache the result (agents use default cache TTL)
      await this.cache.set(cacheKey, result, 24 * 3600); // 24 hours

      logger.info('File validation completed', {
        fileName: file.name,
        isValid: result.isValid,
        detectedIntent: result.detectedIntent,
        warningCount: result.warnings.length,
        estimatedRecords: result.preview.estimatedRecords,
      });

      return result;
    } catch (error: any) {
      logger.error('File validation failed', {
        error: error.message,
        fileName: file.name,
      });
      throw new Error(`File validation failed: ${error.message}`);
    }
  }

  /**
   * Build validation prompt for Claude
   */
  private buildValidationPrompt(request: ValidationAgentRequest): string {
    const { file, userIntent } = request;

    const userIntentText = userIntent
      ? `\nUser-specified intent: ${userIntent}`
      : '\nUser did not specify an intent - please detect it.';

    return `You are an expert file validation agent for a deal registration automation system.

File Information:
- Name: ${file.name}
- Type: ${file.type}
- Size: ${this.formatFileSize(file.size)}
${userIntentText}

File Sample (first portion):
\`\`\`
${file.sampleContent}
\`\`\`

Your Task:
Analyze this file sample and provide comprehensive validation results BEFORE the user uploads it.

File Intent Detection:
- **vendor_list**: CSV/Excel with vendor information (name, contact, email, etc.)
- **deal_list**: CSV/Excel with deal/opportunity information
- **vendor_spreadsheet**: Vendor-specific deal tracking format (e.g., "4IEC - Deals.xlsx")
- **mbox**: Email archive file (.mbox format)
- **transcript**: Meeting transcript or conversation log (TXT, PDF, DOCX)
- **unknown**: Cannot determine intent

Validation Criteria:

1. **Structural Validation**:
   - For CSV/Excel: Check if headers are present, data is in expected format
   - For MBOX: Verify valid email message structure
   - For Transcripts: Check if it contains conversational text
   - Look for encoding issues, corrupted data, empty rows

2. **Data Quality Checks**:
   - Missing required fields (e.g., deal name, vendor name)
   - Invalid formats (e.g., currency values that can't be parsed)
   - Inconsistent data types in columns
   - Estimated percentage of usable vs problematic rows

3. **Warning Severity Levels**:
   - **error**: Critical issues that will cause processing to fail
   - **warning**: Issues that may cause data quality problems
   - **info**: Informational notices for optimization

4. **Suggested Fixes**:
   - Be specific: "Column 'Deal Value' contains text in rows 5-12. Expected format: $1000 or 1000"
   - Indicate if auto-fixable: "Can auto-fix: Convert 'X/Y/Z' dates to ISO format"

5. **Preprocessing Recommendations**:
   - Required transformations (must be done)
   - Optional optimizations (improve quality)
   - Whether each can be automatically applied

6. **Processing Time Estimation**:
   - Based on file size and detected intent
   - Factor in: number of records, complexity (e.g., MBOX parsing is slower)
   - Provide realistic estimate in seconds

7. **Preview Extraction**:
   - Extract 2-5 sample records from the file sample
   - Show what the final extracted data will look like
   - Include confidence score for each extraction
   - Help user verify: "Is this what you expect?"

8. **Recommendations**:
   - Actionable next steps
   - Examples:
     - "Remove empty rows 15-20 before uploading"
     - "Consider splitting this 5GB file into smaller batches"
     - "Column 'Customer' appears to be vendor names - verify intent"

Be thorough but concise. Focus on actionable insights that prevent failed imports.`;
  }

  /**
   * Format file size for human readability
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Quick validation without AI (checks basic file properties)
   */
  async quickValidate(file: {
    name: string;
    type: string;
    size: number;
  }): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check file size (max 5GB)
    const maxSize = 5 * 1024 * 1024 * 1024; // 5GB
    if (file.size > maxSize) {
      errors.push(`File size (${this.formatFileSize(file.size)}) exceeds maximum (5GB)`);
    }

    if (file.size === 0) {
      errors.push('File is empty');
    }

    // Check file extension
    const allowedExtensions = ['.mbox', '.csv', '.xlsx', '.xls', '.txt', '.pdf', '.docx', '.json'];
    const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      errors.push(`File type '${extension}' is not supported. Allowed: ${allowedExtensions.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

// Singleton instance
let agentInstance: FileValidationAgent | null = null;

/**
 * Get the singleton file validation agent instance
 */
export function getFileValidationAgent(): FileValidationAgent {
  if (!agentInstance) {
    agentInstance = new FileValidationAgent();
  }
  return agentInstance;
}

export default {
  FileValidationAgent,
  getFileValidationAgent,
};
