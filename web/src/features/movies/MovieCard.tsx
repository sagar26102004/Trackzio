import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Poster } from '../../components/ui/Poster';
import type { MovieSummary } from '../../types';

interface MovieCardProps {
  movie: MovieSummary;
  isSaved: boolean;
  onToggleSave: (movie: MovieSummary) => void;
  eager?: boolean;
}

function RatingBadge({ rating }: { rating: number | null }) {
  // A null rating means nobody has voted, which is genuinely different from 0.0.
  // Rendering "NR" is honest; rendering 0.0 would be a lie about the film.
  if (rating === null) {
    return <span className="text-[0.7rem] font-medium text-faint">NR</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-[0.72rem] font-semibold text-brand">
      <span aria-hidden="true">★</span>
      <span>{rating.toFixed(1)}</span>
      <span className="sr-only">out of 10</span>
    </span>
  );
}

/**
 * memo matters here: the grid can hold several hundred cards after a few pages of
 * infinite scroll, and without it every card re-renders each time the wishlist Set
 * identity changes. The props are primitives plus a stable callback, so the
 * comparison is cheap and almost always hits.
 */
export const MovieCard = memo(function MovieCard({ movie, isSaved, onToggleSave, eager }: MovieCardProps) {
  return (
    <article className="group relative">
      <Link
        to={`/movie/${movie.id}`}
        // The card is a link, so the whole surface is one keyboard stop and the
        // browser gives us hover/focus and open-in-new-tab for free.
        className="block rounded-[--radius-card] focus-visible:outline-2"
        // Restoring context on the way back is the router's job, but stating the
        // title here keeps the accessible name useful when the poster is missing.
        aria-label={`${movie.title}${movie.releaseYear ? `, ${movie.releaseYear}` : ''}`}
      >
        <div className="relative">
          <Poster poster={movie.poster} title={movie.title} eager={eager} />
          <div className="pointer-events-none absolute inset-0 rounded-[--radius-card] ring-1 ring-inset ring-white/5 transition group-hover:ring-white/15" />
        </div>

        <div className="mt-2 min-w-0">
          {/* min-w-0 plus line-clamp is what stops a long title from widening its
              grid column or spilling into the next card. */}
          <h3 className="line-clamp-2 text-[0.82rem] font-semibold leading-snug text-content" title={movie.title}>
            {movie.title}
          </h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[0.72rem] text-faint">{movie.releaseYear ?? 'TBA'}</span>
            <span aria-hidden="true" className="text-faint/40">
              ·
            </span>
            <RatingBadge rating={movie.rating} />
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={(event) => {
          // The button sits inside the card's link, so both must be suppressed or
          // saving a movie also navigates away from the grid.
          event.preventDefault();
          event.stopPropagation();
          onToggleSave(movie);
        }}
        aria-pressed={isSaved}
        aria-label={isSaved ? `Remove ${movie.title} from wishlist` : `Add ${movie.title} to wishlist`}
        title={isSaved ? 'Remove from wishlist' : 'Add to wishlist'}
        className={`absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full backdrop-blur-sm transition
          ${isSaved ? 'bg-ink/70 text-heart' : 'bg-ink/50 text-white/70 hover:text-white'}
          /* Always visible on touch, where there is no hover to reveal it. */
          opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100
          ${isSaved ? 'sm:opacity-100' : ''}`}
      >
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z" />
        </svg>
      </button>
    </article>
  );
});
