import { z } from 'zod';

/**
 * Tolerant schemas for TMDB payloads.
 *
 * The brief calls out "incomplete or unexpected information" from the external
 * service, and TMDB genuinely does return movies with a null overview, no poster,
 * an empty-string release_date, or a missing vote_average. The rule here is:
 *
 *   a missing OPTIONAL field degrades to null, never throws
 *   a missing REQUIRED field (id, title) makes the record unusable, so it is dropped
 *
 * These helpers use `preprocess` rather than `.nullish().catch()` because the
 * latter infers `T | null | undefined`, which pushes an `undefined` case into every
 * consumer for a value that is conceptually just "absent". Normalising to a plain
 * `T | null` at the boundary keeps the domain types honest.
 */

/** Any non-string, empty string, or whitespace-only string becomes null. */
const looseString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? v : null),
  z.string().nullable(),
);

/** Any non-finite or non-number value becomes null. */
const looseNumber = z.preprocess(
  (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null),
  z.number().nullable(),
);

const looseInt = z.preprocess(
  (v) => (typeof v === 'number' && Number.isInteger(v) ? v : null),
  z.number().int().nullable(),
);

/** A number with a guaranteed fallback, for fields the domain treats as non-null. */
const numberOr = (fallback: number) =>
  z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback), z.number());

const intArrayOrEmpty = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((n) => typeof n === 'number' && Number.isInteger(n)) : []),
  z.array(z.number().int()),
);

const unknownArrayOrEmpty = z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown()));

const genreObjectArray = z.preprocess(
  (v) =>
    Array.isArray(v)
      ? v.filter(
          (g): g is { id: number; name: string } =>
            typeof g === 'object' &&
            g !== null &&
            typeof (g as { id?: unknown }).id === 'number' &&
            typeof (g as { name?: unknown }).name === 'string',
        )
      : [],
  z.array(z.object({ id: z.number().int(), name: z.string() })),
);

export const tmdbMovieSummarySchema = z.object({
  // Only these two are non-negotiable: without them there is nothing to show or link to.
  id: z.number().int(),
  title: z.string().min(1),

  overview: looseString,
  poster_path: looseString,
  backdrop_path: looseString,
  release_date: looseString,
  vote_average: looseNumber,
  vote_count: numberOr(0),
  genre_ids: intArrayOrEmpty,
  popularity: numberOr(0),
});

export type TmdbMovieSummary = z.infer<typeof tmdbMovieSummarySchema>;

/**
 * A page of results. `results` stays as unknown[] and is parsed item-by-item by the
 * caller, so one malformed movie cannot fail the other nineteen on the page.
 */
export const tmdbPageSchema = z.object({
  page: z.preprocess((v) => (typeof v === 'number' && Number.isInteger(v) ? v : 1), z.number().int()),
  results: unknownArrayOrEmpty,
  total_pages: z.preprocess(
    (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0),
    z.number().int().nonnegative(),
  ),
  total_results: z.preprocess(
    (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0),
    z.number().int().nonnegative(),
  ),
});

export type TmdbPage = z.infer<typeof tmdbPageSchema>;

export const tmdbGenreListSchema = z.object({ genres: genreObjectArray });

export const castSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  character: looseString,
  profile_path: looseString,
  order: numberOr(999),
});

export const crewSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  job: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
  department: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
});

export const videoSchema = z.object({
  key: z.string().min(1),
  name: z.preprocess((v) => (typeof v === 'string' && v ? v : 'Trailer'), z.string()),
  site: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
  type: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
  official: z.preprocess((v) => v === true, z.boolean()),
});

/** An appended sub-resource that may be missing entirely. */
const appendedResults = z.preprocess(
  (v) =>
    typeof v === 'object' && v !== null && Array.isArray((v as { results?: unknown }).results)
      ? v
      : { results: [] },
  z.object({ results: unknownArrayOrEmpty }),
);

/**
 * Detail response with append_to_response=credits,videos,similar folded in. Every
 * appended block is optional: if TMDB omits `credits` we render a detail page
 * without a cast list rather than returning a 502.
 */
export const tmdbMovieDetailSchema = tmdbMovieSummarySchema.extend({
  tagline: looseString,
  runtime: looseInt,
  status: looseString,
  original_language: looseString,
  homepage: looseString,
  imdb_id: looseString,
  budget: looseNumber,
  revenue: looseNumber,
  // Detail responses carry full genre objects; list responses carry bare ids.
  genres: genreObjectArray,
  credits: z.preprocess(
    (v) => (typeof v === 'object' && v !== null ? v : { cast: [], crew: [] }),
    z.object({ cast: unknownArrayOrEmpty, crew: unknownArrayOrEmpty }),
  ),
  videos: appendedResults,
  similar: appendedResults,
});

export type TmdbMovieDetail = z.infer<typeof tmdbMovieDetailSchema>;

/**
 * Parse an array of unknowns item-by-item, keeping whatever is valid. Returns the
 * survivors plus how many were dropped, so callers can log upstream drift instead
 * of silently losing data.
 */
export function parseTolerantArray<S extends z.ZodTypeAny>(
  input: readonly unknown[],
  schema: S,
): { items: z.infer<S>[]; dropped: number } {
  const items: z.infer<S>[] = [];
  let dropped = 0;
  for (const raw of input) {
    const result = schema.safeParse(raw);
    if (result.success) items.push(result.data);
    else dropped += 1;
  }
  return { items, dropped };
}
