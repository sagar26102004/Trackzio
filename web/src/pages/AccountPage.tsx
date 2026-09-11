import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Field, FormError, FormSuccess, SubmitButton } from '../components/ui/Form';
import { useChangePassword, useCurrentUser } from '../features/auth/api';
import { ApiError } from '../lib/apiClient';

export function AccountPage() {
  const { data: user, isPending } = useCurrentUser();
  const changePassword = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (isPending) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <div className="skeleton h-7 w-40 rounded" />
      </div>
    );
  }

  // The page is meaningless signed out, and `from` means signing in returns here
  // rather than dumping the user somewhere unrelated.
  if (!user) return <Navigate to="/login" state={{ from: '/account' }} replace />;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    setDone(false);

    // Checked here rather than server-side: confirmation is purely about catching a
    // typo before it becomes a password nobody knows. The server has no business
    // knowing the field exists.
    if (newPassword !== confirmPassword) {
      setLocalError('The two new passwords do not match.');
      return;
    }

    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setDone(true);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        },
      },
    );
  };

  const serverError =
    changePassword.error instanceof ApiError
      ? changePassword.error.message
      : changePassword.error
        ? 'Something went wrong. Please try again.'
        : null;

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Your account</h1>

      <dl className="mt-6 space-y-3 rounded-2xl border border-line-soft bg-surface/60 p-5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-[0.72rem] font-semibold uppercase tracking-wider text-faint">Name</dt>
          <dd className="min-w-0 truncate text-sm">{user.name}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-[0.72rem] font-semibold uppercase tracking-wider text-faint">Email</dt>
          <dd className="min-w-0 truncate text-sm" title={user.email}>
            {user.email}
          </dd>
        </div>
      </dl>

      <h2 className="mt-10 text-lg font-bold tracking-tight">Change password</h2>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        {(localError ?? serverError) && <FormError>{localError ?? serverError}</FormError>}
        {done && <FormSuccess>Password updated. Any other devices have been signed out.</FormSuccess>}

        <Field
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <Field
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          hint="At least 8 characters."
        />
        <Field
          label="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
        />

        <SubmitButton pending={changePassword.isPending}>Update password</SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm">
        <Link to="/wishlist" className="font-semibold text-brand hover:brightness-110">
          Back to your wishlist
        </Link>
      </p>
    </div>
  );
}
