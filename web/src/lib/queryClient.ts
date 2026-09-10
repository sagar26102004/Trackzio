import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './apiClient';

/**
 * React Query is doing real work in this app, not decoration:
 *
 *   - it dedupes identical in-flight requests, so mounting two components that
 *     want the same page costs one request
 *   - it keeps previous pages in memory, which is what makes going Browse ->
 *     Detail -> Back instant and scroll-preserving
 *   - it owns retry policy in one place
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The backend already caches aggressively and sets Cache-Control, so the
      // client can afford a long stale time. This is the single biggest lever for
      // "avoid unnecessary requests": navigating back to a list refetches nothing.
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry a 404 or a validation error - the answer will not change.
        if (error instanceof ApiError && !error.isRetryable) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
    mutations: {
      retry: false,
    },
  },
});
