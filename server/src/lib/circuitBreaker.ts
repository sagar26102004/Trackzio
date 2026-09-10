/**
 * A circuit breaker around the upstream call.
 *
 * Without one, a TMDB outage means every incoming request spends its full 6s
 * timeout waiting for a host we already know is down, holding a socket and a
 * request slot the whole time. Under any real traffic that queues up and takes
 * our own API down with it.
 *
 * With one, after N consecutive failures we stop calling for a cooling-off period
 * and fail (or serve stale cache) in microseconds. The half-open state lets a
 * single probe request test recovery instead of stampeding the recovering service.
 */
export type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(public readonly msUntilRetry: number) {
    super(`Circuit is open; retry in ${msUntilRetry}ms`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  openDurationMs?: number;
  onStateChange?: (from: BreakerState, to: BreakerState) => void;
}

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAtMs = 0;
  private halfOpenInFlight = false;

  private readonly failureThreshold: number;
  private readonly openDurationMs: number;
  private readonly onStateChange: (from: BreakerState, to: BreakerState) => void;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.openDurationMs = options.openDurationMs ?? 30_000;
    this.onStateChange = options.onStateChange ?? (() => {});
  }

  private transition(to: BreakerState): void {
    if (this.state === to) return;
    const from = this.state;
    this.state = to;
    this.onStateChange(from, to);
  }

  get currentState(): BreakerState {
    // Lazily promote open -> half-open once the cooling period has elapsed, so
    // callers see the real state without needing a background timer.
    if (this.state === 'open' && Date.now() - this.openedAtMs >= this.openDurationMs) {
      this.transition('half-open');
      this.halfOpenInFlight = false;
    }
    return this.state;
  }

  /**
   * Runs `fn` unless the circuit is open. Throws CircuitOpenError immediately when
   * open, which callers treat as "upstream is down" and answer from stale cache.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState;

    if (state === 'open') {
      throw new CircuitOpenError(Math.max(0, this.openDurationMs - (Date.now() - this.openedAtMs)));
    }

    // In half-open we allow exactly one probe through; everything else fails fast
    // so a recovering upstream is not immediately hit by the full backlog.
    if (state === 'half-open') {
      if (this.halfOpenInFlight) throw new CircuitOpenError(this.openDurationMs);
      this.halfOpenInFlight = true;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.halfOpenInFlight = false;
    this.transition('closed');
  }

  private recordFailure(): void {
    this.halfOpenInFlight = false;
    this.consecutiveFailures += 1;
    // A failed probe in half-open re-opens immediately: one strike, not N.
    if (this.state === 'half-open' || this.consecutiveFailures >= this.failureThreshold) {
      this.openedAtMs = Date.now();
      this.transition('open');
    }
  }

  /** Test hook. */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.halfOpenInFlight = false;
  }
}
