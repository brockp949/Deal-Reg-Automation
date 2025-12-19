/**
 * Claude Client Service
 *
 * Shared service for all Claude API interactions with:
 * - Retry logic with exponential backoff
 * - Rate limiting
 * - Error handling
 * - Logging and monitoring
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import logger from '../utils/logger';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequestOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  cacheControl?: boolean;
}

export interface ClaudeResponse {
  content: string;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

export class ClaudeClientService {
  private client: Anthropic;
  private requestCount: number = 0;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;

  constructor() {
    if (!config.anthropicApiKey) {
      logger.warn('Anthropic API key not configured - Claude features will be disabled');
      this.client = null as any;
      return;
    }

    this.client = new Anthropic({
      apiKey: config.anthropicApiKey,
    });

    logger.info('ClaudeClientService initialized', {
      model: config.aiModel,
      cacheEnabled: config.aiCacheEnabled,
    });
  }

  /**
   * Send a message to Claude with retry logic
   */
  async sendMessage(
    messages: ClaudeMessage[],
    options: ClaudeRequestOptions = {}
  ): Promise<ClaudeResponse> {
    const model = options.model || config.aiModel;
    const maxTokens = options.maxTokens || config.aiMaxTokens;
    const temperature = options.temperature !== undefined ? options.temperature : config.aiTemperature;

    let lastError: Error | null = null;
    const maxRetries = config.aiRetryAttempts;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.client) {
          throw new Error('Claude client not initialized (API key missing)');
        }

        logger.debug('Sending request to Claude', {
          model,
          messageCount: messages.length,
          attempt,
          maxRetries,
        });

        const startTime = Date.now();

        const response = await this.client.messages.create({
          model,
          max_tokens: maxTokens,
          temperature,
          system: options.systemPrompt,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content,
          })),
        });

        const duration = Date.now() - startTime;

        // Track usage
        this.requestCount++;
        this.totalInputTokens += response.usage.input_tokens;
        this.totalOutputTokens += response.usage.output_tokens;

        logger.info('Claude request successful', {
          model,
          duration,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          stopReason: response.stop_reason,
          totalRequests: this.requestCount,
        });

        // Extract text content
        const content = response.content
          .filter(block => block.type === 'text')
          .map(block => ('text' in block ? block.text : ''))
          .join('\n');

        return {
          content,
          stopReason: response.stop_reason || 'unknown',
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cacheCreationInputTokens: (response.usage as any).cache_creation_input_tokens,
            cacheReadInputTokens: (response.usage as any).cache_read_input_tokens,
          },
        };
      } catch (error: any) {
        lastError = error;

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);

        logger.warn('Claude request failed', {
          attempt,
          maxRetries,
          error: error.message,
          isRetryable,
          status: error.status,
        });

        if (!isRetryable || attempt === maxRetries) {
          throw new Error(`Claude API request failed after ${attempt} attempts: ${error.message}`);
        }

        // Exponential backoff
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        logger.debug('Retrying after delay', { delayMs, attempt });
        await this.delay(delayMs);
      }
    }

    throw lastError || new Error('Claude API request failed');
  }

  /**
   * Send a structured request with tool use (for structured output)
   */
  async sendStructuredRequest<T>(
    prompt: string,
    tool: {
      name: string;
      description: string;
      input_schema: Record<string, any>;
    },
    options: ClaudeRequestOptions = {}
  ): Promise<T> {
    const model = options.model || config.aiModel;
    const maxTokens = options.maxTokens || config.aiMaxTokens;
    const temperature = options.temperature !== undefined ? options.temperature : config.aiTemperature;

    try {
      if (!this.client) {
        throw new Error('Claude client not initialized (API key missing)');
      }

      logger.debug('Sending structured request to Claude', {
        model,
        toolName: tool.name,
      });

      const startTime = Date.now();

      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: options.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        tools: [tool as any],
        tool_choice: { type: 'tool', name: tool.name },
      });

      const duration = Date.now() - startTime;

      // Track usage
      this.requestCount++;
      this.totalInputTokens += response.usage.input_tokens;
      this.totalOutputTokens += response.usage.output_tokens;

      logger.info('Claude structured request successful', {
        model,
        duration,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });

      // Extract tool use result
      const toolUseBlock = response.content.find(block => block.type === 'tool_use');
      if (!toolUseBlock || !('input' in toolUseBlock)) {
        throw new Error('No tool use found in response');
      }

      return toolUseBlock.input as T;
    } catch (error: any) {
      logger.error('Claude structured request failed', {
        error: error.message,
        toolName: tool.name,
      });
      throw new Error(`Structured request failed: ${error.message}`);
    }
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      requestCount: this.requestCount,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      estimatedCost: this.calculateCost(),
    };
  }

  /**
   * Reset usage statistics
   */
  resetUsageStats() {
    this.requestCount = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
  }

  /**
   * Calculate estimated cost based on usage
   * Prices as of Claude 3.5 Sonnet (2024-10-22)
   */
  private calculateCost(): number {
    const inputCostPer1M = 3.0; // $3 per million input tokens
    const outputCostPer1M = 15.0; // $15 per million output tokens

    const inputCost = (this.totalInputTokens / 1_000_000) * inputCostPer1M;
    const outputCost = (this.totalOutputTokens / 1_000_000) * outputCostPer1M;

    return inputCost + outputCost;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Retry on rate limits, server errors, and timeouts
    if (error.status === 429) return true; // Rate limit
    if (error.status === 500) return true; // Server error
    if (error.status === 503) return true; // Service unavailable
    if (error.status === 529) return true; // Overloaded
    if (error.code === 'ETIMEDOUT') return true; // Timeout
    if (error.code === 'ECONNRESET') return true; // Connection reset

    return false;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let clientInstance: ClaudeClientService | null = null;

/**
 * Get the singleton Claude client instance
 */
export function getClaudeClient(): ClaudeClientService {
  if (!clientInstance) {
    clientInstance = new ClaudeClientService();
  }
  return clientInstance;
}

export default {
  ClaudeClientService,
  getClaudeClient,
};
