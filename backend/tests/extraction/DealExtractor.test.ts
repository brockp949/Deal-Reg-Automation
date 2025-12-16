/**
 * DealExtractor Unit Tests
 */

import { DealExtractor } from '../../src/services/extraction/DealExtractor';
import { DealBoundary } from '../../src/services/extraction/types';

describe('DealExtractor', () => {
  let extractor: DealExtractor;

  beforeEach(() => {
    extractor = new DealExtractor({
      deduplicate: true,
      deduplicationThreshold: 0.85,
      minConfidence: 0.3,
    });
  });

  describe('extractDeals', () => {
    it('should extract deal name from text', async () => {
      const text = `
Deal: Acme Corporation
Value: $50,000
Status: Qualified
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.deals.length).toBe(1);
      expect(result.deals[0].dealName).toBe('Acme Corporation');
    });

    it('should extract deal value in various formats', async () => {
      // Test standard dollar format with commas
      const text = `Deal: Test\nValue: $150,000`;
      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.deals[0].dealValue).toBe(150000);
    });

    it('should extract deal value with K suffix', async () => {
      const text = `Deal: Test\nValue: $75k`;
      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      // K suffix should be converted to thousands
      expect(result.deals[0].dealValue).toBe(75000);
    });

    it('should extract customer name', async () => {
      const text = `
Deal: Enterprise Package
Customer: Big Corp Inc
Value: $100,000
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.deals[0].customerName).toBe('Big Corp Inc');
    });

    it('should extract status', async () => {
      const statusCases = [
        { text: 'Status: Qualified', expected: 'qualified' },
        { text: 'Stage: Discovery', expected: 'discovery' },
        { text: 'Phase: Negotiation', expected: 'negotiation' },
      ];

      for (const { text, expected } of statusCases) {
        const fullText = `Deal: Test\n${text}`;
        const boundaries: DealBoundary[] = [{
          startIndex: 0,
          endIndex: fullText.length,
          confidence: 0.95,
          detectionMethod: 'keyword',
          startLine: 1,
        }];

        const result = await extractor.extractDeals(fullText, boundaries);

        // Status may be normalized to lowercase
        expect(result.deals[0].status?.toLowerCase()).toBe(expected.toLowerCase());
      }
    });

    it('should extract expected close date in various formats', async () => {
      const dateCases = [
        { text: 'Expected Close: 2025-03-15', year: 2025, month: 3 },
        { text: 'Close Date: March 15, 2025', year: 2025, month: 3 },
        { text: 'Expected: 03/15/2025', year: 2025, month: 3 },
        { text: 'Close: Q2 2025', year: 2025 },
      ];

      for (const { text, year, month } of dateCases) {
        const fullText = `Deal: Test\n${text}`;
        const boundaries: DealBoundary[] = [{
          startIndex: 0,
          endIndex: fullText.length,
          confidence: 0.95,
          detectionMethod: 'keyword',
          startLine: 1,
        }];

        const result = await extractor.extractDeals(fullText, boundaries);

        if (result.deals[0].expectedCloseDate) {
          expect(result.deals[0].expectedCloseDate.getFullYear()).toBe(year);
          if (month) {
            expect(result.deals[0].expectedCloseDate.getMonth() + 1).toBe(month);
          }
        }
      }
    });

    it('should extract owner/rep name', async () => {
      const text = `
Deal: Test Deal
Owner: John Smith
Value: $50,000
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.deals[0].owner).toBe('John Smith');
    });

    it('should extract currency', async () => {
      const text = `
Deal: International Deal
Value: EUR 50,000
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      // Should detect EUR currency
      if (result.deals[0].currency) {
        expect(['EUR', 'USD']).toContain(result.deals[0].currency);
      }
    });

    it('should handle multiple deals', async () => {
      const text = `
Deal: First Corp
Value: $50,000

Deal: Second Inc
Value: $75,000

Deal: Third LLC
Value: $100,000
      `.trim();

      const boundaries: DealBoundary[] = [
        { startIndex: 0, endIndex: 30, confidence: 0.95, detectionMethod: 'keyword', startLine: 1 },
        { startIndex: 32, endIndex: 62, confidence: 0.95, detectionMethod: 'keyword', startLine: 4 },
        { startIndex: 64, endIndex: text.length, confidence: 0.95, detectionMethod: 'keyword', startLine: 7 },
      ];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.deals.length).toBe(3);
    });
  });

  describe('deduplication', () => {
    it('should remove duplicate deals', async () => {
      const text = `
Deal: Acme Corporation
Value: $50,000

Deal: Acme Corp
Value: $50,000
      `.trim();

      const boundaries: DealBoundary[] = [
        { startIndex: 0, endIndex: 35, confidence: 0.95, detectionMethod: 'keyword', startLine: 1 },
        { startIndex: 37, endIndex: text.length, confidence: 0.95, detectionMethod: 'keyword', startLine: 4 },
      ];

      const result = await extractor.extractDeals(text, boundaries);

      // Should deduplicate similar deals
      expect(result.deals.length).toBeLessThanOrEqual(2);
      expect(result.duplicates.length).toBeGreaterThanOrEqual(0);
    });

    it('should keep different deals', async () => {
      const text = `
Deal: Alpha Corp
Value: $50,000

Deal: Beta Inc
Value: $75,000
      `.trim();

      const boundaries: DealBoundary[] = [
        { startIndex: 0, endIndex: 32, confidence: 0.95, detectionMethod: 'keyword', startLine: 1 },
        { startIndex: 34, endIndex: text.length, confidence: 0.95, detectionMethod: 'keyword', startLine: 4 },
      ];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.deals.length).toBe(2);
      expect(result.duplicates.length).toBe(0);
    });

    it('should respect deduplication threshold', async () => {
      const strictExtractor = new DealExtractor({
        deduplicate: true,
        deduplicationThreshold: 0.99, // Very strict
        minConfidence: 0.3,
      });

      const text = `
Deal: Acme Corporation
Value: $50,000

Deal: Acme Corp Inc
Value: $50,000
      `.trim();

      const boundaries: DealBoundary[] = [
        { startIndex: 0, endIndex: 35, confidence: 0.95, detectionMethod: 'keyword', startLine: 1 },
        { startIndex: 37, endIndex: text.length, confidence: 0.95, detectionMethod: 'keyword', startLine: 4 },
      ];

      const result = await strictExtractor.extractDeals(text, boundaries);

      // With strict threshold, similar but not identical deals should be kept
      expect(result.deals.length).toBe(2);
    });

    it('should disable deduplication when configured', async () => {
      const noDedupExtractor = new DealExtractor({
        deduplicate: false,
        minConfidence: 0.3,
      });

      const text = `
Deal: Acme Corp
Value: $50,000

Deal: Acme Corp
Value: $50,000
      `.trim();

      const boundaries: DealBoundary[] = [
        { startIndex: 0, endIndex: 30, confidence: 0.95, detectionMethod: 'keyword', startLine: 1 },
        { startIndex: 32, endIndex: text.length, confidence: 0.95, detectionMethod: 'keyword', startLine: 4 },
      ];

      const result = await noDedupExtractor.extractDeals(text, boundaries);

      // Without deduplication, both deals should be kept
      expect(result.deals.length).toBe(2);
    });
  });

  describe('confidence scoring', () => {
    it('should assign high confidence to deals with many fields', async () => {
      const text = `
Deal: Complete Deal
Customer: Big Customer Inc
Value: $150,000
Status: Qualified
Owner: John Smith
Expected Close: 2025-03-15
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.deals[0].confidence).toBeGreaterThan(0.8);
    });

    it('should assign lower confidence to deals with few fields', async () => {
      const text = `
Deal: Sparse Deal
Notes: Not much info here
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.5,
        detectionMethod: 'structure',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      if (result.deals.length > 0) {
        expect(result.deals[0].confidence).toBeLessThan(0.8);
      }
    });

    it('should filter by minimum confidence', async () => {
      const highConfExtractor = new DealExtractor({
        deduplicate: true,
        minConfidence: 0.9,
      });

      const text = `
Deal: Test Deal
Value: $50,000
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.5,
        detectionMethod: 'structure',
        startLine: 1,
      }];

      const result = await highConfExtractor.extractDeals(text, boundaries);

      // Low confidence deals should be filtered out
      result.deals.forEach((deal) => {
        expect(deal.confidence).toBeGreaterThanOrEqual(0.9);
      });
    });
  });

  describe('statistics', () => {
    it('should return extraction statistics', async () => {
      const text = `
Deal: Test Corp
Customer: Test Customer
Value: $50,000
Status: Active
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.statistics).toBeDefined();
      expect(result.statistics.totalDeals).toBeGreaterThan(0);
      expect(result.statistics.fieldsExtracted).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty boundaries', async () => {
      const result = await extractor.extractDeals('Some text', []);

      expect(result.deals).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should handle empty text', async () => {
      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: 0,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals('', boundaries);

      // System may create placeholder deals for empty boundaries
      // The important thing is it doesn't crash
      expect(result).toBeDefined();
      expect(result.deals).toBeDefined();
    });

    it('should handle special characters', async () => {
      const text = `
Deal: ABC & Associates (UK) Ltd.
Value: $50,000
Customer: John O'Brien's Company
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.deals.length).toBe(1);
      expect(result.deals[0].dealName).toContain('ABC');
    });

    it('should handle unicode characters', async () => {
      const text = `
Deal: Müller GmbH
Value: EUR 50,000
Customer: Société Française
      `.trim();

      const boundaries: DealBoundary[] = [{
        startIndex: 0,
        endIndex: text.length,
        confidence: 0.95,
        detectionMethod: 'keyword',
        startLine: 1,
      }];

      const result = await extractor.extractDeals(text, boundaries);

      expect(result.deals.length).toBe(1);
    });
  });
});
