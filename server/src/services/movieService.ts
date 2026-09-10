import { getOrLoad, type CacheResult } from '../cache/index.js';
import type { Genre, MovieDetail, MovieSummary, Paginated, SortOption } from '../domain/types.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../middleware/errors.js';
import { TmdbNotFoundError, TmdbUnavailableError, tmdbRequest } from '../tmdb/client.js';
import { mapMovieDetail, mapMovieList, type GenreMap } from '../tmdb/mapper.js';
import { tmdbGenreListSchema, tmdbMovieDetailSchema, tmdbPageSchema } from '../tmdb/schemas.js';

/**
 * TMDB refuses any page above 500 regardless of what total_results claims, so a
 * query reporting 40,000 matches still only exposes 10,000 of them. We clamp and
 * tell the user to narrow their filters rather than letting them walk into a 400.
 */
const TMDB_MAX_PAGE = 500;
const TMDB_PAGE_SIZE = 20;
const LANGUAGE = 'en-US';

/**
 * When sorting by rating, TMDB will happily put a film with one 10/10 vote above
 * The Godfather. A vote-count floor is the difference between a "Top rated" sort
 * that looks broken and one that looks curated.
 */
const MIN_VOTES_FOR_RATING_SORT = 300;

const CACHE_POLICY = {
  genres: { ttlMs: 24 * 60 * 60 * 1000, staleIfErrorMs: 7 * 24 * 60 * 60 * 1000 },
  // Short TTL because popularity shifts, but a generous SWR window so a user
  // paging through results never waits on a revalidation.
  list: { ttlMs: 5 * 60 * 1000, staleWhileRevalidateMs: 10 * 60 * 1000, staleIfErrorMs: 24 * 60 * 60 * 1000 },
  detail: { ttlMs: 12 * 60 * 60 * 1000, staleIfErrorMs: 7 * 24 * 60 * 60 * 1000 },
  // Negative cache: short, so a newly added movie becomes visible quickly, but
  // long enough that a crawler hitting bad ids cannot use us to hammer TMDB.
  notFound: { ttlMs: 60 * 1000, staleIfErrorMs: 60 * 1000 },
} as const;

export interface BrowseParams {
  q?: string | undefined;
  genreIds?: number[] | undefined;
  year?: number | undefined;
  minRating?: number | undefined;
  sort: SortOption;
  page: number;
}

/** Deterministic cache key: same filters in any order must produce the same string. */
function browseCacheKey(params: BrowseParams): string {
  const parts = [
    `q=${params.q?.toLowerCase().trim() ?? ''}`,
    `g=${[...(params.genreIds ?? [])].sort((a, b) => a - b).join(',')}`,
    `y=${params.year ?? ''}`,
    `r=${params.minRating ?? ''}`,
    `s=${params.sort}`,
    `p=${params.page}`,
  ];
  return `movies:browse:${parts.join('|')}`;
}

// --- Genres ---------------------------------------------------------------

/**
 * The genre list is tiny, changes maybe twice a year, and is needed to map ids to
 * names on every single movie card. It is the highest-leverage thing to cache.
 */
async function loadGenres(): Promise<Genre[]> {
  const raw = await tmdbRequest({ path: '/genre/movie/list', query: { language: LANGUAGE } });
  return tmdbGenreListSchema.parse(raw).genres;
}

export async function getGenres(): Promise<CacheResult<Genre[]>> {
  return getOrLoad('genres:movie', CACHE_POLICY.genres, loadGenres);
}

async function getGenreMap(): Promise<GenreMap> {
  try {
    const { value } = await getGenres();
    return new Map(value.map((g) => [g.id, g.name]));
  } catch (error) {
    // Genre names are decoration. If we cannot resolve them, movies should still
    // render - just without genre chips.
    logger.warn({ err: error }, 'Genre list unavailable; rendering movies without genre names');
    return new Map();
  }
}

// --- Browse and search ----------------------------------------------------

interface RawPageResult {
  items: MovieSummary[];
  page: number;
  totalPages: number;
  totalResults: number;
  dropped: number;
}

