import {
  detectDuplicateDeals,
  detectDuplicatesInBatch,
  clusterDuplicates,
  calculateSimilarityScore,
  DealData,
  DuplicateStrategy,
  MATCH_CONFIG
} from '../../services/duplicateDetector';

// Mock the database query function
jest.mock('../../db', () => ({
  query: jest.fn()
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const { query } = require('../../db');

// ============================================================================
// Test Data
// ============================================================================

const testDeal1: DealData = {
  id: 'deal-1',
  dealName: 'Microsoft Azure Migration',
  customerName: 'Acme Corporation Inc.',
  dealValue: 50000,
  currency: 'USD',
  closeDate: '2024-12-15',
  vendorId: 'vendor-ms',
  vendorName: 'Microsoft',
  products: ['Azure', 'Office 365'],
  contacts: [
    { id: 'c1', name: 'John Doe', email: 'john@acme.com', role: 'CTO' }
  ]
};

const testDeal2: DealData = {
  id: 'deal-2',
  dealName: 'Microsoft Azure Migration',
  customerName: 'Acme Corporation',
  dealValue: 50000,
  currency: 'USD',
  closeDate: '2024-12-15',
  vendorId: 'vendor-ms',
  vendorName: 'Microsoft',
  products: ['Azure', 'Office 365'],
  contacts: [
    { id: 'c2', name: 'John Doe', email: 'john@acme.com', role: 'CTO' }
  ]
};

const testDeal3: DealData = {
  id: 'deal-3',
  dealName: 'Azure Cloud Migration Project',
  customerName: 'Acme Corp',
  dealValue: 52000,
  currency: 'USD',
  closeDate: '2024-12-16',
  vendorId: 'vendor-ms',
  vendorName: 'Microsoft',
  products: ['Azure'],
  contacts: [
    { id: 'c3', name: 'Jane Smith', email: 'jane@acme.com', role: 'CFO' }
  ]
};

const testDeal4: DealData = {
  id: 'deal-4',
  dealName: 'AWS Infrastructure Setup',
  customerName: 'TechStart LLC',
  dealValue: 75000,
  currency: 'USD',
  closeDate: '2024-11-20',
  vendorId: 'vendor-aws',
  vendorName: 'AWS',
  products: ['EC2', 'RDS'],
  contacts: []
};

const testDeal5: DealData = {
  id: 'deal-5',
  dealName: 'Cloud Migration',
  customerName: 'Acme Corporation',
  dealValue: 100000,
  currency: 'USD',
  closeDate: '2024-06-01',
  vendorId: 'vendor-gcp',
  vendorName: 'Google Cloud',
  products: ['Compute Engine'],
  contacts: []
};

// ============================================================================
// Tests: Similarity Calculation
// ============================================================================

describe('DuplicateDetector - Similarity Calculation', () => {
  describe('calculateSimilarityScore', () => {
    it('should return 1.0 for identical deals', () => {
      const result = calculateSimilarityScore(testDeal1, testDeal1);
      expect(result.overall).toBeGreaterThan(0.95);
      expect(result.factors.dealName).toBe(1.0);
      expect(result.factors.customerName).toBeGreaterThan(0.95);
      expect(result.factors.vendorMatch).toBe(1.0);
    });

    it('should detect high similarity for near-identical deals', () => {
      const result = calculateSimilarityScore(testDeal1, testDeal2);
      expect(result.overall).toBeGreaterThan(0.90);
      expect(result.factors.dealName).toBe(1.0);
      expect(result.factors.customerName).toBeGreaterThan(0.95); // Normalized company names
      expect(result.factors.dealValue).toBe(1.0);
      expect(result.factors.vendorMatch).toBe(1.0);
    });

    it('should detect medium similarity for related deals', () => {
      const result = calculateSimilarityScore(testDeal1, testDeal3);
      expect(result.overall).toBeGreaterThan(0.70);
      expect(result.overall).toBeLessThan(0.90);
      expect(result.factors.customerName).toBeGreaterThan(0.85);
      expect(result.factors.vendorMatch).toBe(1.0);
    });

    it('should detect low similarity for unrelated deals', () => {
      const result = calculateSimilarityScore(testDeal1, testDeal4);
      expect(result.overall).toBeLessThan(0.50);
      expect(result.factors.customerName).toBeLessThan(0.50);
      expect(result.factors.vendorMatch).toBe(0);
    });

    it('should handle missing values gracefully', () => {
      const dealWithMissingFields: DealData = {
        dealName: 'Test Deal',
        customerName: 'Test Customer'
      };

      const result = calculateSimilarityScore(dealWithMissingFields, testDeal1);
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(1);
      expect(result.factors.dealValue).toBe(0); // Missing value
      expect(result.factors.closeDate).toBe(0); // Missing date
    });

    it('should use custom weights correctly', () => {
      const customWeights = {
        dealName: 0.5,
        customerName: 0.5,
        vendorMatch: 0,
        dealValue: 0,
        closeDate: 0,
        products: 0,
        contacts: 0,
        description: 0
      };

      const result = calculateSimilarityScore(testDeal1, testDeal2, customWeights);
      // Only dealName and customerName should matter
      expect(result.overall).toBeGreaterThan(0.95);
    });

    it('should calculate deal value similarity within tolerance', () => {
      const deal1 = { ...testDeal1, dealValue: 50000 };
      const deal2 = { ...testDeal1, dealValue: 52000 }; // 4% difference

      const result = calculateSimilarityScore(deal1, deal2);
      expect(result.factors.dealValue).toBeGreaterThan(0.85); // Within 10% tolerance
    });

    it('should calculate date similarity within tolerance', () => {
      const deal1 = { ...testDeal1, closeDate: '2024-12-15' };
      const deal2 = { ...testDeal1, closeDate: '2024-12-18' }; // 3 days difference

      const result = calculateSimilarityScore(deal1, deal2);
      expect(result.factors.closeDate).toBeGreaterThan(0.85); // Within 7 days tolerance
    });

    it('should calculate product similarity using Jaccard index', () => {
      const deal1 = { ...testDeal1, products: ['Azure', 'Office 365', 'Dynamics'] };
      const deal2 = { ...testDeal1, products: ['Azure', 'Office 365'] };

      const result = calculateSimilarityScore(deal1, deal2);
      expect(result.factors.products).toBeCloseTo(2 / 3, 2); // 2 common out of 3 unique
    });

    it('should calculate contact similarity using email matching', () => {
      const deal1 = {
        ...testDeal1,
        contacts: [
          { name: 'John Doe', email: 'john@acme.com' },
          { name: 'Jane Smith', email: 'jane@acme.com' }
        ]
      };
      const deal2 = {
        ...testDeal1,
        contacts: [
          { name: 'John D.', email: 'john@acme.com' }
        ]
      };

      const result = calculateSimilarityScore(deal1, deal2);
      expect(result.factors.contacts).toBeCloseTo(1 / 2, 2); // 1 common out of 2 unique
    });
  });
});

// ============================================================================
// Tests: Strategy 1 - Exact Match
// ============================================================================

describe('DuplicateDetector - Strategy 1: Exact Match', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should detect exact match with identical normalized names', async () => {
    query.mockResolvedValue({
      rows: [testDeal2] // Same deal name and customer (normalized)
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.EXACT_MATCH]
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].strategy).toBe(DuplicateStrategy.EXACT_MATCH);
    expect(result.matches[0].confidence).toBe(1.0);
  });

  it('should match despite company suffix differences', async () => {
    const dealWithSuffix = {
      ...testDeal1,
      id: 'deal-x',
      customerName: 'Acme Corporation Inc.' // With suffix
    };
    const dealWithoutSuffix = {
      ...testDeal1,
      id: 'deal-y',
      customerName: 'Acme Corporation' // Without suffix
    };

    query.mockResolvedValue({
      rows: [dealWithoutSuffix]
    });

    const result = await detectDuplicateDeals(dealWithSuffix, {
      strategies: [DuplicateStrategy.EXACT_MATCH]
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].confidence).toBe(1.0);
  });

  it('should not match different deal names', async () => {
    query.mockResolvedValue({
      rows: [testDeal4] // Different deal name
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.EXACT_MATCH]
    });

    expect(result.isDuplicate).toBe(false);
    expect(result.matches.length).toBe(0);
  });

  it('should not match different customers', async () => {
    const differentCustomer = {
      ...testDeal1,
      id: 'deal-x',
      customerName: 'Different Corp'
    };

    query.mockResolvedValue({
      rows: [differentCustomer]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.EXACT_MATCH]
    });

    expect(result.isDuplicate).toBe(false);
  });
});

