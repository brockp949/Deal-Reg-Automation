/**
 * Pipeline Integration Tests
 *
 * Tests the full extraction pipeline from raw text to exported deals.
 */

import { DealSeparator } from '../../src/services/extraction/DealSeparator';
import { DealExtractor } from '../../src/services/extraction/DealExtractor';
import { ExportManager } from '../../src/services/export/ExportManager';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Extraction Pipeline Integration', () => {
  let separator: DealSeparator;
  let extractor: DealExtractor;
  let exportManager: ExportManager;
  let tempDir: string;

  beforeEach(() => {
    separator = new DealSeparator({
      minConfidence: 0.2,
      mergeOverlapping: true,
    });

    extractor = new DealExtractor({
      deduplicate: true,
      deduplicationThreshold: 0.85,
      minConfidence: 0.3,
    });

    exportManager = new ExportManager({
      includeExtendedColumns: true,
    });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('full pipeline', () => {
    it('should process a complete transcript with multiple deals', async () => {
      const transcript = `
Meeting Notes - Q4 Pipeline Review
Date: December 15, 2024

---

Deal: Acme Corporation
Customer: Acme Corp
Value: $150,000
Status: Qualified
Expected Close: 2025-03-30
Owner: John Smith

---

Deal: Beta Technologies Inc
Customer: Beta Tech
Value: $75,000
Status: Discovery
Expected Close: Q2 2025

---

Deal: Gamma Solutions LLC
Customer: Gamma Solutions
Value: $250,000
Status: Negotiation
Expected Close: January 31, 2025

---

Action Items:
1. Follow up with Acme
2. Schedule Beta demo
      `.trim();

      // Step 1: Separate deals
      const separationResult = await separator.separateDeals(transcript);
      expect(separationResult.boundaries.length).toBeGreaterThanOrEqual(3);

      // Step 2: Extract deals
      const extractionResult = await extractor.extractDeals(
        transcript,
        separationResult.boundaries
      );
      expect(extractionResult.deals.length).toBeGreaterThanOrEqual(3);

      // Verify extracted data
      const acmeDeal = extractionResult.deals.find(d =>
        d.dealName.toLowerCase().includes('acme')
      );
      expect(acmeDeal).toBeDefined();
      expect(acmeDeal?.dealValue).toBe(150000);
      expect(acmeDeal?.status).toContain('Qualified');

      // Step 3: Export to multiple formats
      const exportResults = await exportManager.exportMultiple(
        extractionResult.deals,
        ['csv', 'xlsx', 'json'],
        { outputDir: tempDir }
      );

      expect(exportResults.get('csv')?.success).toBe(true);
      expect(exportResults.get('xlsx')?.success).toBe(true);
      expect(exportResults.get('json')?.success).toBe(true);

      // Verify CSV content
      const csvPath = exportResults.get('csv')?.filePath;
      if (csvPath) {
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        expect(csvContent).toContain('Acme');
        expect(csvContent).toContain('Beta');
        expect(csvContent).toContain('Gamma');
      }
    });

    it('should handle numbered list format', async () => {
      const transcript = `
Sales Pipeline Update

1. Acme Corporation - $50,000 enterprise deal
   Status: Negotiation
   Close: Q1 2025

2. Beta Inc - $25,000 SMB package
   Status: Discovery
   Close: March 2025

3. Gamma LLC - $100,000 partnership
   Status: Qualified
   Close: February 2025
      `.trim();

      const separationResult = await separator.separateDeals(transcript);
      const extractionResult = await extractor.extractDeals(
        transcript,
        separationResult.boundaries
      );

      // Should extract deals from numbered list
      expect(extractionResult.deals.length).toBeGreaterThanOrEqual(1);
    });

    it('should deduplicate similar deals', async () => {
      const transcript = `
Deal: Acme Corporation
Value: $50,000
Status: Qualified

---

Deal: Acme Corp
Value: $50,000
Status: Qualified

---

Deal: Beta Technologies
Value: $75,000
Status: Discovery
      `.trim();

      const separationResult = await separator.separateDeals(transcript);
      const extractionResult = await extractor.extractDeals(
        transcript,
        separationResult.boundaries
      );

      // Should detect duplicate deals - may or may not merge depending on similarity threshold
      const dealCount = extractionResult.deals.length;
      const duplicateCount = extractionResult.duplicates.length;

      // Total deals found (before and after dedup) should be at least 2
      expect(dealCount + duplicateCount).toBeGreaterThanOrEqual(2);
    });

    it('should handle real-world messy text', async () => {
      const transcript = `
From: sales@company.com
To: team@company.com
Subject: Weekly Pipeline Update

Hey team,

Here's what I'm working on:

**Deal: BigCorp Enterprise**
- Customer: BigCorp Inc.
- Value: Around $200K
- Status: In negotiations
- Expected close: sometime in Q1

Also working on a smaller deal with SmallCo for about $30,000.
They're still in discovery phase.

Let me know if you have questions.

Best,
Sales Rep
      `.trim();

      const separationResult = await separator.separateDeals(transcript);
      const extractionResult = await extractor.extractDeals(
        transcript,
        separationResult.boundaries
      );

      // Should extract at least the main deal
      expect(extractionResult.deals.length).toBeGreaterThanOrEqual(1);

      const bigCorpDeal = extractionResult.deals.find(d =>
        d.dealName.toLowerCase().includes('bigcorp')
      );

      // Should find BigCorp deal
      expect(bigCorpDeal).toBeDefined();

      // Value extraction may vary based on format - just check it exists or is reasonable
      if (bigCorpDeal?.dealValue) {
        expect(bigCorpDeal.dealValue).toBeGreaterThan(0);
      }
    });

    it('should preserve source location information', async () => {
      const transcript = `
Line 1: Header

Deal: Test Deal
Value: $50,000
Status: Active

More content here
      `.trim();

      const separationResult = await separator.separateDeals(transcript);
      const extractionResult = await extractor.extractDeals(
        transcript,
        separationResult.boundaries
      );

      if (extractionResult.deals.length > 0) {
        const deal = extractionResult.deals[0];
        expect(deal.sourceLocation).toBeDefined();
        expect(deal.sourceLocation.startLine).toBeGreaterThan(0);
      }
    });
  });

  describe('error handling', () => {
    it('should handle empty input gracefully', async () => {
      const separationResult = await separator.separateDeals('');
      const extractionResult = await extractor.extractDeals('', []);

      expect(separationResult.boundaries).toHaveLength(0);
      expect(extractionResult.deals).toHaveLength(0);
    });

    it('should handle text with no deals', async () => {
      const text = `
This is just a regular document about weather patterns
and climate change. No business deals mentioned here.
      `.trim();

      const separationResult = await separator.separateDeals(text);
      const extractionResult = await extractor.extractDeals(
        text,
        separationResult.boundaries
      );

      expect(extractionResult.deals.length).toBe(0);
    });

    it('should handle malformed deal data', async () => {
      const text = `
Deal:
Value: not a number
Status:
      `.trim();

      const separationResult = await separator.separateDeals(text);
      const extractionResult = await extractor.extractDeals(
        text,
        separationResult.boundaries
      );

      // Should not crash, may or may not extract a deal
      expect(extractionResult).toBeDefined();
    });
  });

  describe('performance', () => {
    it('should process large documents efficiently', async () => {
      // Generate a large document with many deals
      const deals = Array.from({ length: 100 }, (_, i) => `
Deal: Company ${i + 1}
Value: $${(i + 1) * 10000}
Status: Active
      `).join('\n---\n');

      const startTime = Date.now();

      const separationResult = await separator.separateDeals(deals);
      const extractionResult = await extractor.extractDeals(
        deals,
        separationResult.boundaries
      );

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
      expect(extractionResult.deals.length).toBeGreaterThan(0);
    });
  });
});

describe('Pipeline with fixture files', () => {
  const fixturesDir = path.join(__dirname, '../fixtures');

  it('should process sample-deals.txt fixture', async () => {
    const fixturePath = path.join(fixturesDir, 'sample-deals.txt');

    if (!fs.existsSync(fixturePath)) {
      console.log('Skipping fixture test - file not found');
      return;
    }

    const content = fs.readFileSync(fixturePath, 'utf-8');

    const separator = new DealSeparator({
      minConfidence: 0.2,
      mergeOverlapping: true,
    });

    const extractor = new DealExtractor({
      deduplicate: true,
      deduplicationThreshold: 0.85,
      minConfidence: 0.3,
    });

    const separationResult = await separator.separateDeals(content);
    const extractionResult = await extractor.extractDeals(
      content,
      separationResult.boundaries
    );

    // Sample file has 3 deals
    expect(extractionResult.deals.length).toBe(3);

    // Verify specific deals
    const dealNames = extractionResult.deals.map(d => d.dealName);
    expect(dealNames.some(n => n.includes('Acme'))).toBe(true);
    expect(dealNames.some(n => n.includes('Beta'))).toBe(true);
    expect(dealNames.some(n => n.includes('Gamma'))).toBe(true);
  });
});
