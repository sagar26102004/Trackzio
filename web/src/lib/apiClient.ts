/**
 * The only place in the app that talks to the network.
 *
 * Everything goes through one function so that credentials, error translation and
 * abort handling are impossible to forget at a call site.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

/** A failed request, carrying the backend's stable error code for the UI to switch on. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Retrying a 503 or a network blip is sensible; retrying a 404 is not. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429 || this.status === 0;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      // Required for the signed device cookie to travel cross-origin, which is how
      // the wishlist knows who is asking.
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    // An aborted request is a normal part of debounced search, not a failure worth
    // showing the user. Rethrow it untouched so React Query discards it silently.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'Could not reach the server. Check your connection.', 0);
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    let code = 'UNKNOWN';
    let message = 'Something went wrong. Please try again.';
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // A non-JSON error body (a proxy's HTML 502 page, say) leaves the defaults.
    }
    throw new ApiError(code, message, response.status);
  }

  return (await response.json()) as T;
}

/** Builds a query string, dropping empty values so URLs stay clean and cache keys stable. */
export function toQueryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
