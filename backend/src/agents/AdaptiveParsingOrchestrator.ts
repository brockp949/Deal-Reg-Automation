// @ts-nocheck
/**
 * Adaptive Parsing Orchestrator Agent
 *
 * Dynamically routes files through optimal parsing pipeline based on:
 * - File characteristics (size, type, structure)
 * - Real-time analysis of content
 * - Historical success rates of different strategies
 * - Automatic fallback on failures
 *
 * Expected Impact:
 * - Optimal parsing strategy per file (not one-size-fits-all)
 * - Automatic fallback when primary strategy fails
 * - Self-healing: detect issues mid-processing, adjust strategy
 */

import { getClaudeClient, ClaudeClientService } from '../services/ClaudeClientService';
import { getCache, IntelligentCacheService } from '../services/IntelligentCacheService';
import { isAgentEnabled, getAgentConfig } from '../config/claude';
import { type FileIntent, type FileMetadata } from '../parsers/ParserRegistry';
import logger from '../utils/logger';

export interface ParsingStep {
  name: string;
  skill?: string; // Which skill to use (e.g., 'intelligentColumnMapper')
  parser?: string; // Which parser to use (e.g., 'vendorSpreadsheetParser')
  config: Record<string, any>;
  fallback?: string; // Fallback step name if this fails
  estimatedDuration: number; // seconds
}

export interface ParsingPlan {
  strategy: string; // Name of the strategy (e.g., 'vendor_spreadsheet_ai_first')
  steps: ParsingStep[];
  parallelization: {
    enabled: boolean;
    chunkSize?: number;
    maxConcurrentChunks?: number;
  };
  estimatedDuration: number; // total seconds
  confidence: number; // 0-1 confidence in this plan
  rationale: string; // Why this plan was chosen
}

export interface OrchestratorRequest {
  file: FileMetadata;
  intent: FileIntent;
  sampleContent?: string; // Optional file sample for analysis
  constraints?: {
    maxDuration?: number; // Max acceptable processing time in seconds
    preferredAccuracy?: number; // 0-1, trade-off speed vs accuracy
  };
}

export interface OrchestratorResponse {
  plan: ParsingPlan;
  alternativePlans: ParsingPlan[]; // Other viable options
  warnings: string[];
  recommendations: string[];
}

export class AdaptiveParsingOrchestrator {
  private claude?: ClaudeClientService;
  private cache?: IntelligentCacheService;
  private enabled: boolean;

  // Track success rates of different strategies
  private strategySuccessRates: Map<string, { successes: number; failures: number }> = new Map();

  constructor() {
    this.enabled = isAgentEnabled('adaptiveOrchestrator');

    if (this.enabled) {
      this.claude = getClaudeClient();
      this.cache = getCache();
      logger.info('AdaptiveParsingOrchestrator initialized');
    } else {
      logger.info('AdaptiveParsingOrchestrator disabled');
    }
  }

