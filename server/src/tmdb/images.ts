import type { PosterUrls } from '../domain/types.js';

/**
 * TMDB serves images from a CDN with fixed width buckets. We build absolute URLs
 * server-side so the client never has to know the CDN host or the size names -
 * it just gets three URLs and feeds them to a srcset.
 *
 * TMDB exposes these values via /configuration, but they have not changed in years
 * and fetching them adds a startup dependency on an external call. Hardcoding with
 * a comment is the better trade here; if TMDB ever changes it, this is the one file
 * to edit.
 */
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const POSTER_SIZES = { small: 'w185', medium: 'w342', large: 'w500' } as const;
const BACKDROP_SIZE = 'w1280';
const PROFILE_SIZE = 'w185';

export function buildPosterUrls(posterPath: string | null): PosterUrls | null {
  if (!posterPath) return null;
  return {
    small: `${IMAGE_BASE}/${POSTER_SIZES.small}${posterPath}`,
    medium: `${IMAGE_BASE}/${POSTER_SIZES.medium}${posterPath}`,
    large: `${IMAGE_BASE}/${POSTER_SIZES.large}${posterPath}`,
  };
}

export function buildBackdropUrl(backdropPath: string | null): string | null {
  return backdropPath ? `${IMAGE_BASE}/${BACKDROP_SIZE}${backdropPath}` : null;
}

export function buildProfileUrl(profilePath: string | null): string | null {
  return profilePath ? `${IMAGE_BASE}/${PROFILE_SIZE}${profilePath}` : null;
}

/**
 * Inverse of buildPosterUrls: recovers the storable TMDB path from a URL we built.
 * Kept next to the builder so the encode/decode pair can never drift apart.
 *
 * We persist the path rather than a full URL because the size bucket is a
 * presentation decision. Storing "w342" in the database would mean a data migration
 * every time the UI wanted a different resolution.
 */
export function extractImagePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/t\/p\/[^/]+(\/.+)$/.exec(url);
  return match?.[1] ?? null;
}
