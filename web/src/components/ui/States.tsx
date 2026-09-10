import type { ReactNode } from 'react';

/**
 * The four states the brief explicitly asks to be handled, designed once and reused
 * everywhere: loading, empty, error, and degraded (serving cached data).
 */

export function SkeletonGrid({ count = 18 }: { count?: number }) {
  return (
    <div className="poster-grid" aria-busy="true" aria-label="Loading movies">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-2">
          <div className="skeleton aspect-[2/3] w-full rounded-[--radius-card]" />
          <div className="skeleton h-3 w-4/5 rounded" />
          <div className="skeleton h-2.5 w-2/5 rounded" />
        </div>
      ))}
    </div>
  );
}

interface MessageStateProps {
  icon: string;
  title: string;
  description: string;
  action?: ReactNode;
}

function MessageState({ icon, title, description, action }: MessageStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line-soft bg-surface/60 px-6 py-16 text-center">
      <span aria-hidden="true" className="text-4xl opacity-70">
        {icon}
      </span>
      <h2 className="text-lg font-semibold text-content">{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <MessageState
      icon="🔍"
      title="No movies match those filters"
      // An empty state that only says "nothing found" leaves the user stuck. Naming
      // the likely cause and offering the fix is the difference between a dead end
      // and a recoverable one.
      description={
        hasFilters
          ? 'Try removing a genre, widening the year, or lowering the minimum rating.'
          : 'We could not find anything to show here. Try a different search.'
      }
      action={
        hasFilters ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
          >
            Clear all filters
          </button>
        ) : null
      }
    />
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <MessageState
      icon="⚠️"
      title="Something went wrong"
      description={message}
      action={
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-line bg-surface-2 px-5 py-2 text-sm font-semibold text-content transition hover:bg-surface-3"
        >
          Try again
        </button>
      }
    />
  );
}

/**
 * Shown when the backend answered from an expired cache because TMDB was
 * unreachable. Deliberately quiet: the content is still useful, so this is an
 * explanatory note, not an error.
 */
export function StaleNotice() {
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-xl border border-brand/25 bg-brand-soft px-4 py-2.5 text-sm text-brand"
    >
      <span aria-hidden="true">⏳</span>
      <span>Showing saved results — we could not reach the movie service just now.</span>
    </div>
  );
}

/** A caveat about the result set itself, e.g. pagination or filter limits. */
export function NoticeBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-line-soft bg-surface/70 px-4 py-2.5 text-sm text-muted">
      {children}
    </div>
  );
}
