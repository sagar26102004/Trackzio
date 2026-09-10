import { useCallback, useMemo } from 'react';
import { EmptyState, ErrorState, NoticeBar, SkeletonGrid, StaleNotice } from '../components/ui/States';
import { FilterBar } from '../features/movies/FilterBar';
import { MovieCard } from '../features/movies/MovieCard';
import { useGenres, useMovies } from '../features/movies/api';
import { useToggleWishlist, useWishlistIds } from '../features/wishlist/api';
import { ApiError } from '../lib/apiClient';
import { useBrowseFilters, useDebouncedValue, useOnScreen } from '../lib/hooks';
import type { MovieSummary } from '../types';

export function BrowsePage() {
  const { filters, setFilters, clearFilters, hasActiveFilters } = useBrowseFilters();

  /**
   * The URL updates on every keystroke (so the address bar stays truthful), but the
   * query is keyed off a debounced copy. That separation is what stops a nine-letter
   * search from firing nine requests while still keeping the URL shareable mid-type.
   */
  const debouncedQuery = useDebouncedValue(filters.q, 350);
  const queryFilters = useMemo(() => ({ ...filters, q: debouncedQuery }), [filters, debouncedQuery]);

  const { data: genres = [] } = useGenres();
  const { data: savedIds } = useWishlistIds();
  const toggleWishlist = useToggleWishlist();

  const {
    data,
    error,
    isPending,
    isPlaceholderData,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useMovies(queryFilters);

  // Flattened once per data change rather than on every render.
  const movies = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const firstPage = data?.pages[0];

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sentinelRef = useOnScreen(Boolean(hasNextPage), loadMore);

  // A stable identity keeps MovieCard's memo effective across re-renders.
  const handleToggle = useCallback(
    (movie: MovieSummary) => {
      toggleWishlist.mutate({ movie, isSaved: savedIds?.has(movie.id) ?? false });
    },
    [toggleWishlist, savedIds],
  );

  const heading = filters.q.trim() ? `Results for “${filters.q.trim()}”` : 'Discover movies';

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-xl font-bold tracking-tight sm:text-2xl">{heading}</h1>
      <p className="mb-5 text-sm text-muted">
        {filters.q.trim()
          ? 'Refine with genres, year and rating.'
          : 'Browse what people are watching, or filter your way to something specific.'}
      </p>

      <FilterBar
        filters={filters}
        genres={genres}
        onChange={setFilters}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
        resultCount={firstPage?.totalResults ?? null}
      />

      {firstPage?.stale && <StaleNotice />}
      {firstPage?.notice && <NoticeBar>{firstPage.notice}</NoticeBar>}

      {isPending ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'We could not load movies right now.'}
          onRetry={() => void refetch()}
        />
      ) : movies.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters} onClear={clearFilters} />
      ) : (
        <>
          {/* Dimming while a new filter combination resolves keeps the previous
              results in place, so the page never collapses and jumps the scroll. */}
          <div className={`poster-grid transition-opacity ${isPlaceholderData ? 'opacity-50' : 'opacity-100'}`}>
            {movies.map((movie, index) => (
              <MovieCard
                key={movie.id}
                movie={movie}
                isSaved={savedIds?.has(movie.id) ?? false}
                onToggleSave={handleToggle}
                // Only the first row is eager; everything else waits for the
                // viewport so a 500-poster grid does not fetch 500 images.
                eager={index < 6}
              />
            ))}
          </div>

          <div ref={sentinelRef} className="h-px" aria-hidden="true" />

          <div className="flex justify-center py-8">
            {isFetchingNextPage ? (
              <span className="text-sm text-muted">Loading more…</span>
            ) : hasNextPage ? (
              // The observer usually gets here first, but an explicit control is
              // required for keyboard and assistive-tech users, who never trigger
              // an intersection by scrolling.
              <button
                type="button"
                onClick={loadMore}
                className="rounded-full border border-line bg-surface-2 px-6 py-2.5 text-sm font-semibold text-content transition hover:bg-surface-3"
              >
                Load more
              </button>
            ) : (
              <span className="text-sm text-faint">That is everything we have.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