async function fetchDiscoverPage(params: BrowseParams, genreMap: GenreMap): Promise<RawPageResult> {
  const sortingByRating = params.sort.startsWith('vote_average');

  const raw = await tmdbRequest({
    path: '/discover/movie',
    query: {
      language: LANGUAGE,
      include_adult: false,
      // Excludes the "no release date announced" long tail, which otherwise floods
      // date-sorted results with placeholder entries.
      include_video: false,
      sort_by: params.sort,
      page: params.page,
      // Comma is AND in TMDB's syntax: picking Action + Comedy means both, which is
      // what a filter chip set is understood to mean. Pipe (OR) would widen results
      // as the user adds filters, which reads as broken.
      with_genres: params.genreIds?.length ? params.genreIds.join(',') : undefined,
      primary_release_year: params.year,
      'vote_average.gte': params.minRating,
      'vote_count.gte': sortingByRating ? MIN_VOTES_FOR_RATING_SORT : undefined,
    },
  });

  const page = tmdbPageSchema.parse(raw);
  const { items, dropped } = mapMovieList(page.results, genreMap);

  return {
    items,
    page: page.page,
    totalPages: page.total_pages,
    totalResults: page.total_results,
    dropped,
  };
}

/**
 * TMDB's /search/movie supports NONE of the filters /discover/movie supports: no
 * genre, no sort, no rating floor. Rather than leak that seam to the client as two
 * different endpoints with two different capability sets, we absorb it here and
 * apply the filters ourselves.
 *
 * The honest limitation, surfaced to the user as a `notice`: we can only filter and
 * sort within the page TMDB gave us, so counts are approximate and a filtered
 * search page can come back partly empty. Paginating the full result set locally
 * would mean fetching up to 500 pages per keystroke, which is far worse.
 */
async function fetchSearchPage(params: BrowseParams, genreMap: GenreMap): Promise<RawPageResult> {
  const raw = await tmdbRequest({
    path: '/search/movie',
    query: {
      language: LANGUAGE,
      include_adult: false,
      query: params.q,
      page: params.page,
      primary_release_year: params.year,
    },
  });

  const page = tmdbPageSchema.parse(raw);
  const { items, dropped } = mapMovieList(page.results, genreMap);

  let filtered = items;

  if (params.genreIds?.length) {
    // AND semantics, matching the discover path's comma-joined with_genres.
    const wanted = params.genreIds;
    filtered = filtered.filter((movie) => wanted.every((id) => movie.genreIds.includes(id)));
  }

  if (params.minRating !== undefined) {
    const floor = params.minRating;
    filtered = filtered.filter((m) => m.rating !== null && m.rating >= floor);
  }

  filtered = sortSummaries(filtered, params.sort);

  return {
    items: filtered,
    page: page.page,
    totalPages: page.total_pages,
    totalResults: page.total_results,
    dropped,
  };
}

/** Local equivalent of TMDB's sort_by, for the search path. */
function sortSummaries(items: MovieSummary[], sort: SortOption): MovieSummary[] {
  const copy = [...items];
  const byNullableNumber = (a: number | null, b: number | null, desc: boolean) => {
    // Unrated/undated entries always sink to the bottom regardless of direction;
    // surfacing them first on an ascending sort is never what the user meant.
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return desc ? b - a : a - b;
  };

  switch (sort) {
    case 'popularity.asc':
      return copy.sort((a, b) => a.popularity - b.popularity);
    case 'popularity.desc':
      return copy.sort((a, b) => b.popularity - a.popularity);
    case 'vote_average.asc':
      return copy.sort((a, b) => byNullableNumber(a.rating, b.rating, false));
    case 'vote_average.desc':
      return copy.sort((a, b) => byNullableNumber(a.rating, b.rating, true));
    case 'vote_count.desc':
      return copy.sort((a, b) => b.voteCount - a.voteCount);
    case 'revenue.desc':
      // Revenue is not present on list payloads; popularity is the closest proxy.
      return copy.sort((a, b) => b.popularity - a.popularity);
    case 'primary_release_date.asc':
      return copy.sort((a, b) => byNullableNumber(a.releaseYear, b.releaseYear, false));
    case 'primary_release_date.desc':
      return copy.sort((a, b) => byNullableNumber(a.releaseYear, b.releaseYear, true));
    case 'title.asc':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'title.desc':
      return copy.sort((a, b) => b.title.localeCompare(a.title));
    default:
      return copy;
  }
}

