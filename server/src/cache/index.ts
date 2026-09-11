import { LRUCache } from 'lru-cache';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

/**
 * Two-tier cache in front of TMDB.
 *
 *   L1  in-process LRU     - microseconds, but dies with the process and is not
 *                            shared between instances
 *   L2  Postgres table     - survives restarts and deploys, shared across every
 *                            instance, and is what makes stale-if-error possible
 *
 * On top of the two tiers it does two things that matter more than the tiers
 * themselves:
 *
 *   single-flight   N concurrent requests for the same key produce ONE upstream
 *                   call. This is the direct answer to "the same information is
 *                   requested repeatedly" and to a user hammering the filter bar.
 *
 *   stale serving   expired rows are kept, not deleted. If TMDB is slow, down, or
 *                   rate-limiting us, we serve slightly-old data with a `stale`
 *                   flag instead of an error page. Degraded beats broken.
 */

export type CacheStatus = 'HIT_L1' | 'HIT_L2' | 'COALESCED' | 'MISS' | 'STALE' | 'REVALIDATING';

export interface CacheResult<T> {
  value: T;
  status: CacheStatus;
  /** True when the payload came from an expired entry. Surfaces to the client. */
  stale: boolean;
}

export interface CachePolicy {
  /** How long the entry is considered fresh. */
  ttlMs: number;
  /**
   * After ttlMs, how long we may still serve the expired entry *immediately* while
   * refreshing in the background. Mirrors HTTP `stale-while-revalidate`. 0 disables.
   */
  staleWhileRevalidateMs?: number;
  /**
   * After the entry is fully stale, how long it remains usable as an emergency
   * fallback when the loader throws. Mirrors HTTP `stale-if-error`.
   */
  staleIfErrorMs?: number;
}

interface StoredEntry<T> {
  payload: T;
  expiresAtMs: number;
}

const DEFAULT_STALE_IF_ERROR_MS = 24 * 60 * 60 * 1000;

/**
 * Bounded by entry count rather than bytes: our payloads are one page of movies
 * (~20 records) and are within an order of magnitude of each other, so counting
 * entries is a good enough proxy and far cheaper than sizing every object.
 */
const l1 = new LRUCache<string, StoredEntry<unknown>>({
  max: 1_000,
  // Evict on the stale-if-error horizon, not on ttlMs: an entry past its TTL is
  // still valuable as a fallback, so it must not disappear from L1 at expiry.
  ttl: DEFAULT_STALE_IF_ERROR_MS,
  ttlAutopurge: false,
});

/** Keyed by cache key. The value is the in-flight load, shared by every waiter. */
const inFlight = new Map<string, Promise<unknown>>();

const metrics = { hitL1: 0, hitL2: 0, miss: 0, stale: 0, coalesced: 0 };

export function cacheMetrics() {
  const total = metrics.hitL1 + metrics.hitL2 + metrics.coalesced + metrics.miss + metrics.stale;
  return {
    ...metrics,
    total,
    // Coalesced requests are hits in every sense that matters: they were served
    // without touching TMDB. `miss` now counts only real upstream loads.
    hitRate:
      total === 0
        ? 0
        : Math.round(((metrics.hitL1 + metrics.hitL2 + metrics.coalesced) / total) * 100) / 100,
    l1Size: l1.size,
    inFlight: inFlight.size,
  };
}

async function readL2<T>(key: string): Promise<StoredEntry<T> | null> {
  try {
    const row = await prisma.cacheEntry.findUnique({ where: { key } });
    if (!row) return null;
    return { payload: row.payload as T, expiresAtMs: row.expiresAt.getTime() };
  } catch (error) {
    // A cache that is down must not take the app down with it. Log and treat as a
    // miss, so we fall through to the upstream call.
    logger.error({ err: error, key }, 'L2 cache read failed; treating as a miss');
    return null;
  }
}

function writeL2<T>(key: string, payload: T, expiresAt: Date): void {
  // Postgres jsonb has no representation for `undefined`, and Prisma rejects it
  // outright. There is nothing useful to cache here anyway, so skip rather than
  // let a malformed write surface as an error.
  if (payload === undefined) return;

  // This runs inside the loader's try/catch, so a throw escaping here would be
  // misread as an upstream failure and could trigger a bogus stale fallback. The
  // whole call is guarded, not just the promise: Prisma can reject asynchronously,
  // but argument validation can also throw before a promise exists.
  try {
    const data = { payload: payload as never, expiresAt };
    // Deliberately not awaited. The user's response does not need to wait on a
    // cache write, and a failed write is a performance problem, never a
    // correctness one - the value is already in L1 and already being returned.
    void prisma.cacheEntry
      .upsert({ where: { key }, create: { key, ...data }, update: data })
      .catch((error) => logger.error({ err: error, key }, 'L2 cache write failed'));
  } catch (error) {
    logger.error({ err: error, key }, 'L2 cache write could not be issued');
  }
}

function isUsableAsFallback(entry: StoredEntry<unknown>, policy: CachePolicy): boolean {
  const horizon = policy.staleIfErrorMs ?? DEFAULT_STALE_IF_ERROR_MS;
  return Date.now() - entry.expiresAtMs <= horizon;
}

