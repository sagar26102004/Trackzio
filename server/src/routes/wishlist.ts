import { Router } from 'express';
import { z } from 'zod';
import type { WishlistEntry } from '../domain/types.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getMovieDetail, toApiError } from '../services/movieService.js';
import { buildPosterUrls, extractImagePath } from '../tmdb/images.js';

export const wishlistRouter = Router();

const addSchema = z.object({ movieId: z.coerce.number().int().positive() });
const idParamSchema = z.object({ movieId: z.coerce.number().int().positive() });

/** A row plus its denormalized snapshot becomes a client-ready entry with no upstream call. */
function toEntry(row: {
  movieId: number;
  title: string;
  posterPath: string | null;
  releaseDate: Date | null;
  voteAverage: number | null;
  addedAt: Date;
}): WishlistEntry {
  return {
    movieId: row.movieId,
    title: row.title,
    poster: buildPosterUrls(row.posterPath),
    releaseYear: row.releaseDate ? row.releaseDate.getUTCFullYear() : null,
    rating: row.voteAverage,
    addedAt: row.addedAt.toISOString(),
  };
}

/**
 * The whole wishlist in one indexed query, backed by @@index([deviceId, addedAt]).
 * Zero TMDB calls: this page loads instantly and keeps working during an upstream
 * outage, which is the entire reason we store a display snapshot alongside the id.
 */
wishlistRouter.get('/wishlist', async (req, res) => {
  const rows = await prisma.wishlistItem.findMany({
    where: { deviceId: req.deviceId },
    orderBy: { addedAt: 'desc' },
    select: {
      movieId: true,
      title: true,
      posterPath: true,
      releaseDate: true,
      voteAverage: true,
      addedAt: true,
    },
  });

  // Private: this response is specific to one device's cookie and must never be
  // held in a shared cache.
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ items: rows.map(toEntry), total: rows.length });
});

/**
 * Add. The snapshot is taken from our own cached detail endpoint, so adding a movie
 * the user is currently looking at costs no upstream call at all.
 *
 * Idempotent by way of @@unique([deviceId, movieId]) plus upsert: double-clicking
 * the heart cannot create two rows or return an error.
 */
wishlistRouter.post('/wishlist', async (req, res) => {
  const { movieId } = addSchema.parse(req.body);

  let snapshot: { title: string; posterPath: string | null; releaseDate: Date | null; voteAverage: number | null };

  try {
    const { value: movie } = await getMovieDetail(movieId);
    snapshot = {
      title: movie.title,
      // Store the bare path, not a full URL: image sizes are a presentation concern
      // and we would have to rewrite every stored row to change them.
      posterPath: extractImagePath(movie.poster?.medium),
      releaseDate: movie.releaseDate ? new Date(`${movie.releaseDate}T00:00:00Z`) : null,
      voteAverage: movie.rating,
    };
  } catch (error) {
    const apiError = toApiError(error);
    // A 404 means the id is not a real movie - a client bug or a stale link.
    if (apiError.code === 'NOT_FOUND') throw apiError;
    // Upstream being down should not block saving something. We record the id and
    // backfill the snapshot the next time the movie is viewed.
    logger.warn({ err: error, movieId }, 'Adding to wishlist without a snapshot; upstream unavailable');
    snapshot = { title: `Movie #${movieId}`, posterPath: null, releaseDate: null, voteAverage: null };
  }

  // Created lazily so anonymous browsing never writes to the database.
  await prisma.device.upsert({
    where: { id: req.deviceId },
    create: { id: req.deviceId },
    update: { lastSeenAt: new Date() },
  });

  const row = await prisma.wishlistItem.upsert({
    where: { deviceId_movieId: { deviceId: req.deviceId, movieId } },
    create: { deviceId: req.deviceId, movieId, ...snapshot },
    // Re-adding refreshes the snapshot but preserves the original addedAt, so the
    // list does not silently reorder itself.
    update: { ...snapshot, syncedAt: new Date() },
    select: {
      movieId: true,
      title: true,
      posterPath: true,
      releaseDate: true,
      voteAverage: true,
      addedAt: true,
    },
  });

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(201).json(toEntry(row));
});

/**
 * Remove. Also idempotent: deleting something already gone returns 204, because
 * the client's intent ("this should not be in my list") is satisfied either way.
 */
wishlistRouter.delete('/wishlist/:movieId', async (req, res) => {
  const { movieId } = idParamSchema.parse(req.params);

  await prisma.wishlistItem.deleteMany({ where: { deviceId: req.deviceId, movieId } });

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(204).end();
});

/** Lightweight membership check so the browse grid can mark saved movies. */
wishlistRouter.get('/wishlist/ids', async (req, res) => {
  const rows = await prisma.wishlistItem.findMany({
    where: { deviceId: req.deviceId },
    select: { movieId: true },
  });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ ids: rows.map((r) => r.movieId) });
});

