/**
 * Unit Tests for AI Extraction Service
 * Tests entity extraction, API response parsing, error handling, caching, and confidence scoring
 */

import {
  extractEntitiesWithAI,
  extractDealsFromText,
  extractVendorsFromText,
  extractContactsFromText,
  extractDealValue,
  clearAICache,
  getAIUsageStats,
  calibrateConfidence,
  AIExtractionResult,
  ExtractedEntity,
} from '../../services/aiExtraction';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(),
      },
    })),
  };
});

// Mock OpenAI for fallback tests
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    })),
  };
});

// Mock the database query function
jest.mock('../../db', () => ({
  query: jest.fn(),
}));

// Mock fs/promises for prompt template loading
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

// Mock config
jest.mock('../../config', () => ({
  config: {
    anthropicApiKey: 'test-anthropic-key',
    aiModel: 'claude-3-5-sonnet-20241022',
    aiMaxTokens: 4000,
    aiTemperature: 0.0,
    aiCacheEnabled: true,
    ai: {
      anthropicApiKey: 'test-anthropic-key',
      openaiApiKey: 'test-openai-key',
    },
  },
}));

// Mock validation engine
jest.mock('../../services/validationEngine', () => ({
  validateDeal: jest.fn().mockResolvedValue({
    isValid: true,
    errors: [],
    warnings: [],
    confidenceAdjustment: 0,
    finalConfidence: 0.85,
    rulesApplied: ['deal_name_required', 'customer_name_required'],
    validatedAt: new Date(),
  }),
}));

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { query } from '../../db';
import { readFile } from 'fs/promises';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

// Get mock instances
const mockAnthropicCreate = jest.fn();
const mockOpenAICreate = jest.fn();