/**
 * Everything past the L1 check, as ONE shared promise per key: the L2 read, the
 * upstream load, both tier writes, and the stale fallback.
 *
 * The scope matters. An earlier version wrapped only the loader, which left the L2
 * read outside single-flight — and since that read is a network round trip to a
 * remote Postgres, every concurrent caller reached it before any of them had
 * registered as in-flight. Twenty-five simultaneous requests for a cold key issued
 * twenty-five identical SELECTs, and if one finished its load before another
 * finished its read, they raced into two upstream calls.
 *
 * Registering the promise synchronously, before the first await, closes that window
 * completely: N concurrent callers now cost exactly one L2 read and one upstream call.
 */
function loadShared<T>(
  key: string,
  policy: CachePolicy,
  loader: () => Promise<T>,
  l1Fallback: StoredEntry<T> | undefined,
): Promise<CacheResult<T>> {
  const promise = (async (): Promise<CacheResult<T>> => {
    const l2Entry = await readL2<T>(key);

    if (l2Entry && l2Entry.expiresAtMs > Date.now()) {
      metrics.hitL2 += 1;
      // Promote into L1 so the next hit does not pay for a database round trip.
      l1.set(key, l2Entry);
      return { value: l2Entry.payload, status: 'HIT_L2', stale: false };
    }

    // Best fallback if the loader fails: whichever expired copy we found.
    const fallback = l2Entry ?? l1Fallback ?? null;

    try {
      const value = await loader();
      const expiresAtMs = Date.now() + policy.ttlMs;
      l1.set(key, { payload: value, expiresAtMs });
      writeL2(key, value, new Date(expiresAtMs));
      metrics.miss += 1;
      return { value, status: 'MISS', stale: false };
    } catch (error) {
      if (fallback && isUsableAsFallback(fallback, policy)) {
        metrics.stale += 1;
        const ageSeconds = Math.round((Date.now() - fallback.expiresAtMs) / 1000);
        logger.warn({ key, ageSeconds, err: error }, 'Loader failed; serving stale cache entry');
        return { value: fallback.payload as T, status: 'STALE', stale: true };
      }
      // Nothing usable cached and upstream is down. The route turns this into a 503.
      throw error;
    }
  })().finally(() => {
    inFlight.delete(key);
  });

  // Synchronous, before any caller can await: this is what makes coalescing total.
  inFlight.set(key, promise);
  return promise;
}

/**
 * The one function the rest of the app uses.
 *
 * Order: L1, then stale-while-revalidate, then join-or-start the shared load.
 */
export async function getOrLoad<T>(
  key: string,
  policy: CachePolicy,
  loader: () => Promise<T>,
): Promise<CacheResult<T>> {
  const now = Date.now();

  const l1Entry = l1.get(key) as StoredEntry<T> | undefined;
  if (l1Entry && l1Entry.expiresAtMs > now) {
    metrics.hitL1 += 1;
    return { value: l1Entry.payload, status: 'HIT_L1', stale: false };
  }

  // stale-while-revalidate: serve the expired L1 entry now, refresh behind the user.
  const swrWindow = policy.staleWhileRevalidateMs ?? 0;
  if (l1Entry && swrWindow > 0 && now - l1Entry.expiresAtMs <= swrWindow) {
    metrics.hitL1 += 1;
    if (!inFlight.has(key)) {
      void loadShared(key, policy, loader, l1Entry).catch((error) =>
        logger.warn({ err: error, key }, 'Background revalidation failed; stale entry retained'),
      );
    }
    return { value: l1Entry.payload, status: 'REVALIDATING', stale: true };
  }

  const shared = inFlight.get(key) as Promise<CacheResult<T>> | undefined;
  if (shared) {
    metrics.coalesced += 1;
    // Reported as COALESCED rather than as the underlying result's status: this
    // request cost nothing upstream, and counting it as a MISS would have made the
    // hit rate read far worse than reality.
    const result = await shared;
    return { ...result, status: 'COALESCED' };
  }

  return loadShared(key, policy, loader, l1Entry);
}

/** Drops a key from both tiers. Used when we know the underlying data changed. */
export async function invalidate(key: string): Promise<void> {
  l1.delete(key);
  try {
    await prisma.cacheEntry.deleteMany({ where: { key } });
  } catch (error) {
    logger.error({ err: error, key }, 'Failed to invalidate L2 entry');
  }
}

/**
 * Deletes L2 rows too old to serve even as an emergency fallback. Without this the
 * table grows without bound: every distinct filter combination a user ever tried
 * leaves a row behind.
 */
export async function sweepExpiredEntries(maxAgeMs = DEFAULT_STALE_IF_ERROR_MS): Promise<number> {
  try {
    const { count } = await prisma.cacheEntry.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - maxAgeMs) } },
    });
    if (count > 0) logger.info({ count }, 'Swept expired cache entries');
    return count;
  } catch (error) {
    logger.error({ err: error }, 'Cache sweep failed');
    return 0;
  }
}

/** Test hook: clears L1 and in-flight state without touching the database. */
export function resetCacheForTests(): void {
  l1.clear();
  inFlight.clear();
  metrics.hitL1 = 0;
  metrics.hitL2 = 0;
  metrics.miss = 0;
  metrics.stale = 0;
  metrics.coalesced = 0;
}
