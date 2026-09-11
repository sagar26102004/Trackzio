import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { wishlistKeys } from '../wishlist/api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export const authKeys = {
  me: () => ['auth', 'me'] as const,
};

/**
 * The current user, or null when signed out.
 *
 * The server answers 200 with `user: null` rather than 401, so a signed-out visitor
 * is a normal state rather than an error the UI has to special-case.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: authKeys.me(),
    queryFn: () => apiFetch<{ user: AuthUser | null }>('/api/auth/me'),
    select: (data) => data.user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * After any identity change the wishlist belongs to someone else, so its cached
 * data is not just stale but wrong. Removing rather than invalidating matters:
 * invalidate would leave the previous owner's list on screen until the refetch
 * lands, briefly showing one user another user's saved films.
 */
function useIdentityChanged() {
  const queryClient = useQueryClient();

  return (user: AuthUser | null) => {
    queryClient.setQueryData(authKeys.me(), { user });
    queryClient.removeQueries({ queryKey: wishlistKeys.list() });
    queryClient.removeQueries({ queryKey: wishlistKeys.ids() });
  };
}

export function useSignup() {
  const onIdentityChanged = useIdentityChanged();

  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) =>
      apiFetch<{ user: AuthUser }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => onIdentityChanged(data.user),
  });
}

export function useLogin() {
  const onIdentityChanged = useIdentityChanged();

  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiFetch<{ user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => onIdentityChanged(data.user),
  });
}

export function useLogout() {
  const onIdentityChanged = useIdentityChanged();

  return useMutation({
    mutationFn: () => apiFetch<void>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => onIdentityChanged(null),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiFetch<void>('/api/auth/password', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
  });
}
