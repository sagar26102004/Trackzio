import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Field, FormError, SubmitButton } from '../components/ui/Form';
import { useCurrentUser, useLogin, useSignup } from '../features/auth/api';
import { ApiError } from '../lib/apiClient';

type Mode = 'login' | 'signup';

/**
 * One page for both sign in and create account.
 *
 * Two routes render this with a different `mode`, so each has its own URL and the
 * browser's password manager sees a proper navigation - but the shared layout means
 * switching between them does not feel like leaving the page.
 */
export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user, isPending: userPending } = useCurrentUser();

  const login = useLogin();
  const signup = useSignup();
  const active = mode === 'login' ? login : signup;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Where to land after signing in: back where they came from, or the wishlist,
  // which is the whole reason most people would bother making an account.
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/wishlist';

  if (!userPending && user) return <Navigate to={redirectTo} replace />;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (active.isPending) return;

    const onDone = { onSuccess: () => navigate(redirectTo, { replace: true }) };

    if (mode === 'login') login.mutate({ email, password }, onDone);
    else signup.mutate({ name, email, password }, onDone);
  };

  const error = active.error;
  const message =
    error instanceof ApiError
      ? error.message
      : error
        ? 'Something went wrong. Please try again.'
        : null;

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {mode === 'login' ? 'Sign in' : 'Create your account'}
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        {mode === 'login'
          ? 'Your wishlist will be waiting for you.'
          : 'Anything already on your wishlist comes with you.'}
      </p>

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
        {message && <FormError>{message}</FormError>}

        {mode === 'signup' && (
          <Field
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            maxLength={80}
          />
        )}

        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          // Lets the browser and password managers offer the right saved credential.
          autoComplete="email"
          required
          inputMode="email"
        />

        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          // current-password vs new-password tells a password manager whether to
          // autofill an existing entry or offer to generate and save a new one.
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'signup' ? 8 : undefined}
          {...(mode === 'signup' ? { hint: 'At least 8 characters. Longer beats complicated.' } : {})}
        />

        <SubmitButton pending={active.isPending}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === 'login' ? (
          <>
            No account yet?{' '}
            <Link to="/signup" state={location.state} className="font-semibold text-brand hover:brightness-110">
              Create one
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link to="/login" state={location.state} className="font-semibold text-brand hover:brightness-110">
              Sign in
            </Link>
          </>
        )}
      </p>

      <p className="mt-8 text-center text-xs leading-relaxed text-faint">
        You can browse and build a wishlist without an account — signing in just keeps it with you.
      </p>
    </div>
  );
}
