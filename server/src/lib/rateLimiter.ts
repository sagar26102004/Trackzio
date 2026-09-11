import { LRUCache } from 'lru-cache';

/**
 * A fixed-window attempt counter for sensitive endpoints.
 *
 * Without this, the login endpoint is an unlimited password oracle: an attacker can
 * try millions of passwords against a known email as fast as the network allows.
 * scrypt makes each guess expensive, but expensive-times-unlimited is still
 * unlimited - the guess budget has to be capped somewhere.
 *
 * Deliberately in-process and approximate. A shared store (Redis) would be the
 * correct answer across several instances, and this is documented as a limitation
 * rather than pretended away. It is still far better than nothing on one instance.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Attempt {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly attempts: LRUCache<string, Attempt>;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {
    this.attempts = new LRUCache<string, Attempt>({
      // Bounded so a flood of unique keys cannot exhaust memory - which would turn
      // the protection itself into the denial of service.
      max: 10_000,
      ttl: windowMs,
    });
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const existing = this.attempts.get(key);

    if (!existing || existing.resetAt <= now) {
      return { allowed: true, remaining: this.max - 1, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    return { allowed: true, remaining: this.max - existing.count - 1, retryAfterSeconds: 0 };
  }

  /** Called only on failure, so a legitimate user is never locked out by success. */
  recordFailure(key: string): void {
    const now = Date.now();
    const existing = this.attempts.get(key);

    if (!existing || existing.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }

    existing.count += 1;
    this.attempts.set(key, existing);
  }

  /** A successful login clears the budget for that key. */
  reset(key: string): void {
    this.attempts.delete(key);
  }
}
