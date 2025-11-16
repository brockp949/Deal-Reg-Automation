import logger from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
}

export interface RateLimiterOptions {
  requestsPerSecond: number;
  burstSize?: number;
}

/**
 * Default retry configuration for Google API calls
 */
const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Determines if an error is retryable based on HTTP status codes and error types
 */
function isRetryableError(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // Google API rate limit and server errors
  const status = error.response?.status || error.status || error.code;
  if (typeof status === 'number') {
    // 429 Too Many Requests
    // 500 Internal Server Error
    // 502 Bad Gateway
    // 503 Service Unavailable
    // 504 Gateway Timeout
    return status === 429 || (status >= 500 && status < 600);
  }

  return false;
}

/**
 * Delays execution for a specified number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an async function with exponential backoff retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const shouldRetry = options.shouldRetry ?? isRetryableError;

  let lastError: any;
  let delayMs = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      const isLastAttempt = attempt === opts.maxAttempts;
      const shouldRetryError = shouldRetry(error);

      if (!shouldRetryError || isLastAttempt) {
        logger.error('API call failed', {
          attempt,
          maxAttempts: opts.maxAttempts,
          error: error.message,
          retryable: shouldRetryError,
        });
        throw error;
      }

      logger.warn('API call failed, retrying', {
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs,
        error: error.message,
      });

      await delay(delayMs);
      delayMs = Math.min(delayMs * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Simple token bucket rate limiter
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly tokensPerMs: number;
  private readonly maxTokens: number;

  constructor(options: RateLimiterOptions) {
    this.maxTokens = options.burstSize ?? options.requestsPerSecond;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.tokensPerMs = options.requestsPerSecond / 1000;
  }

  /**
   * Waits until a token is available, then consumes it
   */
  async acquire(): Promise<void> {
    while (true) {
      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      // Calculate how long to wait for the next token
      const tokensNeeded = 1 - this.tokens;
      const waitMs = Math.ceil(tokensNeeded / this.tokensPerMs);
      await delay(Math.min(waitMs, 1000)); // Cap wait at 1 second per iteration
    }
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = timePassed * this.tokensPerMs;

    this.tokens = Math.min(this.tokens + tokensToAdd, this.maxTokens);
    this.lastRefill = now;
  }

  /**
   * Executes a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    return fn();
  }
}

/**
 * Combines rate limiting and retry logic
 */
export async function withRateLimitAndRetry<T>(
  fn: () => Promise<T>,
  rateLimiter: RateLimiter,
  retryOptions?: RetryOptions
): Promise<T> {
  return rateLimiter.execute(() => withRetry(fn, retryOptions));
}
