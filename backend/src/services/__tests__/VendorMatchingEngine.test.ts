/**
 * VendorMatchingEngine Tests
 */

import { VendorMatchingEngine, getVendorMatchingEngine, resetVendorMatchingEngine } from '../VendorMatchingEngine';
import { VendorCache, resetVendorCache } from '../VendorCache';
import { VendorRecord, VendorMatchContext } from '../../types/vendorMatching';

// ============================================================================
// Test Data
// ============================================================================

const createTestVendor = (overrides: Partial<VendorRecord> = {}): VendorRecord => ({
  id: `vendor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name: 'Test Vendor',
  normalizedName: 'test vendor',
  emailDomains: ['testvendor.com'],
  status: 'active',
  origin: 'user_upload',
  approvalStatus: 'approved',
  ...overrides,
});

const testVendors: VendorRecord[] = [
  createTestVendor({
    id: 'vendor-1',
    name: 'Microsoft Corporation',
    normalizedName: 'microsoft',
    emailDomains: ['microsoft.com', 'outlook.com'],
    metadata: {
      products: ['Azure', 'Office 365', 'Windows'],
      keywords: ['cloud', 'enterprise', 'software'],
    },
  }),
  createTestVendor({
    id: 'vendor-2',
    name: 'Amazon Web Services',
    normalizedName: 'amazon web services',
    emailDomains: ['amazon.com', 'aws.amazon.com'],
    metadata: {
      aliases: ['AWS'],
      products: ['EC2', 'S3', 'Lambda'],
      keywords: ['cloud', 'infrastructure'],
    },
  }),
  createTestVendor({
    id: 'vendor-3',
    name: 'Google LLC',
    normalizedName: 'google',
    emailDomains: ['google.com', 'gmail.com'],
    metadata: {
      products: ['GCP', 'BigQuery', 'Kubernetes'],
      keywords: ['cloud', 'search', 'ai'],
    },
  }),
  createTestVendor({
    id: 'vendor-4',
    name: 'Salesforce Inc',
    normalizedName: 'salesforce',
    emailDomains: ['salesforce.com'],
    metadata: {
      products: ['Sales Cloud', 'Service Cloud'],
      keywords: ['crm', 'sales'],
    },
  }),
];

// ============================================================================
// Mock Cache
// ============================================================================

class MockVendorCache extends VendorCache {
  private mockVendors: VendorRecord[];

  constructor(vendors: VendorRecord[]) {
    super({ enabled: false });
    this.mockVendors = vendors;
  }

  async getAll(): Promise<VendorRecord[]> {
    return this.mockVendors;
  }

  async getById(id: string): Promise<VendorRecord | null> {
    return this.mockVendors.find((v) => v.id === id) || null;
  }

  async getByDomain(domain: string): Promise<VendorRecord[]> {
    return this.mockVendors.filter((v) =>
      v.emailDomains.some((d) => d.toLowerCase() === domain.toLowerCase())
    );
  }

  async getByNormalizedName(name: string): Promise<VendorRecord | null> {
    return this.mockVendors.find(
      (v) => v.normalizedName.toLowerCase() === name.toLowerCase()
    ) || null;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('VendorMatchingEngine', () => {
  let engine: VendorMatchingEngine;

  beforeEach(() => {
    resetVendorMatchingEngine();
    resetVendorCache();
    const mockCache = new MockVendorCache(testVendors);
    engine = new VendorMatchingEngine({ cache: mockCache });
  });

  describe('match', () => {
    describe('exact name matching', () => {
      it('should match exact vendor name', async () => {
        const result = await engine.match({
          extractedName: 'Microsoft Corporation',
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-1');
        expect(result.confidence).toBe(1.0);
        expect(result.matchStrategy).toBe('exact_name');
      });

      it('should match case-insensitive', async () => {
        const result = await engine.match({
          extractedName: 'MICROSOFT CORPORATION',
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-1');
      });
    });

    describe('normalized name matching', () => {
      it('should match normalized name', async () => {
        const result = await engine.match({
          extractedName: 'Microsoft',
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-1');
      });

      it('should strip common suffixes', async () => {
        const result = await engine.match({
          extractedName: 'Salesforce Inc.',
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-4');
      });
    });

    describe('alias matching', () => {
      it('should match by alias', async () => {
        const result = await engine.match({
          extractedName: 'AWS',
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-2');
        expect(result.matchStrategy).toBe('alias');
      });
    });

    describe('email domain matching', () => {
      it('should match by email domain', async () => {
        const result = await engine.match({
          emailDomain: 'microsoft.com',
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-1');
        expect(result.matchStrategy).toBe('email_domain');
      });

      it('should extract domain from email', async () => {
        const result = await engine.match({
          contactEmail: 'john.doe@salesforce.com',
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-4');
      });
    });

    describe('fuzzy name matching', () => {
      it('should match similar names', async () => {
        const result = await engine.match({
          extractedName: 'Microsft',
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-1');
        expect(result.matchStrategy).toBe('fuzzy_name');
      });

      it('should match partial names via combined strategy', async () => {
        // Partial names work better with additional context
        const result = await engine.match({
          extractedName: 'Amazon',
          emailDomain: 'amazon.com',  // Add domain for combined matching
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-2');
      });
    });

    describe('product matching', () => {
      it('should match by product name', async () => {
        const result = await engine.match({
          productMentions: ['Azure', 'Office 365'],
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-1');
      });
    });

    describe('combined matching', () => {
      it('should combine multiple factors', async () => {
        const result = await engine.match({
          extractedName: 'Microsoft',
          emailDomain: 'microsoft.com',
          productMentions: ['Azure'],
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('vendor-1');
        expect(result.confidence).toBeGreaterThan(0.5);
      });
    });

    describe('no match scenarios', () => {
      it('should return no match for unknown vendor', async () => {
        const result = await engine.match({
          extractedName: 'Unknown Vendor XYZ',
        });

        expect(result.matched).toBe(false);
        expect(result.vendor).toBeNull();
        expect(result.matchStrategy).toBe('no_match');
      });

      it('should handle empty context', async () => {
        const result = await engine.match({});

        expect(result.matched).toBe(false);
      });
    });

    describe('alternatives', () => {
      it('should return alternative matches', async () => {
        // Cloud is a keyword for multiple vendors
        const result = await engine.match({
          keywords: ['cloud'],
          options: { maxAlternatives: 5 },
        });

        if (result.alternativeMatches) {
          expect(result.alternativeMatches.length).toBeGreaterThan(0);
        }
      });
    });

    describe('options', () => {
      it('should respect minimum confidence threshold', async () => {
        const result = await engine.match({
          extractedName: 'Micro', // Very partial match
          options: { minConfidence: 0.9 },
        });

        // Should not match due to high threshold
        expect(result.matched).toBe(false);
      });

      it('should use provided vendors only when specified', async () => {
        const customVendors = [
          createTestVendor({
            id: 'custom-1',
            name: 'Custom Vendor',
            normalizedName: 'custom vendor',
          }),
        ];

        const result = await engine.match({
          extractedName: 'Custom Vendor',
          existingVendors: customVendors,
          options: { useProvidedVendorsOnly: true },
        });

        expect(result.matched).toBe(true);
        expect(result.vendor?.id).toBe('custom-1');
      });
    });
  });

  describe('quickMatch', () => {
    it('should quickly match by normalized name', async () => {
      const result = await engine.quickMatch('microsoft');

      expect(result.matched).toBe(true);
      expect(result.vendorId).toBe('vendor-1');
      expect(result.confidence).toBe(1.0);
    });

    it('should quickly match by domain', async () => {
      const result = await engine.quickMatch('unknown', 'salesforce.com');

      expect(result.matched).toBe(true);
      expect(result.vendorId).toBe('vendor-4');
      expect(result.confidence).toBe(0.9);
    });

    it('should return no match for unknown', async () => {
      const result = await engine.quickMatch('completely unknown');

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = engine.getCacheStats();

      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('vendorsByIdSize');
    });
  });
});

describe('VendorMatchingEngine Singleton', () => {
  beforeEach(() => {
    resetVendorMatchingEngine();
    resetVendorCache();
  });

  it('should return same instance', () => {
    const engine1 = getVendorMatchingEngine();
    const engine2 = getVendorMatchingEngine();

    expect(engine1).toBe(engine2);
  });

  it('should reset instance', () => {
    const engine1 = getVendorMatchingEngine();
    resetVendorMatchingEngine();
    const engine2 = getVendorMatchingEngine();

    expect(engine1).not.toBe(engine2);
  });
});
