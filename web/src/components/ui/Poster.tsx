import { useState } from 'react';
import type { PosterUrls } from '../../types';

interface PosterProps {
  poster: PosterUrls | null;
  title: string;
  /** Hint to the browser about the rendered width, so it picks the right srcset entry. */
  sizes?: string;
  eager?: boolean;
  className?: string;
}

/**
 * Handles three of the edge cases the brief calls out, in one place:
 *
 *   different poster dimensions - a fixed 2:3 box with object-cover means TMDB's
 *     occasional 4:3 or square artwork is cropped, never stretched, and never
 *     changes the height of its grid row
 *   missing posters           - a typographic fallback tile instead of a broken
 *     image icon
 *   slow networks             - a shimmering placeholder that occupies the exact
 *     final dimensions, so nothing reflows when the image arrives (no layout shift)
 */
export function Poster({ poster, title, sizes = '(max-width: 640px) 45vw, 11rem', eager = false, className = '' }: PosterProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>(poster ? 'loading' : 'failed');

  // aspect-[2/3] reserves the space before the image exists, which is what actually
  // prevents cumulative layout shift.
  const frame = `relative overflow-hidden rounded-[--radius-card] bg-surface-2 aspect-[2/3] ${className}`;

  if (!poster || status === 'failed') {
    return (
      <div className={frame}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-surface-2 to-surface-3 p-3 text-center">
          <span aria-hidden="true" className="text-2xl opacity-40">
            🎬
          </span>
          <span className="line-clamp-3 text-[0.7rem] font-medium leading-tight text-faint">{title}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={frame}>
      {status === 'loading' && <div className="skeleton absolute inset-0" aria-hidden="true" />}
      <img
        src={poster.medium}
        srcSet={`${poster.small} 185w, ${poster.medium} 342w, ${poster.large} 500w`}
        sizes={sizes}
        alt={`Poster for ${title}`}
        width={342}
        height={513}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('failed')}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          status === 'loaded' ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
