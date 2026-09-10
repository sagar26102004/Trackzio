import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useWishlistIds } from '../features/wishlist/api';
import { useDebouncedValue } from '../lib/hooks';

/**
 * The search box lives in the header rather than on the browse page so that
 * searching works from anywhere - typing while reading a film's details takes you
 * straight to results instead of forcing a trip back first.
 */
function SearchField() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';

  const [value, setValue] = useState(urlQuery);
  const debounced = useDebouncedValue(value, 350);
  // Guards the effect below from firing on mount, which would rewrite the URL (and
  // clobber other filters) before the user has typed anything.
  const isFirstRun = useRef(true);

  // Keep the field in step when the URL changes underneath us - a back navigation,
  // or the "clear filters" button.
  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (debounced === urlQuery) return;

    const params = new URLSearchParams(location.pathname === '/' ? searchParams : undefined);
    if (debounced.trim()) params.set('q', debounced.trim());
    else params.delete('q');

    // replace on the browse page (a refinement), push from elsewhere (a real
    // navigation the user should be able to undo with the back button).
    navigate({ pathname: '/', search: params.toString() }, { replace: location.pathname === '/' });
    // Intentionally keyed only on the debounced value: including searchParams would
    // re-run this whenever any other filter changed and fight the URL for control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <form
      role="search"
      onSubmit={(event) => event.preventDefault()}
      className="relative min-w-0 flex-1 sm:max-w-md"
    >
      <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
        🔍
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search movies…"
        aria-label="Search movies"
        enterKeyHint="search"
        className="w-full min-w-0 rounded-full border border-line bg-surface-2 py-2 pl-9 pr-9 text-sm text-content placeholder:text-faint transition focus:border-brand"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted transition hover:text-content"
        >
          ✕
        </button>
      )}
    </form>
  );
}

export function Header() {
  const { data: savedIds } = useWishlistIds();
  const count = savedIds?.size ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Trackzio home">
          <span aria-hidden="true" className="text-xl">
            🎞️
          </span>
          {/* The wordmark is decoration on a phone, where header space is scarce. */}
          <span className="hidden text-base font-bold tracking-tight sm:block">Trackzio</span>
        </Link>

        <SearchField />

        <NavLink
          to="/wishlist"
          className={({ isActive }) =>
            `flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${
              isActive
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-line bg-surface-2 text-muted hover:text-content'
            }`
          }
        >
          <span aria-hidden="true">♥</span>
          <span className="hidden sm:block">Wishlist</span>
          {count > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[0.7rem] font-bold text-ink">
              {count}
            </span>
          )}
        </NavLink>
      </div>
    </header>
  );
}
