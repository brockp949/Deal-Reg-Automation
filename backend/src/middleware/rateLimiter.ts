import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

type RateLimiterOptions = {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
};

type Counter = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Counter>();

// Legacy rate limiter (keep for backwards compatibility)
export function createRateLimiter(options: RateLimiterOptions) {
  const windowMs = options.windowMs;
  const max = options.max;
  const keyGenerator = options.keyGenerator || ((req: Request) => req.ip || 'global');
  const message = options.message || 'Too many requests, please try again later.';

  return function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const key = keyGenerator(req);
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds,
      });
    }

    current.count += 1;
    return next();
  };
}

/**
 * Rate limiter for file upload endpoints
 * Limits: 10 uploads per 15 minutes per IP
 */
export const uploadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many file uploads. Please try again in 15 minutes.',
});

/**
 * Rate limiter for general API endpoints
 * Limits: 100 requests per minute per IP
 */
export const apiLimiter = rateLimiterWithSkip({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many requests. Please try again in a minute.',
  skip: (req) => req.path === '/health' || req.path === '/api/health',
});

/**
 * Rate limiter for mutation endpoints
 * Limits: 30 mutations per minute per IP
 */
export const mutationLimiter = rateLimiterWithSkip({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many write operations. Please try again in a minute.',
  skip: (req) => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method),
});

function rateLimiterWithSkip(options: RateLimiterOptions & { skip?: (req: Request) => boolean }) {
  const limiter = createRateLimiter(options);
  return (req: Request, res: Response, next: NextFunction) => {
    if (options.skip && options.skip(req)) return next();
    return limiter(req, res, next);
  };
}