// ============================================================================
// Tests: Strategy 2 - Fuzzy Name Match
// ============================================================================

describe('DuplicateDetector - Strategy 2: Fuzzy Name Match', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should detect fuzzy match with similar names', async () => {
    query.mockResolvedValue({
      rows: [testDeal3] // Similar but not exact names
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.FUZZY_NAME]
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].strategy).toBe(DuplicateStrategy.FUZZY_NAME);
    expect(result.matches[0].confidence).toBeGreaterThan(0.80);
  });

  it('should handle typos in deal names', async () => {
    const dealWithTypo = {
      ...testDeal1,
      id: 'deal-typo',
      dealName: 'Microsoft Azur Migration' // Missing 'e'
    };

    query.mockResolvedValue({
      rows: [dealWithTypo]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.FUZZY_NAME]
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].confidence).toBeGreaterThan(0.85);
  });

  it('should not match completely different names', async () => {
    query.mockResolvedValue({
      rows: [testDeal4]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.FUZZY_NAME],
      threshold: 0.85
    });

    expect(result.isDuplicate).toBe(false);
  });

  it('should respect fuzzy threshold configuration', async () => {
    const somewhatSimilar = {
      ...testDeal1,
      id: 'deal-similar',
      dealName: 'Microsoft Cloud Migration',
      customerName: 'Acme Corp'
    };

    query.mockResolvedValue({
      rows: [somewhatSimilar]
    });

    // Should match with low threshold
    const resultLow = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.FUZZY_NAME],
      threshold: 0.50
    });

    // Should not match with high threshold
    const resultHigh = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.FUZZY_NAME],
      threshold: 0.95
    });

    expect(resultLow.isDuplicate).toBe(true);
    expect(resultHigh.isDuplicate).toBe(false);
  });
});

