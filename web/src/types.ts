/**
 * Mirrors the API's response shapes.
 *
 * These are hand-maintained rather than generated, because the API contract is
 * small and stable and a codegen step would be more machinery than it earns here.
 * The important property is that nothing in this file mentions TMDB: the backend
 * owns that translation, so the UI only ever deals with our own vocabulary.
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
  poster: PosterUrls | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
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
  trailer: { name: string; youtubeUrl: string; embedUrl: string } | null;
  similar: MovieSummary[];
  stale?: boolean;
}

export interface Genre {
  id: number;
  name: string;
}

export interface MoviePage {
  items: MovieSummary[];
  page: number;
  totalPages: number;
  totalResults: number;
  hasMore: boolean;
  stale?: boolean;
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
  { value: 'popularity.desc', label: 'Most popular' },
  { value: 'primary_release_date.desc', label: 'Newest first' },
  { value: 'primary_release_date.asc', label: 'Oldest first' },
  { value: 'vote_average.desc', label: 'Highest rated' },
  { value: 'vote_count.desc', label: 'Most voted' },
  { value: 'revenue.desc', label: 'Highest grossing' },
  { value: 'title.asc', label: 'Title A-Z' },
  { value: 'title.desc', label: 'Title Z-A' },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]['value'];

export const DEFAULT_SORT: SortValue = 'popularity.desc';

/** Filter state that lives in the URL, so every view is shareable and restorable. */
export interface BrowseFilters {
  q: string;
  genreIds: number[];
  year: number | null;
  minRating: number | null;
  sort: SortValue;
}

export const EMPTY_FILTERS: BrowseFilters = {
  q: '',
  genreIds: [],
  year: null,
  minRating: null,
  sort: DEFAULT_SORT,
};
