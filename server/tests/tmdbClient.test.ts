import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/middleware/errors.js';
import { TmdbNotFoundError, TmdbUnavailableError, resetTmdbBreakerForTests, tmdbRequest } from '../src/tmdb/client.js';

/** Minimal Response stand-in - the client only reads ok/status/json/headers. */
function response(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The breaker is module state shared across the suite; a test that opens it
  // would otherwise fail every test after it.
  resetTmdbBreakerForTests();
});

afterEach(() => vi.unstubAllGlobals());

describe('tmdbRequest', () => {
  it('returns the parsed body on success', async () => {
    fetchMock.mockResolvedValue(response(200, { id: 550 }));

    await expect(tmdbRequest({ path: '/movie/550' })).resolves.toEqual({ id: 550 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the token as a bearer header and never in the query string', async () => {
    fetchMock.mockResolvedValue(response(200, {}));

    await tmdbRequest({ path: '/movie/550', query: { language: 'en-US' } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('language=en-US');
    // A token in the URL leaks into proxy logs and error reports.
    expect(url).not.toContain('test-token');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('omits undefined and empty query parameters', async () => {
    fetchMock.mockResolvedValue(response(200, {}));

    await tmdbRequest({ path: '/discover/movie', query: { page: 1, with_genres: undefined, q: '' } });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('page=1');
    expect(url).not.toContain('with_genres');
    expect(url).not.toContain('q=');
  });

  it('retries a 429 and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(response(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(response(200, { ok: true }));

    await expect(tmdbRequest({ path: '/movie/1' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx and gives up after the attempt limit', async () => {
    fetchMock.mockResolvedValue(response(503));

    await expect(tmdbRequest({ path: '/movie/1' })).rejects.toBeInstanceOf(TmdbUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a network failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response(200, { recovered: true }));

    await expect(tmdbRequest({ path: '/movie/1' })).resolves.toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404 - the answer will not change', async () => {
    fetchMock.mockResolvedValue(response(404));

    await expect(tmdbRequest({ path: '/movie/0' })).rejects.toBeInstanceOf(TmdbNotFoundError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry bad credentials, and does not leak the reason to the client', async () => {
    fetchMock.mockResolvedValue(response(401));

    const error = await tmdbRequest({ path: '/movie/1' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    // The user sees a generic message; the operator sees the 401 in the logs.
    expect((error as AppError).message).not.toContain('401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a malformed body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as unknown as Response);

    await expect(tmdbRequest({ path: '/movie/1' })).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after repeated failures and stops calling upstream', async () => {
    fetchMock.mockResolvedValue(response(503));

    // Five consecutive failed requests (each of which burns three attempts).
    for (let i = 0; i < 5; i += 1) {
      await expect(tmdbRequest({ path: `/movie/${i}` })).rejects.toThrow();
    }

    const callsBefore = fetchMock.mock.calls.length;
    await expect(tmdbRequest({ path: '/movie/99' })).rejects.toBeInstanceOf(TmdbUnavailableError);

    // The whole point: the next request costs nothing instead of three timeouts.
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
