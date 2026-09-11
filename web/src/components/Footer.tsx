/**
 * TMDB attribution.
 *
 * This is not decoration and not optional: TMDB's terms of use require that any
 * application built on their API displays their logo and states that the product
 * is not endorsed or certified by them. Leaving it out would put the app in breach
 * of the terms we agreed to when the API key was issued.
 */
export function Footer() {
  return (
    <footer className="mt-16 border-t border-line-soft bg-surface/40">
      <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-3 px-4 py-8 text-center sm:flex-row sm:justify-between sm:gap-6 sm:px-6 sm:text-left">
        <div className="flex items-center gap-3">
          <a
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="The Movie Database"
            className="shrink-0"
          >
            {/* Served from /public, not hotlinked: TMDB's asset URLs are
                content-hashed and change whenever they redeploy. */}
            <img src="/tmdb.svg" alt="The Movie Database (TMDB)" width={110} height={14} className="h-3.5 w-auto" />
          </a>
        </div>

        <p className="max-w-xl text-xs leading-relaxed text-faint">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>

        <p className="text-xs text-faint">
          Built by Sagar Rathore ·{' '}
          <a
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noreferrer noopener"
            className="transition hover:text-muted"
          >
            Data by TMDB
          </a>
        </p>
      </div>
    </footer>
  );
}
