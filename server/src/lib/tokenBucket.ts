/**
 * Client-side rate limiter.
 *
 * TMDB's documented ceiling is "somewhere in the 40 requests per second range" and
 * they ask you to respect a 429 if you get one. Discovering that limit by being
 * rejected is the wrong way round: a 429 costs a round trip, burns a retry, and
 * adds latency for a real user. So we self-throttle below their ceiling instead.
 *
 * Deliberately a smooth token bucket rather than a fixed window: a fixed window
 * lets 30 requests fire in the first 10ms of every second, which is exactly the
 * burst shape that trips upstream limiters.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    if (capacity <= 0 || refillPerSecond <= 0) {
      throw new Error('TokenBucket requires positive capacity and refill rate');
    }
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillMs) / 1000;
    if (elapsedSeconds <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefillMs = now;
  }

  /** Milliseconds until at least one token is available. 0 when one is available now. */
  private waitMs(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000);
  }

  /** Resolves once a token has been consumed, sleeping only as long as necessary. */
  async take(): Promise<void> {
    for (;;) {
      const wait = this.waitMs();
      if (wait === 0) {
        this.tokens -= 1;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  /** Test/observability hook. */
  get available(): number {
    this.refill();
    return this.tokens;
  }
}
