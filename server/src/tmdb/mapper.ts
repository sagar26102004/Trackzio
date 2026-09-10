import type { CastMember, MovieDetail, MovieSummary } from '../domain/types.js';
import { buildBackdropUrl, buildPosterUrls, buildProfileUrl } from './images.js';
import {
  castSchema,
  crewSchema,
  parseTolerantArray,
  tmdbMovieSummarySchema,
  videoSchema,
  type TmdbMovieDetail,
  type TmdbMovieSummary,
} from './schemas.js';

export type GenreMap = ReadonlyMap<number, string>;

function toYear(releaseDate: string | null): number | null {
  if (!releaseDate) return null;
  const year = Number.parseInt(releaseDate.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/**
 * TMDB reports vote_average as 0 both for "rated zero" (which never happens) and
 * for "nobody has rated this yet". Collapsing 0 with no votes to null lets the UI
 * show "Not rated" instead of a misleading 0.0.
 */
function toRating(voteAverage: number | null, voteCount: number): number | null {
  if (voteAverage === null || voteCount === 0) return null;
  if (voteAverage <= 0) return null;
  return Math.round(voteAverage * 10) / 10;
}

export function mapMovieSummary(raw: TmdbMovieSummary, genreMap: GenreMap): MovieSummary {
  const releaseDate = raw.release_date;
  return {
    id: raw.id,
    title: raw.title,
    overview: raw.overview,
    poster: buildPosterUrls(raw.poster_path),
    backdropUrl: buildBackdropUrl(raw.backdrop_path),
    releaseDate,
    releaseYear: toYear(releaseDate),
    rating: toRating(raw.vote_average, raw.vote_count),
    voteCount: raw.vote_count,
    genreIds: raw.genre_ids,
    // Unknown ids are dropped rather than rendered as "Genre 878".
    genres: raw.genre_ids.map((id) => genreMap.get(id)).filter((n): n is string => Boolean(n)),
    popularity: raw.popularity,
  };
}

/** Parses a raw TMDB results array into domain summaries, dropping unusable records. */
export function mapMovieList(
  rawResults: unknown[],
  genreMap: GenreMap,
): { items: MovieSummary[]; dropped: number } {
  const { items, dropped } = parseTolerantArray(rawResults, tmdbMovieSummarySchema);
  return { items: items.map((m) => mapMovieSummary(m, genreMap)), dropped };
}

function mapCast(rawCast: unknown[]): CastMember[] {
  const { items } = parseTolerantArray(rawCast, castSchema);
  return items
    .sort((a, b) => a.order - b.order)
    .slice(0, 12) // Top billing only; a full cast list is noise on a discovery page.
    .map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      profileUrl: buildProfileUrl(c.profile_path),
    }));
}

function namesForJobs(rawCrew: unknown[], jobs: string[]): string[] {
  const { items } = parseTolerantArray(rawCrew, crewSchema);
  const wanted = new Set(jobs);
  // Dedupe: TMDB credits the same person twice when they hold two matching jobs.
  return [...new Set(items.filter((c) => wanted.has(c.job)).map((c) => c.name))];
}

/**
 * Picks the best trailer: official YouTube trailers first, then any YouTube
 * trailer, then any YouTube video at all. Returns null rather than guessing badly.
 */
function pickTrailer(rawVideos: unknown[]): MovieDetail['trailer'] {
  const { items } = parseTolerantArray(rawVideos, videoSchema);
  const youtube = items.filter((v) => v.site.toLowerCase() === 'youtube');
  const candidate =
    youtube.find((v) => v.type === 'Trailer' && v.official) ??
    youtube.find((v) => v.type === 'Trailer') ??
    youtube.find((v) => v.type === 'Teaser') ??
    youtube[0];

  if (!candidate) return null;
  return {
    name: candidate.name,
    youtubeUrl: `https://www.youtube.com/watch?v=${candidate.key}`,
    embedUrl: `https://www.youtube.com/embed/${candidate.key}`,
  };
}

export function mapMovieDetail(raw: TmdbMovieDetail, genreMap: GenreMap): MovieDetail {
  // Detail responses carry full genre objects, so prefer those over the id lookup
  // and use them to enrich the shared map for free.
  const detailGenres = raw.genres.map((g) => g.name);
  const detailGenreIds = raw.genres.map((g) => g.id);

  const base = mapMovieSummary(raw, genreMap);
  const similarRaw = raw.similar.results;

  return {
    ...base,
    genres: detailGenres.length > 0 ? detailGenres : base.genres,
    genreIds: detailGenreIds.length > 0 ? detailGenreIds : base.genreIds,
    tagline: raw.tagline,
    runtimeMinutes: raw.runtime && raw.runtime > 0 ? raw.runtime : null,
    status: raw.status,
    originalLanguage: raw.original_language,
    homepage: raw.homepage,
    imdbUrl: raw.imdb_id ? `https://www.imdb.com/title/${raw.imdb_id}/` : null,
    // TMDB uses 0 for "unknown" on money fields, which would render as "$0".
    budget: raw.budget && raw.budget > 0 ? raw.budget : null,
    revenue: raw.revenue && raw.revenue > 0 ? raw.revenue : null,
    directors: namesForJobs(raw.credits.crew, ['Director']),
    writers: namesForJobs(raw.credits.crew, ['Screenplay', 'Writer', 'Story']),
    cast: mapCast(raw.credits.cast),
    trailer: pickTrailer(raw.videos.results),
    similar: mapMovieList(similarRaw, genreMap).items.slice(0, 12),
  };
}
