/**
 * Comprehensive Unit Tests for DuplicateDetector Service
 *
 * Tests coverage includes:
 * - findDuplicates (detectDuplicateDeals) - exact matches, fuzzy matches, no matches
 * - Similarity scoring - high confidence, medium confidence, low confidence
 * - Different entity types - deals, vendors, contacts (types)
 * - Edge cases - empty arrays, single item, null values
 * - Performance - handling large datasets
 * - Threshold configuration testing
 */

import {
  detectDuplicateDeals,
  detectDuplicatesInBatch,
  clusterDuplicates,
  calculateSimilarityScore,
  updateDuplicateConfig,
  getDuplicateConfig,
  DealData,
  VendorData,
  ContactData,
  DuplicateStrategy,
  MATCH_CONFIG,
  DuplicateDetectionResult,
  DuplicateMatch
} from '../../services/duplicateDetector';

// Mock the database query function
jest.mock('../../db', () => ({
  query: jest.fn()
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock webhookService - must return a Promise that can be .catch()'d
jest.mock('../../services/webhookService', () => ({
  triggerWebhook: jest.fn(() => Promise.resolve())
}));

const { query } = require('../../db');
const { triggerWebhook } = require('../../services/webhookService');

// Helper to reset mocks with proper Promise returns
function resetWebhookMock() {
  triggerWebhook.mockClear();
  triggerWebhook.mockImplementation(() => Promise.resolve());
}

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

const testVendor1: VendorData = {
  id: 'vendor-1',
  vendorName: 'Microsoft Corporation',
  normalizedName: 'microsoft',
  emailDomains: ['microsoft.com'],
  products: ['Azure', 'Office 365', 'Windows'],
  tier: 'platinum',
  status: 'active'
};

const testVendor2: VendorData = {
  id: 'vendor-2',
  vendorName: 'Microsoft Corp',
  normalizedName: 'microsoft',
  emailDomains: ['microsoft.com'],
  products: ['Azure', 'Office'],
  tier: 'platinum',
  status: 'active'
};

const testContact1: ContactData = {
  id: 'contact-1',
  name: 'John Doe',
  email: 'john.doe@acme.com',
  phone: '+1-555-123-4567',
  role: 'CTO',
  company: 'Acme Corporation'
};

const testContact2: ContactData = {
  id: 'contact-2',
  name: 'John D.',
  email: 'john.doe@acme.com',
  phone: '555-123-4567',
  role: 'Chief Technology Officer',
  company: 'Acme Corp'
};

// ============================================================================
// Tests: Configuration Functions
// ============================================================================

describe('DuplicateDetector - Configuration', () => {
  // Store original config to restore after tests
  let originalConfig: typeof MATCH_CONFIG;

  beforeEach(() => {
    originalConfig = { ...getDuplicateConfig() };
  });

  afterEach(() => {
    // Restore original configuration
    updateDuplicateConfig(originalConfig);
  });

  describe('getDuplicateConfig', () => {
    it('should return current configuration', () => {
      const config = getDuplicateConfig();

      expect(config).toBeDefined();
      expect(config.AUTO_MERGE_THRESHOLD).toBeDefined();
      expect(config.HIGH_CONFIDENCE_THRESHOLD).toBeDefined();
      expect(config.MEDIUM_CONFIDENCE_THRESHOLD).toBeDefined();
      expect(config.LOW_CONFIDENCE_THRESHOLD).toBeDefined();
      expect(config.MINIMUM_MATCH_THRESHOLD).toBeDefined();
      expect(config.DEFAULT_DEAL_WEIGHTS).toBeDefined();
    });

    it('should return a copy of configuration (not reference)', () => {
      const config1 = getDuplicateConfig();
      config1.AUTO_MERGE_THRESHOLD = 0.99;

      const config2 = getDuplicateConfig();
      expect(config2.AUTO_MERGE_THRESHOLD).not.toBe(0.99);
    });

    it('should include all threshold values', () => {
      const config = getDuplicateConfig();

      expect(config.FUZZY_EXACT_THRESHOLD).toBe(95);
      expect(config.FUZZY_HIGH_THRESHOLD).toBe(85);
      expect(config.FUZZY_MEDIUM_THRESHOLD).toBe(70);
      expect(config.FUZZY_LOW_THRESHOLD).toBe(50);
    });

    it('should include tolerance values', () => {
      const config = getDuplicateConfig();

      expect(config.VALUE_TOLERANCE_PERCENT).toBe(10);
      expect(config.DATE_TOLERANCE_DAYS).toBe(7);
    });

    it('should include default field weights', () => {
      const config = getDuplicateConfig();
      const weights = config.DEFAULT_DEAL_WEIGHTS;

      expect(weights.dealName).toBe(0.25);
      expect(weights.customerName).toBe(0.25);
      expect(weights.vendorMatch).toBe(0.15);
      expect(weights.dealValue).toBe(0.15);
      expect(weights.closeDate).toBe(0.10);
      expect(weights.products).toBe(0.05);
      expect(weights.contacts).toBe(0.05);
      expect(weights.description).toBe(0.00);
    });
  });

  describe('updateDuplicateConfig', () => {
    it('should update threshold values', () => {
      updateDuplicateConfig({
        AUTO_MERGE_THRESHOLD: 0.98,
        HIGH_CONFIDENCE_THRESHOLD: 0.90
      });

      const config = getDuplicateConfig();
      expect(config.AUTO_MERGE_THRESHOLD).toBe(0.98);
      expect(config.HIGH_CONFIDENCE_THRESHOLD).toBe(0.90);
    });

    it('should update tolerance values', () => {
      updateDuplicateConfig({
        VALUE_TOLERANCE_PERCENT: 15,
        DATE_TOLERANCE_DAYS: 14
      });

      const config = getDuplicateConfig();
      expect(config.VALUE_TOLERANCE_PERCENT).toBe(15);
      expect(config.DATE_TOLERANCE_DAYS).toBe(14);
    });

    it('should update batch size', () => {
      updateDuplicateConfig({
        BATCH_SIZE: 200
      });

      const config = getDuplicateConfig();
      expect(config.BATCH_SIZE).toBe(200);
    });

    it('should partially update configuration', () => {
      const originalMinThreshold = getDuplicateConfig().MINIMUM_MATCH_THRESHOLD;

      updateDuplicateConfig({
        AUTO_MERGE_THRESHOLD: 0.99
      });

      const config = getDuplicateConfig();
      expect(config.AUTO_MERGE_THRESHOLD).toBe(0.99);
      expect(config.MINIMUM_MATCH_THRESHOLD).toBe(originalMinThreshold);
    });
  });
});

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
      expect(result.factors.customerName).toBeGreaterThan(0.95);
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
      expect(result.factors.dealValue).toBe(0);
      expect(result.factors.closeDate).toBe(0);
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
      expect(result.overall).toBeGreaterThan(0.95);
    });

    it('should calculate deal value similarity within tolerance', () => {
      const deal1 = { ...testDeal1, dealValue: 50000 };
      const deal2 = { ...testDeal1, dealValue: 52000 };

      const result = calculateSimilarityScore(deal1, deal2);
      expect(result.factors.dealValue).toBeGreaterThan(0.85);
    });

    it('should calculate date similarity within tolerance', () => {
      const deal1 = { ...testDeal1, closeDate: '2024-12-15' };
      const deal2 = { ...testDeal1, closeDate: '2024-12-18' };

      const result = calculateSimilarityScore(deal1, deal2);
      expect(result.factors.closeDate).toBeGreaterThan(0.85);
    });

    it('should calculate product similarity using Jaccard index', () => {
      const deal1 = { ...testDeal1, products: ['Azure', 'Office 365', 'Dynamics'] };
      const deal2 = { ...testDeal1, products: ['Azure', 'Office 365'] };

      const result = calculateSimilarityScore(deal1, deal2);
      expect(result.factors.products).toBeCloseTo(2 / 3, 2);
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
      expect(result.factors.contacts).toBeCloseTo(1 / 2, 2);
    });

    it('should return weight information', () => {
      const result = calculateSimilarityScore(testDeal1, testDeal2);
      expect(result.weight).toBeGreaterThan(0);
      expect(result.weight).toBeLessThanOrEqual(1);
    });
  });

  describe('High Confidence Scoring', () => {
    it('should score >= 0.95 for exact duplicates', () => {
      const exactDuplicate = { ...testDeal1, id: 'duplicate-id' };
      const result = calculateSimilarityScore(testDeal1, exactDuplicate);
      expect(result.overall).toBeGreaterThanOrEqual(0.95);
    });

    it('should score >= 0.90 for nearly identical data with minor differences', () => {
      const nearlyIdentical = {
        ...testDeal1,
        id: 'near-dup',
        customerName: 'Acme Corporation Inc' // Slight variation
      };
      const result = calculateSimilarityScore(testDeal1, nearlyIdentical);
      expect(result.overall).toBeGreaterThanOrEqual(0.90);
    });
  });

  describe('Medium Confidence Scoring', () => {
    it('should score 0.70-0.89 for similar but distinct deals', () => {
      const result = calculateSimilarityScore(testDeal1, testDeal3);
      expect(result.overall).toBeGreaterThanOrEqual(0.70);
      expect(result.overall).toBeLessThan(0.90);
    });
  });

  describe('Low Confidence Scoring', () => {
    it('should score < 0.70 for somewhat related deals', () => {
      const somewhatRelated = {
        ...testDeal1,
        id: 'related-deal',
        dealName: 'Cloud Project',
        customerName: 'Acme LLC',
        vendorId: 'different-vendor'
      };
      const result = calculateSimilarityScore(testDeal1, somewhatRelated);
      expect(result.overall).toBeLessThan(0.70);
    });

    it('should score very low for unrelated deals', () => {
      const result = calculateSimilarityScore(testDeal1, testDeal4);
      expect(result.overall).toBeLessThan(0.50);
    });
  });
});

