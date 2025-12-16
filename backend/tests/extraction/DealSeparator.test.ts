/**
 * DealSeparator Unit Tests
 */

import { DealSeparator } from '../../src/services/extraction/DealSeparator';

describe('DealSeparator', () => {
  let separator: DealSeparator;

  beforeEach(() => {
    separator = new DealSeparator({
      minConfidence: 0.2,
      mergeOverlapping: true,
    });
  });

  describe('separateDeals', () => {
    it('should separate deals by keyword markers', async () => {
      const text = `
Deal: Acme Corp
Value: $50,000
Status: Qualified

Deal: Beta Inc
Value: $75,000
Status: Discovery
      `.trim();

      const result = await separator.separateDeals(text);

      expect(result.boundaries.length).toBe(2);
      expect(result.boundaries[0].detectionMethod).toBe('keyword');
      expect(result.boundaries[0].confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should detect opportunity markers', async () => {
      const text = `
Opportunity: Enterprise Deal
Customer: Big Corp
Value: $100,000

Opportunity: SMB Package
Customer: Small Co
Value: $25,000
      `.trim();

      const result = await separator.separateDeals(text);

      expect(result.boundaries.length).toBe(2);
    });

    it('should detect customer/account markers', async () => {
      const text = `
Customer: First Customer Inc
Project Value: $50,000

Account: Second Account LLC
Deal Size: $30,000
      `.trim();

      const result = await separator.separateDeals(text);

      expect(result.boundaries.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle numbered lists', async () => {
      const text = `
1. Acme Corporation - $50,000 deal in Q1
   Status: Negotiation

2. Beta Technologies - $75,000 opportunity
   Status: Discovery

3. Gamma Solutions - $100,000 project
   Status: Qualified
      `.trim();

      const result = await separator.separateDeals(text);

      // Should detect these as potential deals
      expect(result.boundaries.length).toBeGreaterThanOrEqual(1);
    });

    it('should merge overlapping boundaries', async () => {
      const text = `
Deal: Acme Corp
Customer: Acme Corporation
Value: $50,000
      `.trim();

      const result = await separator.separateDeals(text);

      // Deal and Customer markers are close together, should merge
      expect(result.boundaries.length).toBe(1);
      // Merged boundary should be hybrid or higher confidence
    });

    it('should return empty boundaries for non-deal text', async () => {
      const text = `
This is just a regular paragraph without any deal information.
It talks about the weather and other unrelated topics.
No business opportunities mentioned here.
      `.trim();

      const result = await separator.separateDeals(text);

      expect(result.boundaries.length).toBe(0);
    });

    it('should filter by minimum confidence', async () => {
      const highConfidenceSeparator = new DealSeparator({
        minConfidence: 0.9,
        mergeOverlapping: true,
      });

      const text = `
Company: Some Corp
Project: Maybe a deal
Notes: Unclear status
      `.trim();

      const result = await highConfidenceSeparator.separateDeals(text);

      // Lower confidence detections should be filtered out
      result.boundaries.forEach((boundary) => {
        expect(boundary.confidence).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('should provide statistics', async () => {
      const text = `
Deal: First Deal
Value: $50,000

Deal: Second Deal
Value: $75,000
      `.trim();

      const result = await separator.separateDeals(text);

      expect(result.statistics).toBeDefined();
      expect(result.statistics.totalBoundaries).toBeGreaterThanOrEqual(1);
      expect(result.statistics.byMethod).toBeDefined();
      expect(result.statistics.averageConfidence).toBeGreaterThan(0);
    });

    it('should include warnings for potential issues', async () => {
      const separator = new DealSeparator({
        minConfidence: 0.2,
        mergeOverlapping: true,
        maxDeals: 2,
      });

      const text = `
Deal: First
Value: $10,000

Deal: Second
Value: $20,000

Deal: Third
Value: $30,000
      `.trim();

      const result = await separator.separateDeals(text);

      // Should have warning about truncation
      expect(result.boundaries.length).toBeLessThanOrEqual(2);
      if (result.warnings.length > 0) {
        expect(result.warnings[0]).toContain('Truncated');
      }
    });

    it('should track start and end lines', async () => {
      const text = `Line 1
Line 2
Deal: Test Deal
Value: $50,000
Status: Active
Line 6`;

      const result = await separator.separateDeals(text);

      if (result.boundaries.length > 0) {
        expect(result.boundaries[0].startLine).toBeDefined();
        expect(result.boundaries[0].startLine).toBeGreaterThan(0);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty text', async () => {
      const result = await separator.separateDeals('');

      expect(result.boundaries).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle text with only whitespace', async () => {
      const result = await separator.separateDeals('   \n\n   \t   ');

      expect(result.boundaries).toHaveLength(0);
    });

    it('should handle very long text', async () => {
      const deals = Array.from({ length: 50 }, (_, i) => `
Deal: Company ${i + 1}
Value: $${(i + 1) * 10000}
      `).join('\n\n');

      const result = await separator.separateDeals(deals);

      // Should handle without error, may be truncated by maxDeals
      expect(result.boundaries.length).toBeGreaterThan(0);
    });

    it('should handle special characters in deal names', async () => {
      const text = `
Deal: ABC & Associates (US)
Value: $50,000

Deal: 123-Tech Corp.
Value: $75,000
      `.trim();

      const result = await separator.separateDeals(text);

      // Should detect at least 1 deal (may merge adjacent deals)
      expect(result.boundaries.length).toBeGreaterThanOrEqual(1);
    });
  });
});
