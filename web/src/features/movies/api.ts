import { useInfiniteQuery, useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiFetch, toQueryString } from '../../lib/apiClient';
import type { BrowseFilters, Genre, MovieDetail, MoviePage } from '../../types';

/**
 * Query keys are derived from the filter object, so React Query's cache is keyed by
 * exactly the thing that determines the response. Changing a filter creates a new
 * key (a fresh fetch); going back to a previous filter combination re-uses the
 * cached one with no request at all.
 */
export const movieKeys = {
  all: ['movies'] as const,
  genres: () => ['genres'] as const,
  list: (filters: BrowseFilters) =>
    [
      'movies',
      'list',
      {
        q: filters.q.trim().toLowerCase(),
        // Sorted so that picking genres in a different order hits the same cache entry.
        genres: [...filters.genreIds].sort((a, b) => a - b).join(','),
        year: filters.year,
        minRating: filters.minRating,
        sort: filters.sort,
      },
    ] as const,
  detail: (id: number) => ['movies', 'detail', id] as const,
};

export function useGenres() {
  return useQuery({
    queryKey: movieKeys.genres(),
    queryFn: () => apiFetch<{ items: Genre[] }>('/api/genres'),
    // Genre names change roughly never; there is no reason to refetch them.
    staleTime: 24 * 60 * 60 * 1000,
    select: (data) => data.items,
  });
}

function filtersToQuery(filters: BrowseFilters, page: number): string {
  return toQueryString({
    q: filters.q.trim() || undefined,
    genres: filters.genreIds.length ? filters.genreIds.join(',') : undefined,
    year: filters.year,
    minRating: filters.minRating,
    sort: filters.sort,
    page,
  });
}

/**
 * The browse grid. Infinite rather than numbered pages because the brief asks for
 * "continue exploring when there are many matching results" - a discovery product
 * wants an uninterrupted flow, not a pagination footer.
 *
 * `signal` is forwarded to fetch so that when the user keeps typing, React Query
 * aborts the superseded request instead of letting a slow earlier response land
 * after a faster later one and overwrite the grid.
 */
export function useMovies(filters: BrowseFilters) {
  return useInfiniteQuery({
    queryKey: movieKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      apiFetch<MoviePage>(`/api/movies${filtersToQuery(filters, pageParam)}`, { signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    // Keeps the previous result on screen while a new filter combination loads, so
    // the grid dims instead of collapsing to a spinner and bouncing the scroll.
    placeholderData: keepPreviousData,
    /**
     * Self-heal after an upstream outage.
     *
     * The `stale` flag travels with the cached payload, so without this the
     * "showing saved results" banner would sit there for the full 5-minute
     * staleTime even though TMDB recovered seconds later. Poll while degraded, and
     * stop the moment a fresh response arrives - no polling in the normal case.
     */
    refetchInterval: (query) => {
      const isServingStale = query.state.data?.pages.some((page) => page.stale) ?? false;
      return isServingStale ? 15_000 : false;
    },
  });
}

export function useMovie(id: number) {
  return useQuery({
    queryKey: movieKeys.detail(id),
    queryFn: ({ signal }) => apiFetch<MovieDetail>(`/api/movies/${id}`, { signal }),
    enabled: Number.isFinite(id) && id > 0,
  });
}