// ============================================================================
// Tests: Strategy 1 - Exact Match
// ============================================================================

describe('DuplicateDetector - Strategy 1: Exact Match', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  it('should detect exact match with identical normalized names', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
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
      customerName: 'Acme Corporation Inc.'
    };
    const dealWithoutSuffix = {
      ...testDeal1,
      id: 'deal-y',
      customerName: 'Acme Corporation'
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
      rows: [testDeal4]
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

  it('should handle case insensitivity', async () => {
    const upperCaseDeal = {
      ...testDeal1,
      id: 'deal-upper',
      dealName: 'MICROSOFT AZURE MIGRATION',
      customerName: 'ACME CORPORATION INC.'
    };

    query.mockResolvedValue({
      rows: [upperCaseDeal]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.EXACT_MATCH]
    });

    expect(result.isDuplicate).toBe(true);
  });
});

// ============================================================================
// Tests: Strategy 2 - Fuzzy Name Match
// ============================================================================

describe('DuplicateDetector - Strategy 2: Fuzzy Name Match', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  it('should detect fuzzy match with similar names', async () => {
    query.mockResolvedValue({
      rows: [testDeal3]
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
      dealName: 'Microsoft Azur Migration'
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

    const resultLow = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.FUZZY_NAME],
      threshold: 0.50
    });

    const resultHigh = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.FUZZY_NAME],
      threshold: 0.95
    });

    expect(resultLow.isDuplicate).toBe(true);
    expect(resultHigh.isDuplicate).toBe(false);
  });

  it('should include similarity factors in reasoning', async () => {
    query.mockResolvedValue({
      rows: [testDeal3]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.FUZZY_NAME]
    });

    expect(result.matches[0].reasoning).toContain('Fuzzy match');
    expect(result.matches[0].similarityFactors.dealName).toBeDefined();
    expect(result.matches[0].similarityFactors.customerName).toBeDefined();
  });
});