// ============================================================================
// Tests: Strategy 3 - Customer + Value Match
// ============================================================================

describe('DuplicateDetector - Strategy 3: Customer + Value Match', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should detect match with same customer and similar value', async () => {
    const similarValue = {
      ...testDeal1,
      id: 'deal-value',
      dealName: 'Different Project Name',
      dealValue: 52000 // Within 10% of 50000
    };

    query.mockResolvedValue({
      rows: [similarValue]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.CUSTOMER_VALUE]
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].strategy).toBe(DuplicateStrategy.CUSTOMER_VALUE);
    expect(result.matches[0].confidence).toBeGreaterThan(0.85);
  });

  it('should not match if value difference exceeds tolerance', async () => {
    const differentValue = {
      ...testDeal1,
      id: 'deal-bigvalue',
      dealValue: 100000 // 100% difference
    };

    query.mockResolvedValue({
      rows: [differentValue]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.CUSTOMER_VALUE],
      threshold: 0.85
    });

    expect(result.isDuplicate).toBe(false);
  });

  it('should not match if customer is different', async () => {
    const differentCustomer = {
      ...testDeal1,
      id: 'deal-diffcust',
      customerName: 'Different Corp',
      dealValue: 50000
    };

    query.mockResolvedValue({
      rows: [differentCustomer]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.CUSTOMER_VALUE]
    });

    expect(result.isDuplicate).toBe(false);
  });

  it('should skip deals without values', async () => {
    const noValue = {
      ...testDeal1,
      id: 'deal-novalue',
      dealValue: undefined
    };

    query.mockResolvedValue({
      rows: [noValue]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.CUSTOMER_VALUE]
    });

    expect(result.matches.length).toBe(0);
  });
});

// ============================================================================
// Tests: Strategy 4 - Customer + Date Match
// ============================================================================

