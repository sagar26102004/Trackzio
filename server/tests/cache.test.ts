import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOrLoad, resetCacheForTests } from '../src/cache/index.js';

/**
 * Every test uses a unique key so the suite is deterministic whether or not a
 * Postgres L2 is reachable: with a database present, nothing leaks between runs;
 * without one, the cache degrades to L1 and these assertions still hold.
 */
const key = () => `test:${randomUUID()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => resetCacheForTests());

describe('getOrLoad', () => {
  it('calls the loader once and serves the second read from cache', async () => {
    const k = key();
    const loader = vi.fn().mockResolvedValue({ value: 1 });

    const first = await getOrLoad(k, { ttlMs: 60_000 }, loader);
    const second = await getOrLoad(k, { ttlMs: 60_000 }, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first.status).toBe('MISS');
    expect(second.status).toBe('HIT_L1');
    expect(second.value).toEqual({ value: 1 });
    expect(second.stale).toBe(false);
  });

  it('coalesces concurrent requests for the same key into one upstream call', async () => {
    // This is the behaviour that protects TMDB when 50 users load the same page at
    // once, and when one user hammers the filter bar.
    const k = key();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await sleep(30);
      return { calls };
    };

    const results = await Promise.all(Array.from({ length: 25 }, () => getOrLoad(k, { ttlMs: 60_000 }, loader)));

    expect(calls).toBe(1);
    // Every waiter got the same object, not 25 separate fetches.
    expect(results.every((r) => r.value.calls === 1)).toBe(true);

    // Exactly one caller performed the load; the other 24 joined it. Coalescing has
    // to be total, not partial: the shared promise is registered synchronously, so
    // no caller can slip past it during the awaited L2 read.
    expect(results.filter((r) => r.status === 'MISS')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'COALESCED')).toHaveLength(24);
  });

  it('does not coalesce different keys', async () => {
    const loader = vi.fn().mockResolvedValue('x');
    await Promise.all([
      getOrLoad(key(), { ttlMs: 60_000 }, loader),
      getOrLoad(key(), { ttlMs: 60_000 }, loader),
    ]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('reloads once the entry has expired', async () => {
    const k = key();
    const loader = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    await getOrLoad(k, { ttlMs: 5 }, loader);
    await sleep(20);
    const result = await getOrLoad(k, { ttlMs: 5 }, loader);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.value).toBe('second');
  });

  it('serves an expired entry when the loader fails (stale-if-error)', async () => {
    // The scenario the brief cares about: TMDB is down, but the user still gets a
    // usable page instead of an error.
    const k = key();
    const loader = vi
      .fn()
      .mockResolvedValueOnce('cached payload')
      .mockRejectedValue(new Error('TMDB is down'));

    await getOrLoad(k, { ttlMs: 5, staleIfErrorMs: 60_000 }, loader);
    await sleep(20);

    const result = await getOrLoad(k, { ttlMs: 5, staleIfErrorMs: 60_000 }, loader);

    expect(result.value).toBe('cached payload');
    expect(result.status).toBe('STALE');
    expect(result.stale).toBe(true);
  });

  it('rethrows when the loader fails and nothing is cached', async () => {
    // With no fallback there is nothing honest to show, so the route must 503.
    const loader = vi.fn().mockRejectedValue(new Error('TMDB is down'));
    await expect(getOrLoad(key(), { ttlMs: 60_000 }, loader)).rejects.toThrow('TMDB is down');
  });

  it('refuses to serve a fallback that is older than the stale-if-error window', async () => {
    const k = key();
    const loader = vi.fn().mockResolvedValueOnce('ancient').mockRejectedValue(new Error('TMDB is down'));

    await getOrLoad(k, { ttlMs: 5, staleIfErrorMs: 10 }, loader);
    await sleep(40); // now well past both the TTL and the fallback horizon

    await expect(getOrLoad(k, { ttlMs: 5, staleIfErrorMs: 10 }, loader)).rejects.toThrow('TMDB is down');
  });

  it('serves stale immediately and refreshes behind the request (stale-while-revalidate)', async () => {
    const k = key();
    const policy = { ttlMs: 5, staleWhileRevalidateMs: 60_000 };
    // mockResolvedValue, not a second mockResolvedValueOnce: the entry re-expires
    // after 5ms, so polling below can legitimately trigger another revalidation.
    // A "once" mock would start resolving undefined and make the test lie.
    const loader = vi.fn().mockResolvedValueOnce('v1').mockResolvedValue('v2');

    await getOrLoad(k, policy, loader);
    await sleep(20);

    // The user waits on nothing: they get v1 back straight away.
    const stale = await getOrLoad(k, policy, loader);
    expect(stale.value).toBe('v1');
    expect(stale.status).toBe('REVALIDATING');

    // ...and the refresh lands in the background, so a later read sees v2.
    await vi.waitFor(async () => {
      const next = await getOrLoad(k, policy, loader);
      expect(next.value).toBe('v2');
    });
  });

  it('does not stampede the loader while a background revalidation is in flight', async () => {
    const k = key();
    const policy = { ttlMs: 5, staleWhileRevalidateMs: 60_000 };
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await sleep(40);
      return `v${calls}`;
    };

    await getOrLoad(k, policy, loader);
    await sleep(20);

    const results = await Promise.all(Array.from({ length: 10 }, () => getOrLoad(k, policy, loader)));

    // All ten are served instantly from the expired entry; none waits on the refresh.
    expect(results.every((r) => r.status === 'REVALIDATING')).toBe(true);

    // The refresh begins behind an awaited L2 read, so it has not necessarily
    // called the loader yet at this point - wait for the effect rather than
    // assuming it already happened.
    await vi.waitFor(() => expect(calls).toBe(2));

    // One initial load plus exactly one revalidation, not ten. Held over a window
    // longer than the loader takes, so a stampede would have shown up by now.
    await sleep(80);
    expect(calls).toBe(2);
  });
});
