import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_SORT, EMPTY_FILTERS, SORT_OPTIONS, type BrowseFilters, type SortValue } from '../types';

/**
 * Delays propagating a fast-changing value.
 *
 * This is the first half of the answer to "users quickly changing their search or
 * filters": without it, typing "inception" fires nine requests, eight of which are
 * wasted. The second half is request cancellation, which React Query handles via
 * the abort signal we forward to fetch.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Fires when the sentinel scrolls into view. Used to load the next page before the
 * user actually reaches the bottom (rootMargin), so the grid feels continuous
 * rather than stopping to load.
 */
export function useOnScreen(enabled: boolean, onVisible: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Keep the callback in a ref so a new closure each render does not tear down and
  // rebuild the observer on every scroll-triggered re-render.
  const callbackRef = useRef(onVisible);
  callbackRef.current = onVisible;

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callbackRef.current();
      },
      { rootMargin: '600px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  return ref;
}

function parseSort(value: string | null): SortValue {
  const match = SORT_OPTIONS.find((option) => option.value === value);
  return match ? match.value : DEFAULT_SORT;
}

function parseNumber(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

/**
 * Browse state lives in the URL, not in component state.
 *
 * That single decision buys a lot: the back button restores the exact grid the user
 * came from (the brief's "navigate without losing context"), every filtered view is
 * shareable and bookmarkable, and a refresh does not dump the user back to page one
 * of everything. React Query then keys its cache off the same values, so returning
 * to a previous combination is instant and costs no request.
 */
export function useBrowseFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<BrowseFilters>(() => {
    const genresParam = searchParams.get('genres');
    return {
      q: searchParams.get('q') ?? '',
      genreIds: genresParam
        ? genresParam
            .split(',')
            .map((part) => Number.parseInt(part, 10))
            .filter((n) => Number.isInteger(n) && n > 0)
        : [],
      year: parseNumber(searchParams.get('year'), 1874, new Date().getFullYear() + 5),
      minRating: parseNumber(searchParams.get('minRating'), 0, 10),
      sort: parseSort(searchParams.get('sort')),
    };
  }, [searchParams]);

  const setFilters = (next: Partial<BrowseFilters>) => {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();

    if (merged.q.trim()) params.set('q', merged.q.trim());
    if (merged.genreIds.length) params.set('genres', merged.genreIds.join(','));
    if (merged.year !== null) params.set('year', String(merged.year));
    if (merged.minRating !== null) params.set('minRating', String(merged.minRating));
    // Omit the default so the common case has a clean, shareable URL.
    if (merged.sort !== DEFAULT_SORT) params.set('sort', merged.sort);

    // replace: a filter tweak is a refinement, not a destination. Pushing every
    // keystroke would make the back button a tedious undo of the search box.
    setSearchParams(params, { replace: true });
  };

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true });

  const hasActiveFilters =
    filters.q.trim() !== '' ||
    filters.genreIds.length > 0 ||
    filters.year !== null ||
    filters.minRating !== null ||
    filters.sort !== EMPTY_FILTERS.sort;

  return { filters, setFilters, clearFilters, hasActiveFilters };
}

/** Locks background scrolling while a modal or drawer is open. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