// Helper to create a default query mock response
function createDefaultQueryMock() {
  return jest.fn().mockImplementation((sql: string) => {
    // Check cache query - return no cache hit by default
    if (sql.includes('SELECT cached_response')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    // Update cache hit count
    if (sql.includes('UPDATE ai_extraction_cache') && sql.includes('hit_count')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    // Insert into cache
    if (sql.includes('INSERT INTO ai_extraction_cache')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    // Insert into extraction logs - return an id
    if (sql.includes('INSERT INTO ai_extraction_logs')) {
      return Promise.resolve({ rows: [{ id: 'log-123' }], rowCount: 1 });
    }
    // Insert/update usage stats
    if (sql.includes('ai_usage_stats')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    // Delete from cache
    if (sql.includes('DELETE FROM ai_extraction_cache')) {
      return Promise.resolve({ rows: [], rowCount: 10 });
    }
    // Default response
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

// ============================================================================
// Test Data
// ============================================================================

const sampleEmailText = `
Hi Team,

I wanted to follow up on our discussion with Acme Corporation regarding their Cloud Migration project.
They have confirmed a budget of $150,000 USD for the initial phase, with a target close date of March 15, 2025.

The main contact is John Smith (john.smith@acme.com), VP of IT.
They're looking to work with Microsoft Azure for this deployment.

Best regards,
Sarah Johnson
Account Executive
`;

const sampleValidApiResponse = {
  deals: [
    {
      dealName: 'Acme Corporation - Cloud Migration',
      customerName: 'Acme Corporation',
      dealValue: 150000,
      currency: 'USD',
      closeDate: '2025-03-15',
      status: 'qualified',
      vendorName: 'Microsoft Azure',
      description: 'Cloud infrastructure migration project',
      confidence: 0.92,
      sourceLocation: 'email body, lines 3-4',
      reasoning: 'Budget and timeline explicitly stated',
    },
  ],
  vendors: [
    {
      vendorName: 'Microsoft Azure',
      normalizedName: 'microsoft azure',
      aliases: ['Azure', 'MS Azure'],
      emailDomains: ['microsoft.com'],
      products: ['Cloud Infrastructure'],
      confidence: 0.95,
      reasoning: 'Explicitly mentioned as deployment platform',
    },
  ],
  contacts: [
    {
      name: 'John Smith',
      email: 'john.smith@acme.com',
      role: 'VP of IT',
      company: 'Acme Corporation',
      confidence: 0.98,
      sourceLocation: 'email body, line 5',
      reasoning: 'Contact details explicitly provided',
    },
    {
      name: 'Sarah Johnson',
      email: undefined,
      role: 'Account Executive',
      company: undefined,
      confidence: 0.85,
      sourceLocation: 'email signature',
      reasoning: 'Sender identified in signature',
    },
  ],
};

const promptTemplateContent = `# Entity Extraction Prompt
Analyze the text and extract deals, vendors, and contacts.
## Text to Analyze
{{TEXT}}`;

// ============================================================================
// Setup and Teardown
// ============================================================================

describe('AI Extraction Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Anthropic mock
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(
      () =>
        ({
          messages: {
            create: mockAnthropicCreate,
          },
        }) as any
    );

    // Setup OpenAI mock
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create: mockOpenAICreate,
            },
          },
        }) as any
    );

    // Default mock for prompt template loading
    mockReadFile.mockResolvedValue(promptTemplateContent);

    // Default mock for database queries - handles all query types
    (mockQuery as jest.Mock).mockImplementation((sql: string) => {
      // Check cache query - return no cache hit by default
      if (sql.includes('SELECT cached_response')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      // Update cache hit count
      if (sql.includes('UPDATE ai_extraction_cache') && sql.includes('hit_count')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      // Insert into cache
      if (sql.includes('INSERT INTO ai_extraction_cache')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      // Insert into extraction logs - return an id
      if (sql.includes('INSERT INTO ai_extraction_logs')) {
        return Promise.resolve({ rows: [{ id: 'log-123' }], rowCount: 1 });
      }
      // Insert/update usage stats
      if (sql.includes('ai_usage_stats')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      // Delete from cache
      if (sql.includes('DELETE FROM ai_extraction_cache')) {
        return Promise.resolve({ rows: [], rowCount: 10 });
      }
      // Default response
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  // ==========================================================================
  // Tests: extractEntities() - Successful Extraction
  // ==========================================================================

  describe('extractEntitiesWithAI - Successful Extraction', () => {
    it('should extract entities from text successfully', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(result).toBeDefined();
      expect(result.entities).toHaveLength(4); // 1 deal + 1 vendor + 2 contacts
      expect(result.cached).toBe(false);
      expect(result.tokensUsed).toBe(700);
      expect(result.extractionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should extract only deals when extraction type is deal', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ deals: sampleValidApiResponse.deals, vendors: [], contacts: [] }),
          },
        ],
        usage: { input_tokens: 400, output_tokens: 100 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'deal');

      expect(result.entities.filter((e) => e.type === 'deal')).toHaveLength(1);
      expect(result.entities[0].type).toBe('deal');
      expect(result.entities[0].data.dealName).toBe('Acme Corporation - Cloud Migration');
    });

    it('should extract only vendors when extraction type is vendor', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              deals: [],
              vendors: sampleValidApiResponse.vendors,
              contacts: [],
            }),
          },
        ],
        usage: { input_tokens: 300, output_tokens: 80 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'vendor');

      const vendors = result.entities.filter((e) => e.type === 'vendor');
      expect(vendors).toHaveLength(1);
      expect(vendors[0].data.vendorName).toBe('Microsoft Azure');
    });

    it('should extract only contacts when extraction type is contact', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              deals: [],
              vendors: [],
              contacts: sampleValidApiResponse.contacts,
            }),
          },
        ],
        usage: { input_tokens: 350, output_tokens: 120 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'contact');

      const contacts = result.entities.filter((e) => e.type === 'contact');
      expect(contacts).toHaveLength(2);
      expect(contacts[0].data.name).toBe('John Smith');
    });

    it('should include vendor hints in prompt when provided', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      await extractEntitiesWithAI(sampleEmailText, 'all', {
        vendorHints: ['Microsoft', 'Azure', 'AWS'],
      });

      expect(mockAnthropicCreate).toHaveBeenCalled();
      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('Known Vendors');
      expect(callArgs.messages[0].content).toContain('Microsoft');
    });

    it('should include custom templates in system prompt when provided', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      const customTemplates = {
        deal: { requiredFields: ['dealName', 'customerName'] },
      };

      await extractEntitiesWithAI(sampleEmailText, 'all', {
        templates: customTemplates,
      });

      expect(mockAnthropicCreate).toHaveBeenCalled();
      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      expect(callArgs.system).toContain('custom templates');
    });

    it('should log extraction to database', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      await extractEntitiesWithAI(sampleEmailText, 'all', { sourceFileId: 'file-123' });

      // Should have INSERT for ai_extraction_logs
      const insertCalls = mockQuery.mock.calls.filter((call) =>
        call[0].includes('INSERT INTO ai_extraction_logs')
      );
      expect(insertCalls.length).toBeGreaterThan(0);
    });

    it('should update usage statistics', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      await extractEntitiesWithAI(sampleEmailText, 'all');

      // Should have INSERT/UPDATE for ai_usage_stats
      const statsCalls = mockQuery.mock.calls.filter((call) =>
        call[0].includes('ai_usage_stats')
      );
      expect(statsCalls.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Tests: API Response Parsing
  // ==========================================================================

  describe('API Response Parsing', () => {
    it('should parse valid JSON response', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(result.entities).toBeDefined();
      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('should parse JSON wrapped in markdown code blocks', async () => {
      const wrappedResponse = '```json\n' + JSON.stringify(sampleValidApiResponse) + '\n```';

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: wrappedResponse }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(result.entities).toBeDefined();
      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('should parse JSON wrapped in generic code blocks', async () => {
      const wrappedResponse = '```\n' + JSON.stringify(sampleValidApiResponse) + '\n```';

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: wrappedResponse }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(result.entities).toBeDefined();
    });

    it('should handle malformed JSON response', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{ invalid json here' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      await expect(extractEntitiesWithAI(sampleEmailText, 'all')).rejects.toThrow(
        'Invalid JSON response from AI'
      );
    });

    it('should handle empty deals array', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ deals: [], vendors: [], contacts: [] }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 20 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(result.entities).toHaveLength(0);
      expect(result.confidence).toBe(0);
    });

    it('should handle response with missing optional fields', async () => {
      const minimalResponse = {
        deals: [
          {
            dealName: 'Test Deal',
            customerName: 'Test Customer',
          },
        ],
        vendors: [],
        contacts: [],
      };

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(minimalResponse) }],
        usage: { input_tokens: 100, output_tokens: 30 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'deal');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].data.dealName).toBe('Test Deal');
      // Default confidence 0.5 is calibrated down slightly for missing dealValue (0.5 * 0.95 = 0.475)
      expect(result.entities[0].confidence).toBeCloseTo(0.475, 2);
    });

    it('should handle non-text content type from API', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'image', source: {} }],
        usage: { input_tokens: 100, output_tokens: 0 },
      });

      await expect(extractEntitiesWithAI(sampleEmailText, 'all')).rejects.toThrow(
        'Unexpected response type from Anthropic API'
      );
    });
  });

  // ==========================================================================
  // Tests: Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should throw error when API returns undefined response', async () => {
      // Mock the API to return undefined, simulating a configuration or connection issue
      mockAnthropicCreate.mockResolvedValue(undefined);

      await expect(extractEntitiesWithAI('test text', 'all')).rejects.toThrow();
    });

    it('should handle API rate limiting errors (429)', async () => {
      const rateLimitError = new Error('Rate limit exceeded') as any;
      rateLimitError.status = 429;

      mockAnthropicCreate.mockRejectedValue(rateLimitError);

      await expect(extractEntitiesWithAI(sampleEmailText, 'all')).rejects.toThrow(
        'Rate limit exceeded'
      );
    });

    it('should handle API timeout errors', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TimeoutError';

      mockAnthropicCreate.mockRejectedValue(timeoutError);

      await expect(extractEntitiesWithAI(sampleEmailText, 'all')).rejects.toThrow(
        'Request timeout'
      );
    });

    it('should handle API authentication errors (401)', async () => {
      const authError = new Error('Unauthorized') as any;
      authError.status = 401;

      mockAnthropicCreate.mockRejectedValue(authError);

      await expect(extractEntitiesWithAI(sampleEmailText, 'all')).rejects.toThrow(
        'Unauthorized'
      );
    });

    it('should handle API server errors (500) with retry', async () => {
      const serverError = new Error('Internal Server Error') as any;
      serverError.status = 500;

      mockAnthropicCreate
        .mockRejectedValueOnce(serverError)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(mockAnthropicCreate).toHaveBeenCalledTimes(3);
      expect(result.entities).toBeDefined();
    });

    it('should fail after max retries exceeded', async () => {
      const serverError = new Error('Internal Server Error') as any;
      serverError.status = 500;

      mockAnthropicCreate.mockRejectedValue(serverError);

      await expect(extractEntitiesWithAI(sampleEmailText, 'all')).rejects.toThrow(
        'Internal Server Error'
      );
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(3); // Max retries
    });

    it('should not retry on client errors (4xx)', async () => {
      const clientError = new Error('Bad Request') as any;
      clientError.status = 400;

      mockAnthropicCreate.mockRejectedValue(clientError);

      await expect(extractEntitiesWithAI(sampleEmailText, 'all')).rejects.toThrow('Bad Request');
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1); // No retry
    });

    it('should log failed extraction to database', async () => {
      const apiError = new Error('API failure');
      mockAnthropicCreate.mockRejectedValue(apiError);

      try {
        await extractEntitiesWithAI(sampleEmailText, 'all');
      } catch {
        // Expected to throw
      }

      // Should log failed extraction
      const logCalls = mockQuery.mock.calls.filter(
        (call) =>
          call[0].includes('INSERT INTO ai_extraction_logs') && call[1]?.includes(false)
      );
      expect(logCalls.length).toBeGreaterThan(0);
    });

    it('should handle prompt template not found error', async () => {
      // Clear the prompt cache by resetting modules
      jest.resetModules();

      // Re-mock dependencies
      jest.doMock('fs/promises', () => ({
        readFile: jest.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
      }));
      jest.doMock('../../db', () => ({
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('SELECT cached_response')) {
            return Promise.resolve({ rows: [], rowCount: 0 });
          }
          if (sql.includes('INSERT INTO ai_extraction_logs')) {
            return Promise.resolve({ rows: [{ id: 'log-123' }], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      }));
      jest.doMock('@anthropic-ai/sdk', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          messages: { create: jest.fn() },
        })),
      }));
      jest.doMock('../../config', () => ({
        config: {
          anthropicApiKey: 'test-key',
          aiModel: 'claude-3-5-sonnet-20241022',
          aiMaxTokens: 4000,
          aiTemperature: 0.0,
          aiCacheEnabled: true,
          ai: { anthropicApiKey: 'test-key', openaiApiKey: 'test-key' },
        },
      }));

      const { extractEntitiesWithAI: freshExtract } = await import(
        '../../services/aiExtraction'
      );

      await expect(freshExtract(sampleEmailText, 'all')).rejects.toThrow(
        'Prompt template not found'
      );
    });
  });

  // ==========================================================================
  // Tests: Caching Behavior
  // ==========================================================================

  describe('Caching Behavior', () => {
    it('should return cached result on cache hit', async () => {
      const cachedResponse = {
        entities: sampleValidApiResponse.deals.map((d) => ({
          type: 'deal' as const,
          data: d,
          confidence: d.confidence,
        })),
        confidence: 0.92,
        model: 'claude-3-5-sonnet-20241022',
        promptVersion: 'v1.0.0',
        tokensUsed: 700,
        extractionTimeMs: 1500,
        cached: true,
      };

      // Override the mock for this specific test
      (mockQuery as jest.Mock).mockImplementation((sql: string) => {
        if (sql.includes('SELECT cached_response')) {
          return Promise.resolve({
            rows: [{ cached_response: cachedResponse, hit_count: 5 }],
            rowCount: 1,
          });
        }
        if (sql.includes('UPDATE ai_extraction_cache') && sql.includes('hit_count')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (sql.includes('ai_usage_stats')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(result.cached).toBe(true);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    it('should call API on cache miss', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(result.cached).toBe(false);
      expect(mockAnthropicCreate).toHaveBeenCalled();
    });

    it('should save result to cache after successful extraction', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      await extractEntitiesWithAI(sampleEmailText, 'all');

      // Check for cache INSERT
      const cacheCalls = mockQuery.mock.calls.filter((call) =>
        call[0].includes('INSERT INTO ai_extraction_cache')
      );
      expect(cacheCalls.length).toBeGreaterThan(0);
    });

    it('should update cache hit count on cache hit', async () => {
      const cachedResponse = {
        entities: [],
        confidence: 0.5,
        model: 'claude-3-5-sonnet-20241022',
        promptVersion: 'v1.0.0',
        tokensUsed: 100,
        extractionTimeMs: 500,
        cached: true,
      };

      // Override the mock for this specific test
      (mockQuery as jest.Mock).mockImplementation((sql: string) => {
        if (sql.includes('SELECT cached_response')) {
          return Promise.resolve({
            rows: [{ cached_response: cachedResponse, hit_count: 5 }],
            rowCount: 1,
          });
        }
        if (sql.includes('UPDATE ai_extraction_cache') && sql.includes('hit_count')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (sql.includes('ai_usage_stats')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await extractEntitiesWithAI(sampleEmailText, 'all');

      // Check for hit_count UPDATE
      const updateCalls = mockQuery.mock.calls.filter(
        (call) => call[0].includes('UPDATE') && call[0].includes('hit_count')
      );
      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it('should handle cache database errors gracefully', async () => {
      let cacheChecked = false;
      // Override the mock for this specific test
      (mockQuery as jest.Mock).mockImplementation((sql: string) => {
        if (sql.includes('SELECT cached_response')) {
          cacheChecked = true;
          return Promise.reject(new Error('Database connection error'));
        }
        if (sql.includes('INSERT INTO ai_extraction_logs')) {
          return Promise.resolve({ rows: [{ id: 'log-123' }], rowCount: 1 });
        }
        if (sql.includes('ai_usage_stats')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (sql.includes('ai_extraction_cache')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      // Should not throw, should fall back to API
      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(cacheChecked).toBe(true);
      expect(result.cached).toBe(false);
      expect(mockAnthropicCreate).toHaveBeenCalled();
    });

    it('should generate consistent hash for same input', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      await extractEntitiesWithAI(sampleEmailText, 'deal');
      await extractEntitiesWithAI(sampleEmailText, 'deal');

      // Both calls should use the same hash for cache checks
      const cacheCheckCalls = mockQuery.mock.calls.filter((call) =>
        call[0].includes('SELECT cached_response')
      );
      const hashes = cacheCheckCalls.map((call) => call[1]?.[0]).filter(Boolean);
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(1);
    });
  });

  // ==========================================================================
  // Tests: Prompt Template Loading
  // ==========================================================================

  describe('Prompt Template Loading', () => {
    it('should use prompt template content in API call', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      await extractEntitiesWithAI(sampleEmailText, 'all');

      // The prompt template should be used - check if API was called with expected content
      expect(mockAnthropicCreate).toHaveBeenCalled();
      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain(sampleEmailText);
    });

    it('should include extraction type in prompt', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      await extractEntitiesWithAI(sampleEmailText, 'deal');

      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('Extraction Type: deal');
    });

    it('should substitute {{TEXT}} placeholder in prompt', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      await extractEntitiesWithAI('Test input text', 'all');

      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('Test input text');
      expect(callArgs.messages[0].content).not.toContain('{{TEXT}}');
    });
  });

  // ==========================================================================
  // Tests: Confidence Scoring
  // ==========================================================================

  describe('Confidence Scoring', () => {
    describe('calibrateConfidence', () => {
      it('should penalize deal missing dealName', () => {
        const confidence = calibrateConfidence(0.9, 'deal', { customerName: 'Acme' });
        expect(confidence).toBeLessThan(0.9);
        // 0.9 * 0.8 (missing dealName) * 0.95 (missing dealValue) = 0.684
        expect(confidence).toBeLessThan(0.75);
      });

      it('should penalize deal missing customerName', () => {
        const confidence = calibrateConfidence(0.9, 'deal', { dealName: 'Test Deal' });
        expect(confidence).toBeLessThan(0.9);
        // 0.9 * 0.8 (missing customerName) * 0.95 (missing dealValue) = 0.684
        expect(confidence).toBeLessThan(0.75);
      });

      it('should slightly penalize deal missing dealValue', () => {
        const confidence = calibrateConfidence(0.9, 'deal', {
          dealName: 'Test',
          customerName: 'Acme',
        });
        // 0.9 * 0.95 = 0.855
        expect(confidence).toBeCloseTo(0.855, 2);
      });

      it('should penalize vendor missing name', () => {
        const confidence = calibrateConfidence(0.9, 'vendor', { products: ['Cloud'] });
        expect(confidence).toBeLessThan(0.9);
        expect(confidence).toBeCloseTo(0.72, 2);
      });

      it('should penalize contact missing name', () => {
        const confidence = calibrateConfidence(0.9, 'contact', {
          email: 'test@example.com',
        });
        expect(confidence).toBeLessThan(0.9);
      });

      it('should penalize contact missing both email and phone', () => {
        const confidence = calibrateConfidence(0.9, 'contact', { name: 'John Doe' });
        expect(confidence).toBeLessThan(0.9);
        expect(confidence).toBeCloseTo(0.81, 2); // 0.9 * 0.9
      });

      it('should boost confidence for deal with currency symbol', () => {
        const confidence = calibrateConfidence(0.85, 'deal', {
          dealName: 'Test',
          customerName: 'Acme',
          dealValue: 50000,
          currency: 'USD',
        });
        expect(confidence).toBeGreaterThan(0.85);
      });

      it('should boost confidence for deal with valid close date', () => {
        const confidence = calibrateConfidence(0.85, 'deal', {
          dealName: 'Test',
          customerName: 'Acme',
          dealValue: 50000,
          closeDate: '2025-03-15',
        });
        expect(confidence).toBeGreaterThan(0.85);
      });

      it('should clamp confidence between 0 and 1', () => {
        const highConfidence = calibrateConfidence(1.5, 'deal', {
          dealName: 'Test',
          customerName: 'Acme',
          currency: 'USD',
          closeDate: '2025-03-15',
        });
        expect(highConfidence).toBeLessThanOrEqual(1);

        const lowConfidence = calibrateConfidence(-0.5, 'deal', {});
        expect(lowConfidence).toBeGreaterThanOrEqual(0);
      });
    });

    it('should calculate average confidence from extracted entities', async () => {
      const mixedConfidenceResponse = {
        deals: [
          { dealName: 'Deal 1', customerName: 'Customer 1', confidence: 0.9 },
          { dealName: 'Deal 2', customerName: 'Customer 2', confidence: 0.6 },
        ],
        vendors: [],
        contacts: [],
      };

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mixedConfidenceResponse) }],
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'deal');

      // After calibration, average should be calculated
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(1);
    });
  });

  // ==========================================================================
  // Tests: Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty text', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ deals: [], vendors: [], contacts: [] }),
          },
        ],
        usage: { input_tokens: 50, output_tokens: 20 },
      });

      const result = await extractEntitiesWithAI('', 'all');

      expect(result.entities).toHaveLength(0);
    });

    it('should handle very long text', async () => {
      const longText = 'Deal information '.repeat(10000);

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 50000, output_tokens: 200 },
      });

      const result = await extractEntitiesWithAI(longText, 'all');

      expect(result).toBeDefined();
      expect(mockAnthropicCreate).toHaveBeenCalled();
    });

    it('should handle special characters in text', async () => {
      const specialCharsText = `
        Deal: "Acme Corp" - Cloud Migration <Phase 1>
        Value: $150,000 (USD) & tax
        Contact: john.smith@acme.com
        Notes: This is a "high priority" deal with special chars: <>&"'
      `;

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 300, output_tokens: 150 },
      });

      const result = await extractEntitiesWithAI(specialCharsText, 'all');

      expect(result).toBeDefined();
    });

    it('should handle unicode characters in text', async () => {
      const unicodeText = `
        Deal with Société Générale for 500,000 EUR
        Contact: Jean-Pierre Müller (jp.müller@société.com)
        日本語テスト
      `;

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      const result = await extractEntitiesWithAI(unicodeText, 'all');

      expect(result).toBeDefined();
    });

    it('should handle text with only whitespace', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ deals: [], vendors: [], contacts: [] }),
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      });

      const result = await extractEntitiesWithAI('   \n\t\n   ', 'all');

      expect(result.entities).toHaveLength(0);
    });

    it('should handle null/undefined in API response fields', async () => {
      const responseWithNulls = {
        deals: [
          {
            dealName: 'Test Deal',
            customerName: 'Test Customer',
            dealValue: null,
            closeDate: undefined,
            confidence: 0.8,
          },
        ],
        vendors: null,
        contacts: undefined,
      };

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(responseWithNulls) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(result.entities).toHaveLength(1);
    });

    it('should handle deeply nested response structures', async () => {
      const nestedResponse = {
        deals: [
          {
            dealName: 'Nested Deal',
            customerName: 'Nested Customer',
            metadata: {
              nested: {
                deeply: {
                  value: 'test',
                },
              },
            },
            confidence: 0.75,
          },
        ],
        vendors: [],
        contacts: [],
      };

      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(nestedResponse) }],
        usage: { input_tokens: 150, output_tokens: 80 },
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'deal');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].data.metadata).toBeDefined();
    });
  });

  // ==========================================================================
  // Tests: Convenience Functions
  // ==========================================================================

  describe('Convenience Functions', () => {
    describe('extractDealsFromText', () => {
      it('should return only deal data', async () => {
        mockAnthropicCreate.mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
          usage: { input_tokens: 500, output_tokens: 200 },
        });

        const deals = await extractDealsFromText(sampleEmailText);

        expect(Array.isArray(deals)).toBe(true);
        expect(deals[0]).toHaveProperty('dealName');
        expect(deals[0]).toHaveProperty('customerName');
      });
    });

    describe('extractVendorsFromText', () => {
      it('should return only vendor data', async () => {
        mockAnthropicCreate.mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
          usage: { input_tokens: 400, output_tokens: 150 },
        });

        const vendors = await extractVendorsFromText(sampleEmailText);

        expect(Array.isArray(vendors)).toBe(true);
        if (vendors.length > 0) {
          expect(vendors[0]).toHaveProperty('vendorName');
        }
      });
    });

    describe('extractContactsFromText', () => {
      it('should return only contact data', async () => {
        mockAnthropicCreate.mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify(sampleValidApiResponse) }],
          usage: { input_tokens: 400, output_tokens: 150 },
        });

        const contacts = await extractContactsFromText(sampleEmailText);

        expect(Array.isArray(contacts)).toBe(true);
        if (contacts.length > 0) {
          expect(contacts[0]).toHaveProperty('name');
        }
      });
    });

    describe('extractDealValue', () => {
      it('should extract monetary value from text', async () => {
        mockAnthropicCreate.mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                value: 150000,
                currency: 'USD',
                confidence: 0.95,
                sourceText: '$150,000 USD',
              }),
            },
          ],
          usage: { input_tokens: 100, output_tokens: 30 },
        });

        const value = await extractDealValue('The deal is worth $150,000 USD');

        expect(value).toBeDefined();
        expect(value?.value).toBe(150000);
        expect(value?.currency).toBe('USD');
      });

      it('should return null when no value found', async () => {
        mockAnthropicCreate.mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ value: null, currency: null }),
            },
          ],
          usage: { input_tokens: 50, output_tokens: 10 },
        });

        const value = await extractDealValue('No monetary value here');

        expect(value).toBeNull();
      });
    });
  });

  // ==========================================================================
  // Tests: Cache Management
  // ==========================================================================

  describe('Cache Management', () => {
    describe('clearAICache', () => {
      it('should clear all cache entries', async () => {
        mockQuery.mockResolvedValue({ rowCount: 10 } as any);

        const deletedCount = await clearAICache();

        expect(deletedCount).toBe(10);
        expect(mockQuery).toHaveBeenCalledWith('DELETE FROM ai_extraction_cache');
      });

      it('should handle database errors', async () => {
        mockQuery.mockRejectedValue(new Error('Database error'));

        await expect(clearAICache()).rejects.toThrow('Database error');
      });
    });

    describe('getAIUsageStats', () => {
      it('should return usage statistics', async () => {
        const stats = [
          {
            date: '2025-01-15',
            extraction_type: 'deal',
            total_requests: 100,
            total_tokens: 50000,
            average_confidence: 0.85,
            success_rate: 0.95,
          },
        ];

        mockQuery.mockResolvedValue({ rows: stats } as any);

        const result = await getAIUsageStats();

        expect(result).toEqual(stats);
      });

      it('should filter by date range', async () => {
        mockQuery.mockResolvedValue({ rows: [] } as any);

        await getAIUsageStats({
          startDate: '2025-01-01',
          endDate: '2025-01-31',
        });

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('date >='),
          expect.arrayContaining(['2025-01-01', '2025-01-31'])
        );
      });

      it('should filter by extraction type', async () => {
        mockQuery.mockResolvedValue({ rows: [] } as any);

        await getAIUsageStats({ extractionType: 'deal' });

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('extraction_type ='),
          expect.arrayContaining(['deal'])
        );
      });
    });
  });

  // ==========================================================================
  // Tests: OpenAI Fallback
  // ==========================================================================

  describe('OpenAI Fallback', () => {
    it('should fall back to OpenAI when Claude fails and fallback is available', async () => {
      const claudeError = new Error('Claude unavailable') as any;
      claudeError.status = 503;

      mockAnthropicCreate.mockRejectedValue(claudeError);
      mockOpenAICreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(sampleValidApiResponse),
            },
          },
        ],
        usage: { total_tokens: 600 },
        model: 'gpt-4-turbo-preview',
      });

      const result = await extractEntitiesWithAI(sampleEmailText, 'all');

      expect(result.entities).toBeDefined();
      expect(result.model).toBe('gpt-4-turbo-preview');
    });

    it('should throw original error if fallback also fails', async () => {
      const claudeError = new Error('Claude unavailable') as any;
      claudeError.status = 503;
      const openaiError = new Error('OpenAI also unavailable');

      mockAnthropicCreate.mockRejectedValue(claudeError);
      mockOpenAICreate.mockRejectedValue(openaiError);

      await expect(extractEntitiesWithAI(sampleEmailText, 'all')).rejects.toThrow(
        'Claude unavailable'
      );
    });
  });
});
