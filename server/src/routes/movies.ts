import { Router, type Response } from 'express';
import { z } from 'zod';
import type { CacheResult } from '../cache/index.js';
import { SORT_OPTIONS } from '../domain/types.js';
import { browseMovies, getGenres, getMovieDetail, toApiError } from '../services/movieService.js';

export const moviesRouter = Router();

/**
 * Query validation. Every parameter is optional and every one has a sane default,
 * so `/api/movies` with no query at all returns a browsable front page - the brief
 * explicitly wants users to discover something without searching first.
 *
 * `coerce` is doing real work: query strings are always strings, and we want a
 * genuine 400 for `page=banana` rather than a silent NaN that becomes page 1.
 */
const browseQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  genres: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((part) => Number.parseInt(part.trim(), 10))
            .filter((n) => Number.isInteger(n) && n > 0)
        : undefined,
    ),
  year: z.coerce.number().int().min(1874).max(2200).optional(),
  minRating: z.coerce.number().min(0).max(10).optional(),
  sort: z.enum(SORT_OPTIONS).default('popularity.desc'),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Cache visibility on the wire. `X-Cache` is genuinely useful when demonstrating
 * or debugging the caching layer, and `Cache-Control` lets the browser and any CDN
 * in front of us reuse the response too - a third tier we get for free.
 */
function applyCacheHeaders(res: Response, result: CacheResult<unknown>, maxAgeSeconds: number): void {
  res.setHeader('X-Cache', result.status);
  if (result.stale) {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=600`);
  }
}

moviesRouter.get('/genres', async (_req, res) => {
  try {
    const result = await getGenres();
    applyCacheHeaders(res, result, 3600);
    res.json({ items: result.value, stale: result.stale });
  } catch (error) {
    throw toApiError(error);
  }
});

moviesRouter.get('/movies', async (req, res) => {
  const params = browseQuerySchema.parse(req.query);

  try {
    const result = await browseMovies({
      q: params.q,
      genreIds: params.genres,
      year: params.year,
      minRating: params.minRating,
      sort: params.sort,
      page: params.page,
    });

    applyCacheHeaders(res, result, 300);
    res.json({ ...result.value, stale: result.stale });
  } catch (error) {
    throw toApiError(error);
  }
});

moviesRouter.get('/movies/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);

  try {
    const result = await getMovieDetail(id);
    applyCacheHeaders(res, result, 3600);
    res.json({ ...result.value, stale: result.stale });
  } catch (error) {
    throw toApiError(error);
  }
});
