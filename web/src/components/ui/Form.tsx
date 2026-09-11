import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * Shared form primitives, so every auth form gets the same labelling, error
 * handling and focus treatment without three copies of the same markup.
 */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | undefined;
}

export function Field({ label, hint, error, ...inputProps }: FieldProps) {
  // Generated ids rather than hardcoded ones: the same field can appear twice on a
  // page (a login and a signup form), and duplicate ids break label association.
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.78rem] font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        // Points assistive tech at the hint and the error, so a screen reader
        // announces why a field was rejected instead of just "invalid".
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        className={`w-full rounded-xl border bg-surface-2 px-3.5 py-2.5 text-sm text-content placeholder:text-faint transition focus:border-brand ${
          error ? 'border-heart/60' : 'border-line'
        }`}
        {...inputProps}
      />
      {hint && !error && (
        <p id={hintId} className="text-[0.72rem] text-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[0.72rem] text-heart">
          {error}
        </p>
      )}
    </div>
  );
}

/** A form-level error, announced to assistive tech when it appears. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-heart/30 bg-heart/10 px-3.5 py-2.5 text-sm text-heart"
    >
      {children}
    </p>
  );
}

export function FormSuccess({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-xl border border-brand/30 bg-brand-soft px-3.5 py-2.5 text-sm text-brand">
      {children}
    </p>
  );
}

export function SubmitButton({ children, pending }: { children: ReactNode; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Working…' : children}
    </button>
  );
}
