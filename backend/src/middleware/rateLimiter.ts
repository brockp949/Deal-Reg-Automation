import { Request, Response, NextFunction } from 'express';

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
