import { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { config } from '../config';
import logger from '../utils/logger';

// Create a Redis client
const redisClient = createClient({
  url: config.redisUrl,
});

redisClient.on('error', (err) => {
  logger.error('Redis Client Error for rate limiter', err);
});

// Connect the client
redisClient.connect().catch(logger.error);

/**
 * Factory function to create a unique Redis store for each rate limiter.
 * This avoids the ERR_ERL_STORE_REUSE error in express-rate-limit v7+
 */
const createRedisStore = (prefix: string) => new RedisStore({
  sendCommand: (...args: string[]) => redisClient.sendCommand(args),
  prefix: `rl:${prefix}:`,
});

// Use API Key for rate limiting, falling back to IP address
// Note: We disable validation because we primarily use API keys, not IPs
const getApiKey = (req: Request): string => (req as any).apiKey?.key || req.ip || 'unknown';

const getRequestPath = (req: Request): string => {
  if (req.originalUrl) {
    return req.originalUrl;
  }
  return `${req.baseUrl || ''}${req.path || ''}`;
};

const isChunkedUploadPath = (req: Request): boolean => {
  const path = getRequestPath(req);
  return path.includes('/files/upload/chunked');
};

/**
 * Rate limiter for general API endpoints
 */
export const apiLimiter = rateLimit({
  store: createRedisStore('api'),
  windowMs: config.rateLimit.api.windowMs,
  max: config.rateLimit.api.max,
  message: {
    success: false,
    error: 'Too many requests. Please try again in a minute.',
  },
  keyGenerator: getApiKey,
  skip: (req) => isChunkedUploadPath(req) || req.path === '/health' || req.path === '/api/health',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disable validation - we use API keys, not IPs
});

/**
 * Rate limiter for mutation endpoints (POST, PUT, PATCH, DELETE)
 */
export const mutationLimiter = rateLimit({
  store: createRedisStore('mutation'),
  windowMs: config.rateLimit.mutation.windowMs,
  max: config.rateLimit.mutation.max,
  message: {
    success: false,
    error: 'Too many write operations. Please try again in a minute.',
  },
  keyGenerator: getApiKey,
  skip: (req) => isChunkedUploadPath(req) || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method),
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

/**
 * Rate limiter for file upload endpoints
 */
export const uploadLimiter = rateLimit({
  store: createRedisStore('upload'),
  windowMs: config.rateLimit.upload.windowMs,
  max: config.rateLimit.upload.max,
  message: {
    success: false,
    error: 'Too many file uploads. Please try again in 15 minutes.',
  },
  keyGenerator: getApiKey,
  skip: (req) => isChunkedUploadPath(req),
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

/**
 * Rate limiter for batch file upload endpoints
 */
export const batchUploadLimiter = rateLimit({
  store: createRedisStore('batch-upload'),
  windowMs: config.rateLimit.batchUpload.windowMs,
  max: config.rateLimit.batchUpload.max,
  message: {
    success: false,
    error: 'Batch upload rate limit exceeded. Please try again later.',
  },
  keyGenerator: getApiKey,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

/**
 * Factory function to create custom rate limiters
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  prefix?: string;
}) {
  return rateLimit({
    store: createRedisStore(options.prefix || 'custom'),
    windowMs: options.windowMs,
    max: options.max,
    message: {
      success: false,
      error: options.message || 'Rate limit exceeded. Please try again later.',
    },
    keyGenerator: getApiKey,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
  });
}

