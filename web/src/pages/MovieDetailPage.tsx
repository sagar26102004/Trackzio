import { Link, useNavigate, useParams } from 'react-router-dom';
import { Poster } from '../components/ui/Poster';
import { ErrorState, StaleNotice } from '../components/ui/States';
import { MovieCard } from '../features/movies/MovieCard';
import { useMovie } from '../features/movies/api';
import { useToggleWishlist, useWishlistIds } from '../features/wishlist/api';
import { ApiError } from '../lib/apiClient';
import type { MovieSummary } from '../types';

function formatRuntime(minutes: number | null): string | null {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

function formatMoney(amount: number | null): string | null {
  if (!amount) return null;
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6" aria-busy="true">
      <div className="skeleton mb-6 h-48 w-full rounded-2xl sm:h-72" />
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="skeleton aspect-[2/3] w-40 shrink-0 rounded-card" />
        <div className="flex-1 space-y-3">
          <div className="skeleton h-7 w-2/3 rounded" />
          <div className="skeleton h-4 w-1/3 rounded" />
          <div className="skeleton h-20 w-full rounded" />
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.68rem] font-semibold uppercase tracking-wider text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-content" title={value}>
        {value}
      </dd>
    </div>
  );
}

export function MovieDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const movieId = Number(id);

  const { data: movie, error, isPending, refetch } = useMovie(movieId);
  const { data: savedIds } = useWishlistIds();
  const toggleWishlist = useToggleWishlist();

  if (isPending) return <DetailSkeleton />;

  if (error) {
    const isMissing = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <ErrorState
          message={
            isMissing
              ? 'We could not find that movie. It may have been removed.'
              : error instanceof ApiError
                ? error.message
                : 'We could not load this movie right now.'
          }
          // A 404 will not resolve itself, so send the user somewhere useful
          // instead of offering a retry that is guaranteed to fail again.
          onRetry={() => (isMissing ? navigate('/') : void refetch())}
        />
      </div>
    );
  }

  const isSaved = savedIds?.has(movie.id) ?? false;
  const runtime = formatRuntime(movie.runtimeMinutes);
  const budget = formatMoney(movie.budget);
  const revenue = formatMoney(movie.revenue);

  const summary: MovieSummary = movie;

  return (
    <article className="pb-16">
      {/* Backdrop fades into the page background so the seam is invisible at any
          aspect ratio, rather than ending in a hard edge on wide screens. */}
      <div className="relative h-52 w-full overflow-hidden sm:h-80 lg:h-[26rem]">
        {movie.backdropUrl ? (
          <img
            src={movie.backdropUrl}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-surface-2 to-surface-3" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-ink/20" />
      </div>

      <div className="mx-auto -mt-24 max-w-[1200px] px-4 sm:-mt-32 sm:px-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2/80 px-3 py-1.5 text-sm text-muted backdrop-blur transition hover:text-content"
        >
          <span aria-hidden="true">←</span> Back
        </button>

        {movie.stale && <StaleNotice />}

        <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
          <div className="w-32 shrink-0 sm:w-48 lg:w-56">
            <Poster poster={movie.poster} title={movie.title} eager sizes="(max-width: 640px) 8rem, 14rem" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{movie.title}</h1>
            {movie.tagline && <p className="mt-2 text-sm italic text-muted sm:text-base">{movie.tagline}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
              {movie.rating !== null ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-brand">
                  ★ {movie.rating.toFixed(1)}
                  <span className="font-normal text-brand/70">({movie.voteCount.toLocaleString()})</span>
                </span>
              ) : (
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-faint">Not rated</span>
              )}
              {movie.releaseYear && <span>{movie.releaseYear}</span>}
              {runtime && <span>{runtime}</span>}
            </div>

            {movie.genres.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {movie.genres.map((genre) => (
                  <li
                    key={genre}
                    className="rounded-full border border-line bg-surface-2 px-3 py-1 text-[0.75rem] text-muted"
                  >
                    {genre}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => toggleWishlist.mutate({ movie: summary, isSaved })}
                aria-pressed={isSaved}
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                  isSaved
                    ? 'border border-heart/40 bg-heart/10 text-heart'
                    : 'bg-brand text-ink hover:brightness-110'
                }`}
              >
                <span aria-hidden="true">{isSaved ? '♥' : '♡'}</span>
                {isSaved ? 'In your wishlist' : 'Add to wishlist'}
              </button>

              {movie.trailer && (
                <a
                  href={movie.trailer.youtubeUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 px-5 py-2.5 text-sm font-semibold text-content transition hover:bg-surface-3"
                >
                  <span aria-hidden="true">▶</span> Watch trailer
                </a>
              )}
            </div>

            {movie.overview && (
              <p className="mt-6 max-w-3xl text-[0.94rem] leading-relaxed text-muted">{movie.overview}</p>
            )}

            {(movie.directors.length > 0 || movie.writers.length > 0 || budget || revenue) && (
              <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {movie.directors.length > 0 && <Fact label="Director" value={movie.directors.join(', ')} />}
                {movie.writers.length > 0 && <Fact label="Writer" value={movie.writers.join(', ')} />}
                {budget && <Fact label="Budget" value={budget} />}
                {revenue && <Fact label="Revenue" value={revenue} />}
              </dl>
            )}
          </div>
        </div>

        {movie.cast.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-lg font-bold tracking-tight">Cast</h2>
            <ul className="rail">
              {movie.cast.map((member) => (
                <li key={member.id} className="w-24 sm:w-28">
                  <div className="aspect-[2/3] overflow-hidden rounded-xl bg-surface-2">
                    {member.profileUrl ? (
                      <img
                        src={member.profileUrl}
                        alt={member.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-xl opacity-30" aria-hidden="true">
                        👤
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[0.75rem] font-medium leading-tight">{member.name}</p>
                  {member.character && (
                    <p className="line-clamp-2 text-[0.7rem] leading-tight text-faint">{member.character}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {movie.similar.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-lg font-bold tracking-tight">More like this</h2>
            <div className="poster-grid">
              {movie.similar.map((similar) => (
                <MovieCard
                  key={similar.id}
                  movie={similar}
                  isSaved={savedIds?.has(similar.id) ?? false}
                  onToggleSave={(target) =>
                    toggleWishlist.mutate({ movie: target, isSaved: savedIds?.has(target.id) ?? false })
                  }
                />
              ))}
            </div>
          </section>
        )}

        {movie.imdbUrl && (
          <p className="mt-10 text-sm text-faint">
            <Link to="/" className="text-brand hover:brightness-110">
              Keep browsing
            </Link>
            {' · '}
            <a href={movie.imdbUrl} target="_blank" rel="noreferrer noopener" className="hover:text-muted">
              View on IMDb
            </a>
          </p>
        )}
      </div>
    </article>
  );
}