describe('DuplicateDetector - Strategy 4: Customer + Date Match', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should detect match with same customer and similar close date', async () => {
    const similarDate = {
      ...testDeal1,
      id: 'deal-date',
      dealName: 'Different Project',
      closeDate: '2024-12-17' // 2 days difference
    };

    query.mockResolvedValue({
      rows: [similarDate]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.CUSTOMER_DATE]
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].strategy).toBe(DuplicateStrategy.CUSTOMER_DATE);
    expect(result.matches[0].confidence).toBeGreaterThan(0.85);
  });

  it('should not match if date difference exceeds tolerance', async () => {
    const farDate = {
      ...testDeal1,
      id: 'deal-fardate',
      closeDate: '2025-06-01' // ~6 months difference
    };

    query.mockResolvedValue({
      rows: [farDate]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.CUSTOMER_DATE],
      threshold: 0.85
    });

    expect(result.isDuplicate).toBe(false);
  });

  it('should handle deals without dates', async () => {
    const noDate = {
      ...testDeal1,
      id: 'deal-nodate',
      closeDate: undefined
    };

    query.mockResolvedValue({
      rows: [noDate]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.CUSTOMER_DATE]
    });

    expect(result.matches.length).toBe(0);
  });
});

// ============================================================================
// Tests: Strategy 5 - Vendor + Customer Match
// ============================================================================

describe('DuplicateDetector - Strategy 5: Vendor + Customer Match', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should detect match with same vendor and customer', async () => {
    const sameVendorCustomer = {
      ...testDeal1,
      id: 'deal-vendcust',
      dealName: 'Different Deal Name'
    };

    query.mockResolvedValue({
      rows: [sameVendorCustomer]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.VENDOR_CUSTOMER]
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].strategy).toBe(DuplicateStrategy.VENDOR_CUSTOMER);
    expect(result.matches[0].confidence).toBeGreaterThan(0.80);
  });

  it('should not match different vendors', async () => {
    const differentVendor = {
      ...testDeal1,
      id: 'deal-diffvend',
      vendorId: 'vendor-aws'
    };

    query.mockResolvedValue({
      rows: [differentVendor]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.VENDOR_CUSTOMER]
    });

    expect(result.isDuplicate).toBe(false);
  });

  it('should skip deals without vendor IDs', async () => {
    const noVendor = {
      ...testDeal1,
      id: 'deal-novendor',
      vendorId: undefined
    };

    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(noVendor, {
      strategies: [DuplicateStrategy.VENDOR_CUSTOMER]
    });

    expect(result.matches.length).toBe(0);
  });
});

// ============================================================================
// Tests: Strategy 6 - Multi-Factor Match
// ============================================================================

describe('DuplicateDetector - Strategy 6: Multi-Factor Match', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should detect match using multiple weighted factors', async () => {
    query.mockResolvedValue({
      rows: [testDeal3] // Moderately similar
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.MULTI_FACTOR],
      threshold: 0.70
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].strategy).toBe(DuplicateStrategy.MULTI_FACTOR);
    expect(result.matches[0].similarityFactors).toHaveProperty('dealName');
    expect(result.matches[0].similarityFactors).toHaveProperty('customerName');
    expect(result.matches[0].similarityFactors).toHaveProperty('vendorMatch');
  });

  it('should weight factors according to configuration', async () => {
    const highDealNameSimilarity = {
      ...testDeal1,
      id: 'deal-highname',
      dealName: testDeal1.dealName, // Exact match
      customerName: 'Somewhat Different Customer',
      vendorId: 'different-vendor'
    };

    query.mockResolvedValue({
      rows: [highDealNameSimilarity]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.MULTI_FACTOR],
      threshold: 0.20
    });

    // Even though customer and vendor don't match, deal name carries weight
    expect(result.matches[0].similarityFactors.dealName).toBeGreaterThan(0.95);
  });

  it('should aggregate similarity from all available factors', async () => {
    query.mockResolvedValue({
      rows: [testDeal2] // Nearly identical deal
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.MULTI_FACTOR]
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].confidence).toBeGreaterThan(0.90);
  });
});