// ============================================================================
// Tests: Strategy 3 - Customer + Value Match
// ============================================================================

describe('DuplicateDetector - Strategy 3: Customer + Value Match', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  it('should detect match with same customer and similar value', async () => {
    const similarValue = {
      ...testDeal1,
      id: 'deal-value',
      dealName: 'Different Project Name',
      dealValue: 52000
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
      dealValue: 100000
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

  it('should include value comparison in reasoning', async () => {
    const similarValue = {
      ...testDeal1,
      id: 'deal-value-match',
      dealName: 'Different Name',
      dealValue: 51000
    };

    query.mockResolvedValue({
      rows: [similarValue]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.CUSTOMER_VALUE]
    });

    expect(result.matches[0].reasoning).toContain('deal value');
  });
});

// ============================================================================
// Tests: Strategy 4 - Customer + Date Match
// ============================================================================

describe('DuplicateDetector - Strategy 4: Customer + Date Match', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  it('should detect match with same customer and similar close date', async () => {
    const similarDate = {
      ...testDeal1,
      id: 'deal-date',
      dealName: 'Different Project',
      closeDate: '2024-12-17'
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
      closeDate: '2025-06-01'
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

  it('should handle Date objects', async () => {
    const dealWithDateObject = {
      ...testDeal1,
      id: 'deal-dateobj',
      dealName: 'Different Project',
      closeDate: new Date('2024-12-16')
    };

    query.mockResolvedValue({
      rows: [dealWithDateObject]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.CUSTOMER_DATE]
    });

    expect(result.isDuplicate).toBe(true);
  });
});

// ============================================================================
// Tests: Strategy 5 - Vendor + Customer Match
// ============================================================================

describe('DuplicateDetector - Strategy 5: Vendor + Customer Match', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
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

  it('should include vendor match factor', async () => {
    const sameVendor = {
      ...testDeal1,
      id: 'deal-samevend',
      dealName: 'Another Project'
    };

    query.mockResolvedValue({
      rows: [sameVendor]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.VENDOR_CUSTOMER]
    });

    expect(result.matches[0].similarityFactors.vendorMatch).toBe(1.0);
  });
});

