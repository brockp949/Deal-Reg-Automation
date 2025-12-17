/**
 * Intelligent Cache Service
 *
 * Two-tier caching system for Claude API responses and file processing results:
 * - Memory cache (LRU) for fast access within same process
 * - Redis cache for shared access across workers
 */

import crypto from 'crypto';
import Redis from 'ioredis';
import { config } from '../config';
import logger from '../utils/logger';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class IntelligentCacheService {
  private redis: Redis;
  private memoryCache: Map<string, CacheEntry<any>>;
  private maxMemoryCacheSize: number = 1000; // Max items in memory cache
  private defaultTTL: number = 3600; // Default 1 hour TTL in seconds

  constructor() {
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.memoryCache = new Map();

    // Set up Redis event listeners
    this.redis.on('connect', () => {
      logger.info('IntelligentCacheService connected to Redis');
    });

    this.redis.on('error', (error) => {
      logger.error('Redis connection error in IntelligentCacheService', { error: error.message });
    });

    // Cleanup old entries from memory cache periodically (every 5 minutes)
    setInterval(() => this.cleanupMemoryCache(), 5 * 60 * 1000);

    logger.info('IntelligentCacheService initialized', {
      maxMemoryCacheSize: this.maxMemoryCacheSize,
      defaultTTL: this.defaultTTL,
    });
  }

  /**
   * Get value from cache (checks memory first, then Redis)
   */
  async get<T>(key: string): Promise<T | null> {
    // Check memory cache first
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry) {
      // Check if entry is expired
      if (Date.now() < memoryEntry.timestamp + memoryEntry.ttl * 1000) {
        logger.debug('Cache hit (memory)', { key });
        return memoryEntry.data as T;
      } else {
        // Remove expired entry
        this.memoryCache.delete(key);
      }
    }

    // Check Redis cache
    try {
      const redisValue = await this.redis.get(key);
      if (redisValue) {
        const parsed = JSON.parse(redisValue);
        logger.debug('Cache hit (Redis)', { key });

        // Warm memory cache
        this.memoryCache.set(key, {
          data: parsed,
          timestamp: Date.now(),
          ttl: this.defaultTTL,
        });

        // Enforce memory cache size limit
        this.enforceMemoryCacheLimit();

        return parsed as T;
      }
    } catch (error: any) {
      logger.warn('Redis get error', { key, error: error.message });
    }

    logger.debug('Cache miss', { key });
    return null;
  }

  /**
   * Set value in cache (stores in both memory and Redis)
   */
  async set<T>(key: string, value: T, ttl: number = this.defaultTTL): Promise<void> {
    try {
      // Store in memory cache
      this.memoryCache.set(key, {
        data: value,
        timestamp: Date.now(),
        ttl,
      });

      // Enforce memory cache size limit
      this.enforceMemoryCacheLimit();

      // Store in Redis with TTL
      await this.redis.setex(key, ttl, JSON.stringify(value));

      logger.debug('Cache set', { key, ttl });
    } catch (error: any) {
      logger.error('Cache set error', { key, error: error.message });
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);

    try {
      await this.redis.del(key);
      logger.debug('Cache delete', { key });
    } catch (error: any) {
      logger.warn('Redis delete error', { key, error: error.message });
    }
  }

  /**
   * Clear all cache entries (use with caution)
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    try {
      // Only clear keys with our prefix to avoid clearing other Redis data
      const keys = await this.redis.keys('cache:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      logger.info('Cache cleared', { keysDeleted: keys.length });
    } catch (error: any) {
      logger.error('Cache clear error', { error: error.message });
    }
  }

  /**
   * Generate a deterministic cache key from operation and parameters
   */
  generateCacheKey(operation: string, params: any): string {
    // Create a stable hash of the parameters
    const paramString = JSON.stringify(params, Object.keys(params).sort());
    const hash = crypto
      .createHash('sha256')
      .update(paramString)
      .digest('hex')
      .substring(0, 16);

    return `cache:${operation}:${hash}`;
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    try {
      const redisInfo = await this.redis.info('stats');
      const keyspaceInfo = await this.redis.info('keyspace');

      return {
        memoryCacheSize: this.memoryCache.size,
        maxMemoryCacheSize: this.maxMemoryCacheSize,
        redisInfo: {
          raw: redisInfo,
          keyspace: keyspaceInfo,
        },
      };
    } catch (error: any) {
      logger.error('Error getting cache stats', { error: error.message });
      return {
        memoryCacheSize: this.memoryCache.size,
        maxMemoryCacheSize: this.maxMemoryCacheSize,
        error: error.message,
      };
    }
  }

  /**
   * Enforce memory cache size limit (LRU eviction)
   */
  private enforceMemoryCacheLimit(): void {
    if (this.memoryCache.size > this.maxMemoryCacheSize) {
      // Find and remove oldest entries
      const entries = Array.from(this.memoryCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toRemove = this.memoryCache.size - this.maxMemoryCacheSize;
      for (let i = 0; i < toRemove; i++) {
        this.memoryCache.delete(entries[i][0]);
      }

      logger.debug('Memory cache limit enforced', {
        removed: toRemove,
        currentSize: this.memoryCache.size,
      });
    }
  }

  /**
   * Clean up expired entries from memory cache
   */
  private cleanupMemoryCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.memoryCache.entries()) {
      if (now >= entry.timestamp + entry.ttl * 1000) {
        this.memoryCache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Memory cache cleanup', {
        removed,
        remaining: this.memoryCache.size,
      });
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
    logger.info('IntelligentCacheService closed');
  }
}

// Singleton instance
let cacheInstance: IntelligentCacheService | null = null;

/**
 * Get the singleton cache instance
 */
export function getCache(): IntelligentCacheService {
  if (!cacheInstance) {
    cacheInstance = new IntelligentCacheService();
  }
  return cacheInstance;
}

export default {
  IntelligentCacheService,
  getCache,
};
