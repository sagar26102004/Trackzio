import { useEffect, useState } from 'react';
import { useScrollLock } from '../../lib/hooks';
import { SORT_OPTIONS, type BrowseFilters, type Genre, type SortValue } from '../../types';

interface FilterBarProps {
  filters: BrowseFilters;
  genres: Genre[];
  onChange: (next: Partial<BrowseFilters>) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  resultCount: number | null;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1949 }, (_, i) => CURRENT_YEAR - i);
const RATINGS = [9, 8, 7, 6, 5];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[0.8rem] font-medium transition ${
        active
          ? 'border-brand bg-brand text-ink'
          : 'border-line bg-surface-2 text-muted hover:border-line hover:bg-surface-3 hover:text-content'
      }`}
    >
      {children}
    </button>
  );
}

function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | '';
  options: { value: T; label: string }[];
  onChange: (value: T | null) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-faint">{label}</span>
      <select
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') return onChange(null);
          const match = options.find((option) => String(option.value) === raw);
          onChange(match ? match.value : null);
        }}
        className="w-full min-w-0 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-content transition hover:border-line focus:border-brand"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The controls themselves, shared between the desktop bar and the mobile drawer. */
function FilterControls({ filters, genres, onChange }: Pick<FilterBarProps, 'filters' | 'genres' | 'onChange'>) {
  const toggleGenre = (id: number) => {
    const next = filters.genreIds.includes(id)
      ? filters.genreIds.filter((existing) => existing !== id)
      : [...filters.genreIds, id];
    onChange({ genreIds: next });
  };

  return (
    <div className="space-y-5">
      <div>
        <span className="mb-2 block text-[0.68rem] font-semibold uppercase tracking-wider text-faint">
          Genres
        </span>
        <div className="flex flex-wrap gap-2">
          {genres.map((genre) => (
            <Chip key={genre.id} active={filters.genreIds.includes(genre.id)} onClick={() => toggleGenre(genre.id)}>
              {genre.name}
            </Chip>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Year"
          value={filters.year ?? ''}
          options={YEARS.map((year) => ({ value: year, label: String(year) }))}
          onChange={(year) => onChange({ year })}
        />
        <Select
          label="Min rating"
          value={filters.minRating ?? ''}
          options={RATINGS.map((rating) => ({ value: rating, label: `${rating}+` }))}
          onChange={(minRating) => onChange({ minRating })}
        />
      </div>
    </div>
  );
}

export function FilterBar({ filters, genres, onChange, onClear, hasActiveFilters, resultCount }: FilterBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  useScrollLock(drawerOpen);

  // Escape closes the drawer. Expected of anything modal, and cheap to provide.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const activeCount =
    filters.genreIds.length + (filters.year !== null ? 1 : 0) + (filters.minRating !== null ? 1 : 0);

  const sortSelect = (
    <label className="flex items-center gap-2">
      <span className="sr-only">Sort by</span>
      <select
        value={filters.sort}
        onChange={(event) => onChange({ sort: event.target.value as SortValue })}
        className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-content transition hover:border-line focus:border-brand"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className="mb-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-muted">
            {resultCount === null ? (
              <span className="text-faint">Loading…</span>
            ) : (
              <>
                <span className="font-semibold text-content">{resultCount.toLocaleString()}</span>{' '}
                {resultCount === 1 ? 'movie' : 'movies'}
              </>
            )}
          </p>

          <div className="flex items-center gap-2">
            {/* Below `md` the filters move into a drawer: a wall of genre chips
                would otherwise consume most of a phone screen before any posters. */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-content transition hover:bg-surface-3 md:hidden"
            >
              <span aria-hidden="true">⚙</span>
              Filters
              {activeCount > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[0.7rem] font-bold text-ink">
                  {activeCount}
                </span>
              )}
            </button>
            {sortSelect}
          </div>
        </div>

        <div className="hidden md:block">
          <FilterControls filters={filters} genres={genres} onChange={onChange} />
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClear}
            className="text-sm font-medium text-brand transition hover:brightness-110"
          >
            Clear all filters
          </button>
        )}
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Filters</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-muted hover:text-content"
              >
                Done
              </button>
            </div>

            <FilterControls filters={filters} genres={genres} onChange={onChange} />

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setDrawerOpen(false);
                }}
                className="mt-5 w-full rounded-xl border border-line bg-surface-2 py-2.5 text-sm font-semibold text-content"
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
