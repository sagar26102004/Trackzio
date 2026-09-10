import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../src/lib/circuitBreaker.js';
import { TokenBucket } from '../src/lib/tokenBucket.js';

describe('TokenBucket', () => {
  it('allows an initial burst up to capacity without waiting', async () => {
    const bucket = new TokenBucket(5, 5);
    const started = Date.now();

    for (let i = 0; i < 5; i += 1) await bucket.take();

    // All five tokens were already in the bucket, so nothing should have slept.
    expect(Date.now() - started).toBeLessThan(50);
    expect(bucket.available).toBeLessThan(1);
  });

  it('makes the caller wait once the bucket is drained', async () => {
    // 20 tokens/sec means a refill roughly every 50ms.
    const bucket = new TokenBucket(1, 20);
    await bucket.take();

    const started = Date.now();
    await bucket.take();

    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
  });
});

describe('CircuitBreaker', () => {
  const boom = () => Promise.reject(new Error('upstream down'));

  it('stays closed while calls succeed', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.currentState).toBe('closed');
  });

  it('opens after the failure threshold and then fails fast', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, openDurationMs: 10_000 });

    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(boom)).rejects.toThrow('upstream down');
    }

    expect(breaker.currentState).toBe('open');

    // The point of the breaker: this call must not reach the upstream at all.
    const upstream = vi.fn();
    await expect(breaker.execute(upstream)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('resets the failure count when a call succeeds', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    // Two more failures should not be enough now that the counter was cleared.
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();

    expect(breaker.currentState).toBe('closed');
  });

  it('half-opens after the cooling period and closes on a successful probe', async () => {
    vi.useFakeTimers();
    try {
      const breaker = new CircuitBreaker({ failureThreshold: 1, openDurationMs: 1_000 });

      await expect(breaker.execute(boom)).rejects.toThrow();
      expect(breaker.currentState).toBe('open');

      vi.advanceTimersByTime(1_001);
      expect(breaker.currentState).toBe('half-open');

      await expect(breaker.execute(async () => 'recovered')).resolves.toBe('recovered');
      expect(breaker.currentState).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-opens immediately when the half-open probe fails', async () => {
    vi.useFakeTimers();
    try {
      const breaker = new CircuitBreaker({ failureThreshold: 1, openDurationMs: 1_000 });

      await expect(breaker.execute(boom)).rejects.toThrow();
      vi.advanceTimersByTime(1_001);
      expect(breaker.currentState).toBe('half-open');

      // One failed probe is enough - we do not wait for the threshold again.
      await expect(breaker.execute(boom)).rejects.toThrow();
      expect(breaker.currentState).toBe('open');
    } finally {
      vi.useRealTimers();
    }
  });
});
