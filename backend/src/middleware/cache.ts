/**
 * Response Caching Middleware
 * 
 * Simple in-memory cache for GET requests with configurable TTL.
 * Automatically invalidates cache when mutations occur.
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

interface CacheEntry {
    data: any;
    expiresAt: number;
    etag: string;
}

const cache = new Map<string, CacheEntry>();
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Create a caching middleware with specified TTL
 * @param ttlSeconds Cache time-to-live in seconds
 */
export function cacheMiddleware(ttlSeconds = 60) {
    return (req: Request, res: Response, next: NextFunction) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }

        const key = generateCacheKey(req);
        const cached = cache.get(key);
        const now = Date.now();

        // Check for valid cache entry
        if (cached && cached.expiresAt > now) {
            cacheHits++;

            // Support conditional requests with ETag
            if (req.headers['if-none-match'] === cached.etag) {
                return res.status(304).end();
            }

            res.setHeader('X-Cache', 'HIT');
            res.setHeader('ETag', cached.etag);
            return res.json(cached.data);
        }

        cacheMisses++;

        // Intercept res.json to cache the response
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
            // Only cache successful responses
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const etag = `"${Date.now().toString(36)}"`;
                cache.set(key, {
                    data,
                    expiresAt: now + ttlSeconds * 1000,
                    etag,
                });
                res.setHeader('ETag', etag);
            }
            res.setHeader('X-Cache', 'MISS');
            return originalJson(data);
        };

        next();
    };
}

/**
 * Generate cache key from request
 */
function generateCacheKey(req: Request): string {
    return `${req.originalUrl}`;
}

/**
 * Invalidate cache entries matching a pattern
 * @param pattern Optional URL pattern to match (invalidates all if not provided)
 */
export function invalidateCache(pattern?: string): number {
    let count = 0;
    if (pattern) {
        for (const key of cache.keys()) {
            if (key.includes(pattern)) {
                cache.delete(key);
                count++;
            }
        }
        logger.debug(`Invalidated ${count} cache entries matching: ${pattern}`);
    } else {
        count = cache.size;
        cache.clear();
        logger.debug(`Invalidated all ${count} cache entries`);
    }
    return count;
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
    return {
        entries: cache.size,
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: cacheHits + cacheMisses > 0
            ? ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1) + '%'
            : '0%',
    };
}

/**
 * Middleware to invalidate cache on mutations
 */
export function invalidateCacheOnMutation(patterns: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            // Invalidate after response is sent
            res.on('finish', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    patterns.forEach(pattern => invalidateCache(pattern));
                }
            });
        }
        next();
    };
}

export default cacheMiddleware;
