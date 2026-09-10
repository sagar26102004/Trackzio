import { env } from '../config/env.js';
import { CircuitBreaker, CircuitOpenError } from '../lib/circuitBreaker.js';
import { logger } from '../lib/logger.js';
import { TokenBucket } from '../lib/tokenBucket.js';
import { AppError } from '../middleware/errors.js';

/** Signals "TMDB says this id does not exist" - cached negatively, never retried. */
export class TmdbNotFoundError extends Error {
  constructor(path: string) {
    super(`TMDB has no resource at ${path}`);
    this.name = 'TmdbNotFoundError';
  }
}

/** Any failure we consider transient: network, timeout, 429, 5xx, open circuit. */
export class TmdbUnavailableError extends Error {
  retryAfterMs?: number;

  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TmdbUnavailableError';
  }
}

// --- Tuning ---------------------------------------------------------------
// Per attempt. Long enough for a cold TMDB response, short enough that three
// attempts still fit inside a request budget a user will wait through.
const ATTEMPT_TIMEOUT_MS = 6_000;
// Total wall-clock budget across all attempts. Without this, 3 timeouts plus
// backoff would make a user wait ~20s before seeing an error. We stop retrying
// once the budget is spent, even if attempts remain.
const TOTAL_BUDGET_MS = 12_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 3_000;
// Comfortably under TMDB's documented ~40-50 req/s ceiling.
const RATE_LIMIT_PER_SECOND = 30;

const bucket = new TokenBucket(RATE_LIMIT_PER_SECOND, RATE_LIMIT_PER_SECOND);

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  openDurationMs: 30_000,
  onStateChange: (from, to) => logger.warn({ from, to }, `TMDB circuit breaker: ${from} -> ${to}`),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Full-jitter exponential backoff. The jitter matters: with a fixed backoff every
 * client that failed at the same moment retries at the same moment, reproducing
 * the thundering herd that caused the failure in the first place.
 */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header); // RFC 7231 permits an HTTP-date instead of seconds.
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export interface TmdbRequestOptions {
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl({ path, query = {} }: TmdbRequestOptions): string {
  const url = new URL(`${env.TMDB_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * One attempt: rate-limited, timed out, and classified into retryable vs terminal.
 * Throws TmdbNotFoundError (terminal), TmdbUnavailableError (retryable), or
 * AppError (terminal problem on our side, such as a bad token).
 */
async function attemptRequest(url: string, redactedPath: string): Promise<unknown> {
  await bucket.take();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // v4 bearer auth. Kept in a header, never in the query string, so the
        // token cannot leak into logs, proxy access logs, or error messages.
        Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    throw new TmdbUnavailableError(
      isTimeout ? `TMDB timed out after ${ATTEMPT_TIMEOUT_MS}ms` : 'Could not reach TMDB',
      error,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    try {
      return await response.json();
    } catch (error) {
      // Valid HTTP, invalid body. Not retryable - a retry returns the same garbage.
      throw AppError.upstreamInvalid('TMDB returned a malformed response.', error);
    }
  }

  if (response.status === 404) throw new TmdbNotFoundError(redactedPath);

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    const error = new TmdbUnavailableError('TMDB rate limited us');
    if (retryAfterMs !== null) error.retryAfterMs = retryAfterMs;
    throw error;
  }

  if (response.status === 401 || response.status === 403) {
    // Our credentials are wrong. Retrying is pointless and would hammer TMDB;
    // this is an operator error and must be loud.
    logger.error({ status: response.status, path: redactedPath }, 'TMDB rejected our credentials');
    throw AppError.upstreamUnavailable('The movie service is not configured correctly.');
  }

  if (response.status >= 500) {
    throw new TmdbUnavailableError(`TMDB returned ${response.status}`);
  }

  // Remaining 4xx: our request was malformed. Not retryable.
  throw AppError.upstreamInvalid(`TMDB rejected the request (${response.status}).`);
}

/**
 * Public entry point. Applies the circuit breaker, then retries transient failures
 * within a total time budget.
 */
export async function tmdbRequest<T = unknown>(options: TmdbRequestOptions): Promise<T> {
  const url = buildUrl(options);
  // Log the path only. Query strings can carry user-typed search text, and the URL
  // is not somewhere we want anything user-supplied echoed verbatim.
  const redactedPath = options.path;
  const startedAt = Date.now();

  try {
    return await breaker.execute(async () => {
      let lastError: unknown;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
          const result = await attemptRequest(url, redactedPath);
          if (attempt > 0) {
            logger.info({ path: redactedPath, attempt: attempt + 1 }, 'TMDB request succeeded after retry');
          }
          return result as T;
        } catch (error) {
          lastError = error;

          // Terminal: a 404, a config problem, or a malformed body.
          if (error instanceof TmdbNotFoundError || error instanceof AppError) throw error;

          const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
          const retryAfterMs = error instanceof TmdbUnavailableError ? error.retryAfterMs : undefined;
          const delay = retryAfterMs ?? backoffMs(attempt);
          const elapsed = Date.now() - startedAt;

          if (isLastAttempt || elapsed + delay > TOTAL_BUDGET_MS) {
            logger.warn(
              { path: redactedPath, attempts: attempt + 1, elapsed, err: error },
              'TMDB request exhausted retries',
            );
            throw error;
          }

          logger.debug({ path: redactedPath, attempt: attempt + 1, delay }, 'Retrying TMDB request');
          await sleep(delay);
        }
      }

      throw lastError instanceof Error ? lastError : new TmdbUnavailableError('TMDB request failed');
    });
  } catch (error) {
    // A rejecting breaker is itself an "upstream unavailable" signal. Callers will
    // try to answer from stale cache before surfacing an error to the user.
    if (error instanceof CircuitOpenError) {
      throw new TmdbUnavailableError('TMDB circuit is open after repeated failures', error);
    }
    throw error;
  }
}

/** Exposed for the health endpoint and tests. */
export function tmdbBreakerState() {
  return breaker.currentState;
}

export function resetTmdbBreakerForTests() {
  breaker.reset();
}