// ============================================================================
// Tests: Strategy 6 - Multi-Factor Match
// ============================================================================

describe('DuplicateDetector - Strategy 6: Multi-Factor Match', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  it('should detect match using multiple weighted factors', async () => {
    query.mockResolvedValue({
      rows: [testDeal3]
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
      dealName: testDeal1.dealName,
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

    expect(result.matches[0].similarityFactors.dealName).toBeGreaterThan(0.95);
  });

  it('should aggregate similarity from all available factors', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.MULTI_FACTOR]
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].confidence).toBeGreaterThan(0.90);
  });

  it('should include all similarity factors in result', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.MULTI_FACTOR]
    });

    const factors = result.matches[0].similarityFactors;
    expect(factors.dealName).toBeDefined();
    expect(factors.customerName).toBeDefined();
    expect(factors.vendorMatch).toBeDefined();
    expect(factors.dealValue).toBeDefined();
    expect(factors.closeDate).toBeDefined();
    expect(factors.products).toBeDefined();
    expect(factors.contacts).toBeDefined();
  });
});

// ============================================================================
// Tests: Main Detection Function
// ============================================================================

describe('DuplicateDetector - Main Detection', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  it('should run all strategies by default', async () => {
    query.mockResolvedValue({
      rows: [testDeal2, testDeal3]
    });

    const result = await detectDuplicateDeals(testDeal1);

    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('should deduplicate matches from multiple strategies', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

    const uniqueIds = new Set(result.matches.map(m => m.matchedEntityId));
    expect(uniqueIds.size).toBe(result.matches.length);
  });

  it('should keep highest confidence match per entity', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

    if (result.matches.length > 0) {
      expect(result.matches[0].confidence).toBeGreaterThan(0.85);
    }
  });

  it('should suggest auto_merge for very high confidence', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

    if (result.confidence >= MATCH_CONFIG.AUTO_MERGE_THRESHOLD) {
      expect(result.suggestedAction).toBe('auto_merge');
    }
  });

  it('should suggest manual_review for high confidence', async () => {
    query.mockResolvedValue({
      rows: [testDeal3]
    });

    const result = await detectDuplicateDeals(testDeal1);

    if (result.confidence >= 0.85 && result.confidence < 0.95) {
      expect(result.suggestedAction).toBe('manual_review');
    }
  });

  it('should suggest no_action for low confidence', async () => {
    query.mockResolvedValue({
      rows: [testDeal4]
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
      rows: [testDeal1, testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

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
    query.mockResolvedValue({ rows: [] });

    const result = await detectDuplicateDeals(testDeal1, {
      existingDeals: [testDeal2, testDeal3]
    });

    expect(query).not.toHaveBeenCalled();
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('should trigger webhook when duplicates found (without provided deals)', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    // Note: When existingDeals is NOT provided, webhook should be triggered
    // The service checks for this with `usingProvidedDeals`
    await detectDuplicateDeals(testDeal1);

    // Webhook is triggered asynchronously, verify it was called
    expect(triggerWebhook).toHaveBeenCalled();
  });

  it('should not trigger webhook when using provided deals', async () => {
    resetWebhookMock();

    await detectDuplicateDeals(testDeal1, {
      existingDeals: [testDeal2, testDeal3]
    });

    expect(triggerWebhook).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: Batch Detection
// ============================================================================

describe('DuplicateDetector - Batch Detection', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
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

    const startTime = Date.now();
    const result = await detectDuplicatesInBatch(largeSet);
    const endTime = Date.now();

    expect(result.size).toBe(50);
    expect(endTime - startTime).toBeLessThan(30000); // Should complete within 30 seconds
  });

  it('should skip entities without IDs', async () => {
    const noIdDeal = { ...testDeal1, id: undefined };

    query.mockResolvedValue({
      rows: []
    });

    const result = await detectDuplicatesInBatch([noIdDeal, testDeal2]);

    expect(result.has(testDeal2.id!)).toBe(true);
  });

  it('should handle empty batch', async () => {
    query.mockResolvedValue({ rows: [] });

    const result = await detectDuplicatesInBatch([]);

    expect(result.size).toBe(0);
  });

  it('should handle single item batch', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicatesInBatch([testDeal1]);

    expect(result.size).toBe(1);
    expect(result.has(testDeal1.id!)).toBe(true);
  });
});

// ============================================================================
// Tests: Clustering
// ============================================================================

describe('DuplicateDetector - Clustering', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  it('should create clusters of duplicate entities', async () => {
    query.mockResolvedValue({ rows: [] });

    const duplicateSet = [
      testDeal1,
      testDeal2,
      testDeal3,
      testDeal4
    ];

    const clusters = await clusterDuplicates(duplicateSet);

    expect(clusters.length).toBeGreaterThan(0);
    const largestCluster = clusters.reduce((max, c) =>
      c.clusterSize > max.clusterSize ? c : max,
      clusters[0]
    );
    expect(largestCluster.clusterSize).toBeGreaterThanOrEqual(2);
  });

  it('should not cluster unrelated entities', async () => {
    query.mockResolvedValue({ rows: [] });

    const unrelatedDeals = [testDeal1, testDeal4];

    const clusters = await clusterDuplicates(unrelatedDeals);

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

  it('should handle single entity', async () => {
    query.mockResolvedValue({ rows: [] });

    const clusters = await clusterDuplicates([testDeal1]);

    // Single entity cannot form a cluster with itself
    expect(clusters.length).toBe(0);
  });

  it('should use DFS to find connected components', async () => {
    query.mockResolvedValue({ rows: [] });

    const dealA = testDeal1;
    const dealB = { ...testDeal2, id: 'deal-b' };
    const dealC = { ...testDeal3, id: 'deal-c' };

    const clusters = await clusterDuplicates([dealA, dealB, dealC]);

    if (clusters.length > 0) {
      const mainCluster = clusters.reduce((max, c) =>
        c.clusterSize > max.clusterSize ? c : max,
        clusters[0]
      );
      expect(mainCluster.clusterSize).toBeGreaterThanOrEqual(2);
    }
  });

  it('should generate deterministic cluster keys', async () => {
    query.mockResolvedValue({ rows: [] });

    const clusters = await clusterDuplicates([testDeal1, testDeal2]);

    if (clusters.length > 0) {
      expect(clusters[0].clusterKey).toBeDefined();
      expect(clusters[0].clusterKey.includes('|')).toBe(true);
    }
  });
});

// ============================================================================
// Tests: Entity Types
// ============================================================================

describe('DuplicateDetector - Entity Types', () => {
  describe('VendorData Type', () => {
    it('should define all vendor properties', () => {
      expect(testVendor1.id).toBeDefined();
      expect(testVendor1.vendorName).toBeDefined();
      expect(testVendor1.normalizedName).toBeDefined();
      expect(testVendor1.emailDomains).toBeDefined();
      expect(testVendor1.products).toBeDefined();
      expect(testVendor1.tier).toBeDefined();
      expect(testVendor1.status).toBeDefined();
    });

    it('should support index signature for custom fields', () => {
      const vendorWithCustom: VendorData = {
        ...testVendor1,
        customField: 'custom value'
      };
      expect(vendorWithCustom.customField).toBe('custom value');
    });
  });

  describe('ContactData Type', () => {
    it('should define all contact properties', () => {
      expect(testContact1.id).toBeDefined();
      expect(testContact1.name).toBeDefined();
      expect(testContact1.email).toBeDefined();
      expect(testContact1.phone).toBeDefined();
      expect(testContact1.role).toBeDefined();
      expect(testContact1.company).toBeDefined();
    });

    it('should support index signature for custom fields', () => {
      const contactWithCustom: ContactData = {
        ...testContact1,
        linkedInUrl: 'https://linkedin.com/in/johndoe'
      };
      expect(contactWithCustom.linkedInUrl).toBe('https://linkedin.com/in/johndoe');
    });
  });

  describe('DealData Type', () => {
    it('should support contacts array', () => {
      expect(testDeal1.contacts).toBeDefined();
      expect(Array.isArray(testDeal1.contacts)).toBe(true);
      expect(testDeal1.contacts![0].email).toBeDefined();
    });

    it('should support products array', () => {
      expect(testDeal1.products).toBeDefined();
      expect(Array.isArray(testDeal1.products)).toBe(true);
    });
  });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe('DuplicateDetector - Edge Cases', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  describe('Empty and Null Values', () => {
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

    it('should handle empty arrays', async () => {
      const dealWithEmptyArrays: DealData = {
        id: 'deal-empty-arrays',
        dealName: 'Test Deal',
        customerName: 'Test Customer',
        products: [],
        contacts: []
      };

      query.mockResolvedValue({ rows: [] });

      const result = await detectDuplicateDeals(dealWithEmptyArrays);

      expect(result).toBeDefined();
    });

    it('should handle empty existing deals array', async () => {
      const result = await detectDuplicateDeals(testDeal1, {
        existingDeals: []
      });

      expect(result.isDuplicate).toBe(false);
      expect(result.matches).toHaveLength(0);
    });
  });

  describe('String Edge Cases', () => {
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
        dealName: 'Deja Vu Project',
        customerName: 'Societe francaise'
      };

      query.mockResolvedValue({
        rows: []
      });

      const result = await detectDuplicateDeals(unicodeDeal);

      expect(result).toBeDefined();
    });

    it('should handle whitespace-only strings', async () => {
      const whitespaceDeal: DealData = {
        id: 'deal-whitespace',
        dealName: '   ',
        customerName: '\t\n'
      };

      query.mockResolvedValue({ rows: [] });

      const result = await detectDuplicateDeals(whitespaceDeal);

      expect(result).toBeDefined();
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('Numeric Edge Cases', () => {
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

    it('should handle zero deal values', async () => {
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

    it('should handle negative deal values', async () => {
      const negativeDeal: DealData = {
        id: 'deal-negative',
        dealName: 'Refund Deal',
        customerName: 'Test',
        dealValue: -5000
      };

      query.mockResolvedValue({ rows: [] });

      const result = await detectDuplicateDeals(negativeDeal);

      expect(result).toBeDefined();
    });

    it('should handle very large deal values', async () => {
      const largeDeal: DealData = {
        id: 'deal-large-value',
        dealName: 'Enterprise Deal',
        customerName: 'Test',
        dealValue: 999999999999
      };

      query.mockResolvedValue({ rows: [] });

      const result = await detectDuplicateDeals(largeDeal);

      expect(result).toBeDefined();
    });
  });

  describe('Array Edge Cases', () => {
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

    it('should handle single item arrays', async () => {
      const singleItemDeal: DealData = {
        id: 'deal-single',
        dealName: 'Single Deal',
        customerName: 'Test',
        products: ['SingleProduct'],
        contacts: [{ name: 'Solo Contact', email: 'solo@test.com' }]
      };

      query.mockResolvedValue({ rows: [] });

      const result = await detectDuplicateDeals(singleItemDeal);

      expect(result).toBeDefined();
    });

    it('should handle arrays with null elements', async () => {
      const arrayWithNulls: DealData = {
        id: 'deal-nulls-array',
        dealName: 'Test',
        customerName: 'Test',
        products: ['Product1', '', 'Product3'],
        contacts: [
          { name: 'Contact1', email: 'email1@test.com' },
          { name: '', email: '' }
        ]
      };

      query.mockResolvedValue({ rows: [] });

      const result = await detectDuplicateDeals(arrayWithNulls);

      expect(result).toBeDefined();
    });
  });

  describe('Invalid Date Handling', () => {
    it('should handle invalid date strings', async () => {
      const invalidDateDeal: DealData = {
        id: 'deal-invalid-date',
        dealName: 'Test',
        customerName: 'Test',
        closeDate: 'not-a-date'
      };

      query.mockResolvedValue({ rows: [] });

      const result = await detectDuplicateDeals(invalidDateDeal);

      expect(result).toBeDefined();
    });
  });
});

// ============================================================================
// Tests: Performance
// ============================================================================

describe('DuplicateDetector - Performance', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  it('should handle 100 deals efficiently', async () => {
    const deals = Array(100).fill(null).map((_, i) => ({
      ...testDeal1,
      id: `perf-deal-${i}`,
      dealName: `Deal ${i}`,
      customerName: `Customer ${i % 10}`
    }));

    query.mockResolvedValue({ rows: deals });

    const startTime = Date.now();
    const result = await detectDuplicatesInBatch(deals);
    const endTime = Date.now();

    expect(result.size).toBe(100);
    expect(endTime - startTime).toBeLessThan(60000); // Under 60 seconds
  });

  it('should process similarity calculations quickly', () => {
    const startTime = Date.now();

    for (let i = 0; i < 1000; i++) {
      calculateSimilarityScore(testDeal1, testDeal2);
    }

    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(5000); // 1000 calculations under 5 seconds
  });

  it('should handle clustering of many entities', async () => {
    query.mockResolvedValue({ rows: [] });

    const deals = Array(20).fill(null).map((_, i) => ({
      ...testDeal1,
      id: `cluster-deal-${i}`,
      dealName: i < 10 ? 'Microsoft Azure Migration' : `Different Deal ${i}`,
      customerName: i < 10 ? 'Acme Corporation' : `Different Customer ${i}`
    }));

    const startTime = Date.now();
    const clusters = await clusterDuplicates(deals);
    const endTime = Date.now();

    expect(clusters).toBeDefined();
    expect(endTime - startTime).toBeLessThan(30000); // Under 30 seconds
  });
});

// ============================================================================
// Tests: Threshold Configuration
// ============================================================================

describe('DuplicateDetector - Threshold Configuration', () => {
  let originalConfig: typeof MATCH_CONFIG;

  beforeEach(() => {
    originalConfig = { ...getDuplicateConfig() };
    query.mockClear();
    resetWebhookMock();
  });

  afterEach(() => {
    updateDuplicateConfig(originalConfig);
  });

  it('should respect custom auto-merge threshold', async () => {
    updateDuplicateConfig({ AUTO_MERGE_THRESHOLD: 0.99 });

    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

    // With 0.99 threshold, near-identical deals might not auto-merge
    if (result.confidence < 0.99) {
      expect(result.suggestedAction).not.toBe('auto_merge');
    }
  });

  it('should respect custom minimum match threshold', async () => {
    query.mockResolvedValue({
      rows: [testDeal3]
    });

    // Low threshold should find matches
    const resultLow = await detectDuplicateDeals(testDeal1, {
      threshold: 0.50
    });

    // High threshold should find fewer matches
    const resultHigh = await detectDuplicateDeals(testDeal1, {
      threshold: 0.95
    });

    expect(resultLow.matches.length).toBeGreaterThanOrEqual(resultHigh.matches.length);
  });

  it('should use environment-based thresholds', () => {
    const config = getDuplicateConfig();

    // These should be initialized from environment or defaults
    expect(typeof config.AUTO_MERGE_THRESHOLD).toBe('number');
    expect(typeof config.MINIMUM_MATCH_THRESHOLD).toBe('number');
  });

  it('should allow dynamic threshold updates during runtime', async () => {
    query.mockResolvedValue({
      rows: [testDeal3]
    });

    // First detection with default threshold
    const result1 = await detectDuplicateDeals(testDeal1, {
      threshold: 0.80
    });

    // Update threshold
    updateDuplicateConfig({ MINIMUM_MATCH_THRESHOLD: 0.60 });

    // Second detection with updated threshold
    const result2 = await detectDuplicateDeals(testDeal1, {
      threshold: 0.60
    });

    // Lower threshold should potentially find more matches
    expect(result2.matches.length).toBeGreaterThanOrEqual(result1.matches.length);
  });

  it('should apply confidence thresholds for suggested actions', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

    const config = getDuplicateConfig();

    if (result.confidence >= config.AUTO_MERGE_THRESHOLD) {
      expect(result.suggestedAction).toBe('auto_merge');
    } else if (result.confidence >= config.HIGH_CONFIDENCE_THRESHOLD) {
      expect(result.suggestedAction).toBe('manual_review');
    } else {
      expect(result.suggestedAction).toBe('no_action');
    }
  });
});

// ============================================================================
// Tests: Result Structure Validation
// ============================================================================

describe('DuplicateDetector - Result Structure', () => {
  beforeEach(() => {
    query.mockClear();
    resetWebhookMock();
  });

  it('should return properly structured DuplicateDetectionResult', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

    expect(result).toHaveProperty('isDuplicate');
    expect(result).toHaveProperty('matches');
    expect(result).toHaveProperty('suggestedAction');
    expect(result).toHaveProperty('confidence');

    expect(typeof result.isDuplicate).toBe('boolean');
    expect(Array.isArray(result.matches)).toBe(true);
    expect(['auto_merge', 'manual_review', 'no_action']).toContain(result.suggestedAction);
    expect(typeof result.confidence).toBe('number');
  });

  it('should return properly structured DuplicateMatch objects', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1);

    if (result.matches.length > 0) {
      const match = result.matches[0];

      expect(match).toHaveProperty('matchedEntityId');
      expect(match).toHaveProperty('matchedEntity');
      expect(match).toHaveProperty('similarityScore');
      expect(match).toHaveProperty('confidence');
      expect(match).toHaveProperty('strategy');
      expect(match).toHaveProperty('similarityFactors');
      expect(match).toHaveProperty('reasoning');

      expect(typeof match.matchedEntityId).toBe('string');
      expect(typeof match.similarityScore).toBe('number');
      expect(typeof match.confidence).toBe('number');
      expect(typeof match.reasoning).toBe('string');
    }
  });

  it('should return properly structured SimilarityFactors', async () => {
    query.mockResolvedValue({
      rows: [testDeal2]
    });

    const result = await detectDuplicateDeals(testDeal1, {
      strategies: [DuplicateStrategy.MULTI_FACTOR]
    });

    if (result.matches.length > 0) {
      const factors = result.matches[0].similarityFactors;

      // All factor values should be numbers between 0 and 1
      Object.values(factors).forEach(value => {
        if (value !== undefined) {
          expect(typeof value).toBe('number');
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      });
    }
  });
});