export async function browseMovies(params: BrowseParams): Promise<CacheResult<Paginated<MovieSummary>>> {
  const isSearch = Boolean(params.q && params.q.trim().length > 0);
  const requestedPage = params.page;
  const page = Math.min(Math.max(1, requestedPage), TMDB_MAX_PAGE);

  const key = browseCacheKey({ ...params, page });

  return getOrLoad(key, CACHE_POLICY.list, async () => {
    const genreMap = await getGenreMap();
    const result = isSearch
      ? await fetchSearchPage({ ...params, page }, genreMap)
      : await fetchDiscoverPage({ ...params, page }, genreMap);

    if (result.dropped > 0) {
      // Upstream drift is worth knowing about, but never worth failing over.
      logger.warn({ dropped: result.dropped, key }, 'Dropped unparseable movies from TMDB page');
    }

    const cappedTotalPages = Math.min(result.totalPages, TMDB_MAX_PAGE);
    const notices: string[] = [];

    if (result.totalPages > TMDB_MAX_PAGE) {
      notices.push(
        `Showing the first ${TMDB_MAX_PAGE * TMDB_PAGE_SIZE} of ${result.totalResults.toLocaleString()} matches. Add a filter to narrow things down.`,
      );
    }

    if (isSearch && (params.genreIds?.length || params.minRating !== undefined)) {
      notices.push('Filters are applied to each page of search results, so some pages may show fewer titles.');
    }

    const payload: Paginated<MovieSummary> = {
      items: result.items,
      page,
      totalPages: cappedTotalPages,
      totalResults: result.totalResults,
      hasMore: page < cappedTotalPages,
    };

    if (notices.length > 0) payload.notice = notices.join(' ');
    return payload;
  });
}

// --- Detail ---------------------------------------------------------------

/** Sentinel stored in the cache so a known-bad id does not re-hit TMDB every time. */
type DetailCacheValue = { found: true; movie: MovieDetail } | { found: false };

export async function getMovieDetail(id: number): Promise<CacheResult<MovieDetail>> {
  const key = `movie:detail:${id}`;

  const result = await getOrLoad<DetailCacheValue>(key, CACHE_POLICY.detail, async () => {
    const genreMap = await getGenreMap();
    try {
      const raw = await tmdbRequest({
        path: `/movie/${id}`,
        // One round trip instead of four. Credits, videos and similar titles all
        // arrive folded into the same response.
        query: { language: LANGUAGE, append_to_response: 'credits,videos,similar' },
      });
      return { found: true, movie: mapMovieDetail(tmdbMovieDetailSchema.parse(raw), genreMap) };
    } catch (error) {
      if (error instanceof TmdbNotFoundError) return { found: false };
      throw error;
    }
  });

  if (!result.value.found) {
    throw AppError.notFound('We could not find that movie.');
  }

  return { value: result.value.movie, status: result.status, stale: result.stale };
}

/**
 * Look up a batch of movies for wishlist snapshot refresh. Failures are tolerated
 * per-id: one dead movie must not fail the whole refresh.
 */
export async function getMovieSummariesByIds(ids: number[]): Promise<Map<number, MovieDetail>> {
  const found = new Map<number, MovieDetail>();
  const settled = await Promise.allSettled(ids.map((id) => getMovieDetail(id)));

  settled.forEach((outcome, index) => {
    const id = ids[index];
    if (id !== undefined && outcome.status === 'fulfilled') found.set(id, outcome.value.value);
  });

  return found;
}

/** Translates transport-level failures into the API's error vocabulary. */
export function toApiError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof TmdbNotFoundError) return AppError.notFound('We could not find that movie.');
  if (error instanceof TmdbUnavailableError) {
    return AppError.upstreamUnavailable(
      'We could not reach the movie service just now. Please try again in a moment.',
      error,
    );
  }
  return new AppError('INTERNAL', 'Something went wrong on our side.', 500, { cause: error });
}
