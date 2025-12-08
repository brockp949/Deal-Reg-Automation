/**
 * Vendor Cache Service
 * Provides in-memory caching for vendor data with TTL support.
 * Reduces database queries during vendor matching operations.
 */

import { query } from '../db';
import logger from '../utils/logger';
import {
  VendorRecord,
  CachedVendor,
  VendorCacheEvent,
  DEFAULT_MATCHING_CONFIG,
} from '../types/vendorMatching';

// ============================================================================
// Cache Entry Interface
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// ============================================================================
// Vendor Cache Class
// ============================================================================

export class VendorCache {
  private vendorsByIdCache: Map<string, CacheEntry<VendorRecord>> = new Map();
  private allVendorsCache: CacheEntry<VendorRecord[]> | null = null;
  private domainToVendorCache: Map<string, CacheEntry<string[]>> = new Map();
  private normalizedNameIndex: Map<string, string> = new Map(); // normalizedName -> vendorId

  private readonly ttlMs: number;
  private readonly enabled: boolean;

  constructor(config?: { enabled?: boolean; ttlMs?: number }) {
    this.enabled = config?.enabled ?? DEFAULT_MATCHING_CONFIG.cache.enabled;
    this.ttlMs = config?.ttlMs ?? DEFAULT_MATCHING_CONFIG.cache.ttlMs;

    logger.info('VendorCache initialized', {
      enabled: this.enabled,
      ttlMs: this.ttlMs,
    });
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get all vendors from cache or database.
   */
  async getAll(): Promise<VendorRecord[]> {
    if (this.enabled && this.allVendorsCache && !this.isExpired(this.allVendorsCache)) {
      logger.debug('VendorCache: returning cached vendors', {
        count: this.allVendorsCache.data.length,
      });
      return this.allVendorsCache.data;
    }

    const vendors = await this.loadAllFromDatabase();
    this.cacheAll(vendors);
    return vendors;
  }

  /**
   * Get a vendor by ID from cache or database.
   */
  async getById(id: string): Promise<VendorRecord | null> {
    if (this.enabled) {
      const cached = this.vendorsByIdCache.get(id);
      if (cached && !this.isExpired(cached)) {
        return cached.data;
      }
    }

    const vendor = await this.loadByIdFromDatabase(id);
    if (vendor) {
      this.cacheVendor(vendor);
    }
    return vendor;
  }

  /**
   * Get vendors by domain from cache or database.
   */
  async getByDomain(domain: string): Promise<VendorRecord[]> {
    const normalizedDomain = domain.toLowerCase().trim();

    if (this.enabled) {
      const cached = this.domainToVendorCache.get(normalizedDomain);
      if (cached && !this.isExpired(cached)) {
        const vendors: VendorRecord[] = [];
        for (const id of cached.data) {
          const vendor = await this.getById(id);
          if (vendor) vendors.push(vendor);
        }
        return vendors;
      }
    }

    // Load from all vendors
    const allVendors = await this.getAll();
    const matchingVendors = allVendors.filter((v) =>
      v.emailDomains.some((d) => d.toLowerCase() === normalizedDomain)
    );

    // Cache domain mapping
    if (this.enabled && matchingVendors.length > 0) {
      this.domainToVendorCache.set(normalizedDomain, {
        data: matchingVendors.map((v) => v.id),
        timestamp: Date.now(),
        expiresAt: Date.now() + this.ttlMs,
      });
    }

    return matchingVendors;
  }

  /**
   * Get vendor by normalized name.
   */
  async getByNormalizedName(normalizedName: string): Promise<VendorRecord | null> {
    // First check the index
    const cachedId = this.normalizedNameIndex.get(normalizedName.toLowerCase());
    if (cachedId) {
      return this.getById(cachedId);
    }

    // Search through all vendors
    const allVendors = await this.getAll();
    const vendor = allVendors.find(
      (v) => v.normalizedName.toLowerCase() === normalizedName.toLowerCase()
    );

    return vendor || null;
  }

  /**
   * Warm up the cache by loading all vendors.
   */
  async warmup(): Promise<void> {
    logger.info('VendorCache: warming up...');
    await this.getAll();
    logger.info('VendorCache: warmup complete');
  }

  /**
   * Invalidate specific vendor from cache.
   */
  invalidateVendor(vendorId: string): void {
    this.vendorsByIdCache.delete(vendorId);
    // Also invalidate all vendors cache since it may be stale
    this.allVendorsCache = null;
    // Clear domain cache as well
    this.domainToVendorCache.clear();
    // Rebuild name index
    this.normalizedNameIndex.clear();

    logger.debug('VendorCache: invalidated vendor', { vendorId });
  }

  /**
   * Invalidate all cache data.
   */
  invalidateAll(): void {
    this.vendorsByIdCache.clear();
    this.allVendorsCache = null;
    this.domainToVendorCache.clear();
    this.normalizedNameIndex.clear();

    logger.info('VendorCache: invalidated all');
  }

  /**
   * Handle cache events (for integration with vendor CRUD operations).
   */
  handleEvent(event: VendorCacheEvent): void {
    switch (event.type) {
      case 'vendor_created':
      case 'vendor_updated':
      case 'vendor_deleted':
        this.invalidateVendor(event.vendorId);
        break;
      case 'bulk_update':
      case 'manual_invalidate':
        this.invalidateAll();
        break;
    }
  }

  /**
   * Get cache statistics for monitoring.
   */
  getStats(): {
    enabled: boolean;
    vendorsByIdSize: number;
    allVendorsCached: boolean;
    domainCacheSize: number;
    nameIndexSize: number;
  } {
    return {
      enabled: this.enabled,
      vendorsByIdSize: this.vendorsByIdCache.size,
      allVendorsCached: this.allVendorsCache !== null && !this.isExpired(this.allVendorsCache),
      domainCacheSize: this.domainToVendorCache.size,
      nameIndexSize: this.normalizedNameIndex.size,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private isExpired<T>(entry: CacheEntry<T>): boolean {
    return Date.now() > entry.expiresAt;
  }

  private cacheAll(vendors: VendorRecord[]): void {
    if (!this.enabled) return;

    const now = Date.now();
    this.allVendorsCache = {
      data: vendors,
      timestamp: now,
      expiresAt: now + this.ttlMs,
    };

    // Also cache individual vendors and build index
    for (const vendor of vendors) {
      this.cacheVendor(vendor);
    }

    logger.debug('VendorCache: cached all vendors', { count: vendors.length });
  }

  private cacheVendor(vendor: VendorRecord): void {
    if (!this.enabled) return;

    const now = Date.now();
    this.vendorsByIdCache.set(vendor.id, {
      data: vendor,
      timestamp: now,
      expiresAt: now + this.ttlMs,
    });

    // Update name index
    this.normalizedNameIndex.set(vendor.normalizedName.toLowerCase(), vendor.id);
  }

  private async loadAllFromDatabase(): Promise<VendorRecord[]> {
    logger.debug('VendorCache: loading all vendors from database');

    const result = await query(
      `SELECT
        id, name, normalized_name, email_domains, industry, website,
        status, origin, approval_status, metadata, created_at, updated_at
       FROM vendors
       WHERE status = 'active' OR status IS NULL`
    );

    return result.rows.map((row) => this.rowToVendorRecord(row));
  }

  private async loadByIdFromDatabase(id: string): Promise<VendorRecord | null> {
    const result = await query(
      `SELECT
        id, name, normalized_name, email_domains, industry, website,
        status, origin, approval_status, metadata, created_at, updated_at
       FROM vendors
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToVendorRecord(result.rows[0]);
  }

  private rowToVendorRecord(row: Record<string, unknown>): VendorRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      normalizedName: row.normalized_name as string,
      emailDomains: (row.email_domains as string[]) || [],
      industry: row.industry as string | undefined,
      website: row.website as string | undefined,
      status: (row.status as string) || 'active',
      origin: (row.origin as VendorRecord['origin']) || 'user_upload',
      approvalStatus: (row.approval_status as VendorRecord['approvalStatus']) || 'approved',
      metadata: row.metadata as Record<string, unknown> | undefined,
      createdAt: row.created_at as Date | undefined,
      updatedAt: row.updated_at as Date | undefined,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultCache: VendorCache | null = null;

/**
 * Get the default vendor cache instance.
 */
export function getVendorCache(): VendorCache {
  if (!defaultCache) {
    defaultCache = new VendorCache();
  }
  return defaultCache;
}

/**
 * Set the default vendor cache instance (for testing).
 */
export function setVendorCache(cache: VendorCache): void {
  defaultCache = cache;
}

/**
 * Reset the default vendor cache (for testing).
 */
export function resetVendorCache(): void {
  defaultCache = null;
}

export default VendorCache;
