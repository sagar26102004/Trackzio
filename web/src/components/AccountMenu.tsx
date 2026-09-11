import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCurrentUser, useLogout } from '../features/auth/api';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export function AccountMenu() {
  const { data: user, isPending } = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click or Escape. Expected of any menu, and without it the
  // panel sticks around after the user has clearly moved on.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Render nothing rather than a "Sign in" link that flips to an avatar a moment
  // later - a flash of the wrong identity is worse than a beat of nothing.
  if (isPending) return <div className="h-9 w-9 shrink-0" aria-hidden="true" />;

  if (!user) {
    return (
      <Link
        to="/login"
        // Remembers where they were, so signing in returns them here.
        state={{ from: location.pathname + location.search }}
        className="shrink-0 rounded-full border border-line bg-surface-2 px-3.5 py-2 text-sm font-medium text-muted transition hover:text-content"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${user.name}`}
        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface-2 text-[0.75rem] font-bold text-content transition hover:bg-surface-3"
      >
        {initials(user.name)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-xl shadow-black/40"
        >
          <div className="border-b border-line-soft px-4 py-3">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-[0.72rem] text-faint" title={user.email}>
              {user.email}
            </p>
          </div>

          <Link
            to="/wishlist"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-muted transition hover:bg-surface-2 hover:text-content"
          >
            Your wishlist
          </Link>
          <Link
            to="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-muted transition hover:bg-surface-2 hover:text-content"
          >
            Change password
          </Link>

          <button
            type="button"
            role="menuitem"
            disabled={logout.isPending}
            onClick={() => {
              setOpen(false);
              // Land on browse: staying on /account or /wishlist after signing out
              // would bounce through a redirect the user did not ask for.
              logout.mutate(undefined, { onSuccess: () => navigate('/') });
            }}
            className="block w-full border-t border-line-soft px-4 py-2.5 text-left text-sm text-muted transition hover:bg-surface-2 hover:text-content disabled:opacity-60"
          >
            {logout.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