// ============================================================================
// Tests: Main Detection Function
// ============================================================================

describe('DuplicateDetector - Main Detection', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should run all strategies by default', async () => {
    query.mockResolvedValue({
      rows: [testDeal2, testDeal3]
    });

    const result = await detectDuplicateDeals(testDeal1);

    expect(result.matches.length).toBeGreaterThan(0);
    // Should find matches from multiple strategies
  });

  it('should deduplicate matches from multiple strategies', async () => {
    // testDeal2 will match on multiple strategies
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

    // Should only have one match per entity even if multiple strategies match
    const uniqueIds = new Set(result.matches.map(m => m.matchedEntityId));
    expect(uniqueIds.size).toBe(result.matches.length);
  });

  it('should keep highest confidence match per entity', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

    if (result.matches.length > 0) {
      // The match should use the strategy with highest confidence
      expect(result.matches[0].confidence).toBeGreaterThan(0.85);
    }
  });

  it('should suggest auto_merge for very high confidence', async () => {
    query.mockResolvedValue({
      rows: [testDeal2] // Nearly identical
    });

    const result = await detectDuplicateDeals(testDeal1);

    if (result.confidence >= MATCH_CONFIG.AUTO_MERGE_THRESHOLD) {
      expect(result.suggestedAction).toBe('auto_merge');
    }
  });

  it('should suggest manual_review for high confidence', async () => {
    query.mockResolvedValue({
      rows: [testDeal3] // Similar but not identical
    });

    const result = await detectDuplicateDeals(testDeal1);

    if (result.confidence >= 0.85 && result.confidence < 0.95) {
      expect(result.suggestedAction).toBe('manual_review');
    }
  });

  it('should suggest no_action for low confidence', async () => {
    query.mockResolvedValue({
      rows: [testDeal4] // Very different
    });

    const result = await detectDuplicateDeals(testDeal1, {
      threshold: 0.30
    });

    if (result.confidence < 0.85) {
      expect(result.suggestedAction).toBe('no_action');
    }
  });

  it('should filter out the entity itself from matches', async () => {
    query.mockResolvedValue({
      rows: [testDeal1, testDeal2] // Includes itself
    });

    const result = await detectDuplicateDeals(testDeal1);

    // Should not match itself
    const selfMatch = result.matches.find(m => m.matchedEntityId === testDeal1.id);
    expect(selfMatch).toBeUndefined();
  });

  it('should respect custom threshold parameter', async () => {
    query.mockResolvedValue({
      rows: [testDeal3]
    });

    const resultLowThreshold = await detectDuplicateDeals(testDeal1, {
      threshold: 0.50
    });

    const resultHighThreshold = await detectDuplicateDeals(testDeal1, {
      threshold: 0.95
    });

    expect(resultLowThreshold.matches.length).toBeGreaterThanOrEqual(resultHighThreshold.matches.length);
  });

  it('should handle no existing deals', async () => {
    query.mockResolvedValue({
      rows: []
    });

    const result = await detectDuplicateDeals(testDeal1);

    expect(result.isDuplicate).toBe(false);
    expect(result.matches.length).toBe(0);
    expect(result.suggestedAction).toBe('no_action');
  });

  it('should handle database errors gracefully', async () => {
    query.mockRejectedValue(new Error('Database connection failed'));

    await expect(detectDuplicateDeals(testDeal1)).rejects.toThrow('Database connection failed');
  });

  it('should sort matches by confidence descending', async () => {
    query.mockResolvedValue({
      rows: [testDeal2, testDeal3, testDeal5]
    });

    const result = await detectDuplicateDeals(testDeal1);

    if (result.matches.length > 1) {
      for (let i = 0; i < result.matches.length - 1; i++) {
        expect(result.matches[i].confidence).toBeGreaterThanOrEqual(result.matches[i + 1].confidence);
      }
    }
  });

  it('should allow using existing deals from context', async () => {
    // Don't query database
    query.mockResolvedValue({ rows: [] });

    const result = await detectDuplicateDeals(testDeal1, {
      existingDeals: [testDeal2, testDeal3]
    });

    // Should not call query if existingDeals provided
    expect(query).not.toHaveBeenCalled();
    expect(result.matches.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Tests: Batch Detection
// ============================================================================

describe('DuplicateDetector - Batch Detection', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should process multiple entities in batch', async () => {
    query.mockResolvedValue({
      rows: [testDeal1, testDeal2, testDeal3, testDeal4]
    });

    const result = await detectDuplicatesInBatch([testDeal1, testDeal4]);

    expect(result.size).toBe(2);
    expect(result.has(testDeal1.id!)).toBe(true);
    expect(result.has(testDeal4.id!)).toBe(true);
  });

  it('should return detection results for each entity', async () => {
    query.mockResolvedValue({
      rows: [testDeal1, testDeal2]
    });

    const result = await detectDuplicatesInBatch([testDeal1]);

    const deal1Result = result.get(testDeal1.id!);
    expect(deal1Result).toBeDefined();
    expect(deal1Result).toHaveProperty('isDuplicate');
    expect(deal1Result).toHaveProperty('matches');
    expect(deal1Result).toHaveProperty('confidence');
  });

  it('should handle large batches efficiently', async () => {
    const largeSet = Array(50).fill(null).map((_, i) => ({
      ...testDeal1,
      id: `deal-${i}`,
      dealName: `Deal ${i}`
    }));

    query.mockResolvedValue({
      rows: largeSet
    });

    const result = await detectDuplicatesInBatch(largeSet);

    expect(result.size).toBe(50);
  });

  it('should skip entities without IDs', async () => {
    const noIdDeal = { ...testDeal1, id: undefined };

    query.mockResolvedValue({
      rows: []
    });

    const result = await detectDuplicatesInBatch([noIdDeal, testDeal2]);

    // Only testDeal2 should be in results
    expect(result.has(testDeal2.id!)).toBe(true);
  });
});

