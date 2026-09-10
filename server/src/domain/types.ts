/**
 * Our domain shapes. Deliberately NOT TMDB's shapes.
 *
 * Everything the client receives is defined here: camelCase, absolute image URLs,
 * resolved genre names, nullable fields made explicit. The client has no knowledge
 * of `poster_path`, of TMDB's image CDN, or of genre ids. That means we could swap
 * the upstream provider without touching a line of frontend code.
 */

export interface PosterUrls {
  small: string;
  medium: string;
  large: string;
}

export interface MovieSummary {
  id: number;
  title: string;
  overview: string | null;
  /** Null when TMDB has no poster for this title - the UI renders a fallback tile. */
  poster: PosterUrls | null;
  backdropUrl: string | null;
  /** ISO yyyy-mm-dd. Null for announced-but-undated films, which TMDB has plenty of. */
  releaseDate: string | null;
  releaseYear: number | null;
  /** 0-10, one decimal. Null when nobody has voted, which is different from 0. */
  rating: number | null;
  voteCount: number;
  genres: string[];
  genreIds: number[];
  popularity: number;
}

export interface CastMember {
  id: number;
  name: string;
  character: string | null;
  profileUrl: string | null;
}

export interface MovieDetail extends MovieSummary {
  tagline: string | null;
  runtimeMinutes: number | null;
  status: string | null;
  originalLanguage: string | null;
  homepage: string | null;
  imdbUrl: string | null;
  budget: number | null;
  revenue: number | null;
  directors: string[];
  writers: string[];
  cast: CastMember[];
  /** A single YouTube trailer, already resolved to a watchable URL. */
  trailer: { name: string; youtubeUrl: string; embedUrl: string } | null;
  similar: MovieSummary[];
}

export interface Genre {
  id: number;
  name: string;
}

/** Envelope for every paginated list the API returns. */
export interface Paginated<T> {
  items: T[];
  page: number;
  totalPages: number;
  totalResults: number;
  hasMore: boolean;
  /** True when this payload came from an expired cache because upstream failed. */
  stale?: boolean;
  /** Human-readable caveat about the result set, e.g. pagination or filter limits. */
  notice?: string;
}

export interface WishlistEntry {
  movieId: number;
  title: string;
  poster: PosterUrls | null;
  releaseYear: number | null;
  rating: number | null;
  addedAt: string;
}

export const SORT_OPTIONS = [
  'popularity.desc',
  'popularity.asc',
  'primary_release_date.desc',
  'primary_release_date.asc',
  'vote_average.desc',
  'vote_average.asc',
  'vote_count.desc',
  'revenue.desc',
  'title.asc',
  'title.desc',
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];
