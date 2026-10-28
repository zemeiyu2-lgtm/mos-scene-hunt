/**
 * Fixed-window rate limiter, in-process.
 *
 * Scope and honesty: this protects a single serverless instance only. It
 * raises the cost of naive abuse (login guessing, publish flooding) but is NOT
 * a distributed quota — a real deployment behind many instances needs a shared
 * counter. That limitation is stated on the admin status card rather than
 * papered over.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Bucket key, e.g. `login:<ipHash>`. */
  key: string;
  /** Maximum hits allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  now?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function consumeRateLimit(options: RateLimitOptions): RateLimitResult {
  const now = options.now ?? Date.now();
  const existing = buckets.get(options.key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(options.key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: options.limit - existing.count,
    retryAfterSeconds: 0,
  };
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
}