  /**
   * Create optimal parsing plan for a file
   */
  async createPlan(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    if (!this.enabled) {
      // Return default plan when disabled
      return this.createDefaultPlan(request);
    }

    const { file, intent } = request;

    // Generate cache key
    const cacheKey = this.cache.generateCacheKey('parsing_plan', {
      fileName: file.name,
      fileSize: file.size,
      intent,
      sample: request.sampleContent?.substring(0, 200),
    });

    // Check cache
    const cached = await this.cache.get<OrchestratorResponse>(cacheKey);
    if (cached) {
      logger.info('Parsing plan retrieved from cache', { fileName: file.name });
      return cached;
    }

    logger.info('Creating adaptive parsing plan', {
      fileName: file.name,
      fileSize: file.size,
      intent,
    });

    // Build planning tool schema
    const planningTool = {
      name: 'create_parsing_plan',
      description: 'Create an optimal parsing plan for a file based on its characteristics',
      input_schema: {
        type: 'object',
        properties: {
          plan: {
            type: 'object',
            properties: {
              strategy: {
                type: 'string',
                description: 'Name of the parsing strategy',
              },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Step name',
                    },
                    skill: {
                      type: 'string',
                      description: 'Skill to use (intelligentColumnMapper, semanticEntityExtractor, etc.)',
                    },
                    parser: {
                      type: 'string',
                      description: 'Parser to use (vendorSpreadsheetParser, mboxParser, etc.)',
                    },
                    config: {
                      type: 'object',
                      description: 'Configuration for this step',
                    },
                    fallback: {
                      type: 'string',
                      description: 'Fallback step if this fails',
                    },
                    estimatedDuration: {
                      type: 'number',
                      description: 'Estimated duration in seconds',
                    },
                  },
                  required: ['name', 'config', 'estimatedDuration'],
                },
              },
              parallelization: {
                type: 'object',
                properties: {
                  enabled: {
                    type: 'boolean',
                    description: 'Whether to enable parallel processing',
                  },
                  chunkSize: {
                    type: 'number',
                    description: 'Number of rows per chunk',
                  },
                  maxConcurrentChunks: {
                    type: 'number',
                    description: 'Max concurrent chunks',
                  },
                },
                required: ['enabled'],
              },
              estimatedDuration: {
                type: 'number',
                description: 'Total estimated duration in seconds',
              },
              confidence: {
                type: 'number',
                description: 'Confidence in this plan (0-1)',
              },
              rationale: {
                type: 'string',
                description: 'Why this plan was chosen',
              },
            },
            required: ['strategy', 'steps', 'parallelization', 'estimatedDuration', 'confidence', 'rationale'],
          },
          alternativePlans: {
            type: 'array',
            items: {
              type: 'object',
            },
            description: 'Alternative viable plans',
          },
          warnings: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Warnings about potential issues',
          },
          recommendations: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Recommendations for optimal processing',
          },
        },
        required: ['plan', 'alternativePlans', 'warnings', 'recommendations'],
      },
    };

    // Build prompt
    const prompt = this.buildPlanningPrompt(request);

    try {
      const config = getAgentConfig('adaptiveOrchestrator');

      // Send structured request
      const result = await this.claude.sendStructuredRequest<OrchestratorResponse>(
        prompt,
        planningTool,
        {
          model: config.model,
          maxTokens: config.maxTokens,
          temperature: config.temperature,
        }
      );

      // Cache the result
      await this.cache.set(cacheKey, result, 24 * 3600); // 24 hours

      logger.info('Parsing plan created', {
        fileName: file.name,
        strategy: result.plan.strategy,
        stepCount: result.plan.steps.length,
        estimatedDuration: result.plan.estimatedDuration,
        confidence: result.plan.confidence,
      });

      return result;
    } catch (error: any) {
      logger.error('Adaptive planning failed, using default plan', {
        error: error.message,
        fileName: file.name,
      });

      // Fallback to default plan
      return this.createDefaultPlan(request);
    }
  }

  /**
   * Build planning prompt for Claude
   */
  private buildPlanningPrompt(request: OrchestratorRequest): string {
    const { file, intent, sampleContent, constraints } = request;

    const sampleText = sampleContent
      ? `\n\nFile Sample:\n\`\`\`\n${sampleContent}\n\`\`\``
      : '';

    const constraintsText = constraints
      ? `\n\nConstraints:\n- Max Duration: ${constraints.maxDuration ? constraints.maxDuration + ' seconds' : 'none'}\n- Preferred Accuracy: ${constraints.preferredAccuracy ? constraints.preferredAccuracy * 100 + '%' : 'balanced'}`
      : '';

    // Get historical success rates
    const historyText = this.getStrategyHistoryText();

    return `You are an adaptive parsing orchestration agent for a deal registration automation system.

File Information:
- Name: ${file.name}
- Size: ${this.formatFileSize(file.size)}
- Type: ${file.type}
- Detected Intent: ${intent}${sampleText}${constraintsText}${historyText}

Your Task:
Create an optimal parsing plan for this file that maximizes accuracy and efficiency.

Available Parsers:
1. **vendorSpreadsheetParser**: Vendor-specific deal spreadsheets (e.g., "4IEC - Deals.xlsx")
2. **mboxParser**: Email archives (.mbox format)
3. **transcriptParser**: Meeting transcripts (TXT, PDF, DOCX)
4. **vendorListParser**: CSV/Excel vendor lists
5. **dealListParser**: CSV/Excel deal lists

Available Skills (AI-powered enhancements):
1. **intelligentColumnMapper**: Dynamic column mapping for custom spreadsheets
2. **semanticEntityExtractor**: Context-aware entity extraction
3. **semanticDuplicateDetector**: AI-based duplicate detection
4. **buyingSignalAnalyzer**: Buying intent analysis for transcripts

Planning Guidelines:

1. **File Size Considerations**:
   - Small files (<10MB): Standard sequential processing
   - Medium files (10-100MB): Consider parallelization
   - Large files (>100MB): MUST use parallelization (chunks of 1000 rows, max 5 concurrent)

2. **Intent-Based Strategy**:
   - vendor_spreadsheet: Use intelligentColumnMapper + vendorSpreadsheetParser
   - mbox: Use mboxParser + semanticEntityExtractor
   - transcript: Use transcriptParser + buyingSignalAnalyzer
   - vendor_list/deal_list: Standard parsers with AI skills as fallback

3. **Fallback Strategy**:
   - Primary: AI-powered skills (more accurate but slower)
   - Fallback: Traditional regex-based parsing (faster but less accurate)
   - Example: intelligentColumnMapper fails → fallback to hardcoded column mapping

4. **Parallelization Rules**:
   - Only enable if file > 10MB or estimated row count > 5000
   - Chunk size: 1000 rows (default)
   - Max concurrent: 5 chunks (to avoid overwhelming system)

5. **Time Estimation**:
   - Base rate: ~500 rows/second for simple parsing
   - AI skill overhead: +2-5 seconds per API call
   - Parallel processing: 3-5x speedup for large files

6. **Confidence Scoring**:
   - High (0.9+): File structure perfectly matches known pattern
   - Medium (0.7-0.9): File structure mostly matches, some ambiguity
   - Low (<0.7): File structure is unusual or complex

Provide a comprehensive parsing plan with clear rationale.`;
  }

  /**
   * Create default parsing plan (when orchestrator is disabled or fails)
   */
  private createDefaultPlan(request: OrchestratorRequest): OrchestratorResponse {
    const { file, intent } = request;
    const isLargeFile = file.size > 100 * 1024 * 1024; // >100MB

    const plan: ParsingPlan = {
      strategy: `default_${intent}`,
      steps: [
        {
          name: 'parse_file',
          parser: this.getDefaultParser(intent),
          config: {
            useAI: false, // Disabled by default
          },
          estimatedDuration: this.estimateProcessingTime(file.size, false),
        },
      ],
      parallelization: {
        enabled: isLargeFile,
        chunkSize: isLargeFile ? 1000 : undefined,
        maxConcurrentChunks: isLargeFile ? 5 : undefined,
      },
      estimatedDuration: this.estimateProcessingTime(file.size, isLargeFile),
      confidence: 0.8,
      rationale: 'Default plan: orchestrator disabled or planning failed',
    };

    return {
      plan,
      alternativePlans: [],
      warnings: ['Using default plan - adaptive orchestrator is disabled'],
      recommendations: ['Enable CLAUDE_AGENT_ORCHESTRATOR_ENABLED for optimized parsing'],
    };
  }

  /**
   * Get default parser for intent
   */
  private getDefaultParser(intent: FileIntent): string {
    const parserMap: Record<FileIntent, string> = {
      vendor_list: 'vendorListParser',
      deal_list: 'dealListParser',
      vendor_spreadsheet: 'vendorSpreadsheetParser',
      mbox: 'mboxParser',
      transcript: 'transcriptParser',
      auto: 'autoDetect',
    };

    return parserMap[intent] || 'autoDetect';
  }

  /**
   * Estimate processing time based on file size
   */
  private estimateProcessingTime(fileSize: number, parallelEnabled: boolean): number {
    const baseRatePerMB = 2; // 2 seconds per MB
    const fileSizeMB = fileSize / (1024 * 1024);
    const baseTime = fileSizeMB * baseRatePerMB;

    if (parallelEnabled && fileSizeMB > 100) {
      return Math.round(baseTime / 3); // 3x speedup with parallelization
    }

    return Math.round(baseTime);
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
   * Get strategy history text for prompt
   */
  private getStrategyHistoryText(): string {
    if (this.strategySuccessRates.size === 0) {
      return '';
    }

    let text = '\n\nHistorical Success Rates:\n';
    for (const [strategy, stats] of this.strategySuccessRates.entries()) {
      const total = stats.successes + stats.failures;
      const rate = total > 0 ? (stats.successes / total * 100).toFixed(1) : 'N/A';
      text += `- ${strategy}: ${rate}% success (${stats.successes}/${total})\n`;
    }

    return text;
  }

  /**
   * Record strategy success/failure for learning
   */
  recordStrategyResult(strategy: string, success: boolean): void {
    if (!this.strategySuccessRates.has(strategy)) {
      this.strategySuccessRates.set(strategy, { successes: 0, failures: 0 });
    }

    const stats = this.strategySuccessRates.get(strategy)!;
    if (success) {
      stats.successes++;
    } else {
      stats.failures++;
    }

    logger.debug('Strategy result recorded', {
      strategy,
      success,
      successRate: (stats.successes / (stats.successes + stats.failures) * 100).toFixed(1) + '%',
    });
  }
}

// Singleton instance
let orchestratorInstance: AdaptiveParsingOrchestrator | null = null;

/**
 * Get the singleton adaptive parsing orchestrator instance
 */
export function getParsingOrchestrator(): AdaptiveParsingOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new AdaptiveParsingOrchestrator();
  }
  return orchestratorInstance;
}

export default {
  AdaptiveParsingOrchestrator,
  getParsingOrchestrator,
};
