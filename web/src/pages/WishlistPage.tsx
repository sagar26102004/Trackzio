import { Link } from 'react-router-dom';
import { Poster } from '../components/ui/Poster';
import { ErrorState, SkeletonGrid } from '../components/ui/States';
import { useToggleWishlist, useWishlist } from '../features/wishlist/api';
import { ApiError } from '../lib/apiClient';
import type { MovieSummary, WishlistEntry } from '../types';

/**
 * A wishlist row stores only a display snapshot, not a full movie. Rather than
 * fetch the rest (which would put the wishlist page at the mercy of TMDB being up),
 * we widen the snapshot into the shape the toggle mutation expects. The fields we
 * do not have are only used for the optimistic cache write, which is immediately
 * reconciled against the server.
 */
function toSummary(entry: WishlistEntry): MovieSummary {
  return {
    id: entry.movieId,
    title: entry.title,
    overview: null,
    poster: entry.poster,
    backdropUrl: null,
    releaseDate: null,
    releaseYear: entry.releaseYear,
    rating: entry.rating,
    voteCount: 0,
    genres: [],
    genreIds: [],
    popularity: 0,
  };
}

export function WishlistPage() {
  const { data: items, error, isPending, refetch } = useWishlist();
  const toggleWishlist = useToggleWishlist();

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-xl font-bold tracking-tight sm:text-2xl">Your wishlist</h1>
      <p className="mb-6 text-sm text-muted">
        Saved on this device and kept on our server, so it is still here next time you visit.
      </p>

      {isPending ? (
        <SkeletonGrid count={6} />
      ) : error ? (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'We could not load your wishlist.'}
          onRetry={() => void refetch()}
        />
      ) : !items || items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line-soft bg-surface/60 px-6 py-20 text-center">
          <span aria-hidden="true" className="text-4xl opacity-70">
            ♡
          </span>
          <h2 className="text-lg font-semibold">Nothing saved yet</h2>
          <p className="max-w-sm text-sm leading-relaxed text-muted">
            Tap the heart on any poster to keep it here for later.
          </p>
          <Link
            to="/"
            className="mt-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
          >
            Discover movies
          </Link>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            <span className="font-semibold text-content">{items.length}</span>{' '}
            {items.length === 1 ? 'movie' : 'movies'} saved
          </p>

          <div className="poster-grid">
            {items.map((entry, index) => (
              <article key={entry.movieId} className="group relative">
                <Link to={`/movie/${entry.movieId}`} className="block rounded-card">
                  <Poster poster={entry.poster} title={entry.title} eager={index < 6} />
                  <div className="mt-2 min-w-0">
                    <h2 className="line-clamp-2 text-[0.82rem] font-semibold leading-snug" title={entry.title}>
                      {entry.title}
                    </h2>
                    <div className="mt-1 flex items-center gap-2 text-[0.72rem] text-faint">
                      <span>{entry.releaseYear ?? 'TBA'}</span>
                      {entry.rating !== null && (
                        <>
                          <span aria-hidden="true" className="opacity-40">
                            ·
                          </span>
                          <span className="font-semibold text-brand">★ {entry.rating.toFixed(1)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={() => toggleWishlist.mutate({ movie: toSummary(entry), isSaved: true })}
                  aria-label={`Remove ${entry.title} from wishlist`}
                  title="Remove from wishlist"
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-ink/70 text-heart backdrop-blur-sm transition hover:bg-ink/90"
                >
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
                    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z" />
                  </svg>
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