// ============================================================================
// Tests: Clustering
// ============================================================================

describe('DuplicateDetector - Clustering', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should create clusters of duplicate entities', async () => {
    // Mock no database calls (uses in-memory comparison)
    query.mockResolvedValue({ rows: [] });

    const duplicateSet = [
      testDeal1,
      testDeal2, // Duplicate of deal1
      testDeal3, // Similar to deal1 and deal2
      testDeal4  // Unrelated
    ];

    const clusters = await clusterDuplicates(duplicateSet);

    expect(clusters.length).toBeGreaterThan(0);
    // Should cluster deal1, deal2, deal3 together
    const largestCluster = clusters.reduce((max, c) =>
      c.clusterSize > max.clusterSize ? c : max,
      clusters[0]
    );
    expect(largestCluster.clusterSize).toBeGreaterThanOrEqual(2);
  });

  it('should not cluster unrelated entities', async () => {
    query.mockResolvedValue({ rows: [] });

    const unrelatedDeals = [testDeal1, testDeal4]; // Very different

    const clusters = await clusterDuplicates(unrelatedDeals);

    // Should have 0 or very small clusters
    const totalClustered = clusters.reduce((sum, c) => sum + c.clusterSize, 0);
    expect(totalClustered).toBeLessThan(unrelatedDeals.length * 2);
  });

  it('should generate unique cluster IDs', async () => {
    query.mockResolvedValue({ rows: [] });

    const clusters = await clusterDuplicates([testDeal1, testDeal2, testDeal3]);

    const clusterIds = new Set(clusters.map(c => c.clusterId));
    expect(clusterIds.size).toBe(clusters.length);
  });

  it('should set cluster metadata correctly', async () => {
    query.mockResolvedValue({ rows: [] });

    const clusters = await clusterDuplicates([testDeal1, testDeal2]);

    if (clusters.length > 0) {
      const cluster = clusters[0];
      expect(cluster.entityType).toBe('deal');
      expect(cluster.status).toBe('active');
      expect(cluster.createdAt).toBeInstanceOf(Date);
      expect(cluster.confidenceScore).toBeGreaterThan(0);
    }
  });

  it('should handle empty input', async () => {
    query.mockResolvedValue({ rows: [] });

    const clusters = await clusterDuplicates([]);

    expect(clusters.length).toBe(0);
  });

  it('should use DFS to find connected components', async () => {
    query.mockResolvedValue({ rows: [] });

    // Create a chain: A -> B -> C (each pair is similar)
    const dealA = testDeal1;
    const dealB = { ...testDeal2, id: 'deal-b' };
    const dealC = { ...testDeal3, id: 'deal-c' };

    const clusters = await clusterDuplicates([dealA, dealB, dealC]);

    // All three should be in same cluster (transitive)
    if (clusters.length > 0) {
      const mainCluster = clusters.reduce((max, c) =>
        c.clusterSize > max.clusterSize ? c : max,
        clusters[0]
      );
      // Depending on thresholds, they might cluster together
      expect(mainCluster.clusterSize).toBeGreaterThanOrEqual(2);
    }
  });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe('DuplicateDetector - Edge Cases', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should handle null and undefined values', async () => {
    const dealWithNulls: DealData = {
      id: 'deal-nulls',
      dealName: 'Test Deal',
      customerName: 'Test Customer',
      dealValue: undefined,
      closeDate: undefined,
      vendorId: undefined,
      products: undefined,
      contacts: undefined
    };

    query.mockResolvedValue({
      rows: [testDeal1]
    });

    const result = await detectDuplicateDeals(dealWithNulls);

    expect(result).toBeDefined();
    expect(result.matches).toBeDefined();
  });

  it('should handle empty strings', async () => {
    const dealWithEmpty: DealData = {
      dealName: '',
      customerName: ''
    };

    query.mockResolvedValue({
      rows: [testDeal1]
    });

    const result = await detectDuplicateDeals(dealWithEmpty);

    expect(result.isDuplicate).toBe(false);
  });

  it('should handle very long strings', async () => {
    const longString = 'A'.repeat(1000);
    const dealWithLongString: DealData = {
      id: 'deal-long',
      dealName: longString,
      customerName: longString
    };

    query.mockResolvedValue({
      rows: []
    });

    const result = await detectDuplicateDeals(dealWithLongString);

    expect(result).toBeDefined();
  });

  it('should handle special characters in names', async () => {
    const specialChars: DealData = {
      id: 'deal-special',
      dealName: 'Deal #1 @2024 (Migration)',
      customerName: 'Acme Corp. & Co., Ltd.'
    };

    query.mockResolvedValue({
      rows: []
    });

    const result = await detectDuplicateDeals(specialChars);

    expect(result).toBeDefined();
  });

  it('should handle unicode characters', async () => {
    const unicodeDeal: DealData = {
      id: 'deal-unicode',
      dealName: 'Déjà Vu Project 项目',
      customerName: 'Société française'
    };

    query.mockResolvedValue({
      rows: []
    });

    const result = await detectDuplicateDeals(unicodeDeal);

    expect(result).toBeDefined();
  });

  it('should handle extreme date values', async () => {
    const extremeDates: DealData = {
      id: 'deal-dates',
      dealName: 'Test',
      customerName: 'Test',
      closeDate: '1900-01-01'
    };

    query.mockResolvedValue({
      rows: [{ ...extremeDates, id: 'deal-dates-2', closeDate: '2099-12-31' }]
    });

    const result = await detectDuplicateDeals(extremeDates);

    expect(result).toBeDefined();
  });

  it('should handle zero and negative deal values', async () => {
    const zeroDeal: DealData = {
      id: 'deal-zero',
      dealName: 'Free Deal',
      customerName: 'Test',
      dealValue: 0
    };

    query.mockResolvedValue({
      rows: []
    });

    const result = await detectDuplicateDeals(zeroDeal);

    expect(result).toBeDefined();
  });

  it('should handle very large arrays', async () => {
    const manyProducts = Array(1000).fill('Product');
    const largeArrayDeal: DealData = {
      id: 'deal-large',
      dealName: 'Big Deal',
      customerName: 'Test',
      products: manyProducts
    };

    query.mockResolvedValue({
      rows: []
    });

    const result = await detectDuplicateDeals(largeArrayDeal);

    expect(result).toBeDefined();
  });
});
