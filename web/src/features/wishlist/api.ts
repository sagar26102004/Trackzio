import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import type { MovieSummary, WishlistEntry } from '../../types';

export const wishlistKeys = {
  list: () => ['wishlist', 'list'] as const,
  ids: () => ['wishlist', 'ids'] as const,
};

export function useWishlist() {
  return useQuery({
    queryKey: wishlistKeys.list(),
    queryFn: () => apiFetch<{ items: WishlistEntry[]; total: number }>('/api/wishlist'),
    select: (data) => data.items,
  });
}

/**
 * A Set of saved ids, used by every card in the grid to render its heart state.
 * Fetched once and kept in the cache rather than asking per-card, which would be
 * one request per poster.
 */
export function useWishlistIds() {
  return useQuery({
    queryKey: wishlistKeys.ids(),
    queryFn: () => apiFetch<{ ids: number[] }>('/api/wishlist/ids'),
    select: (data) => new Set(data.ids),
    staleTime: 60 * 1000,
  });
}

/**
 * Toggle with optimistic updates.
 *
 * The heart must feel instant: waiting on a round trip before the icon fills makes
 * the whole app feel sluggish. So we write to the cache immediately, snapshot the
 * previous state, and roll back if the server disagrees.
 *
 * Both cached shapes are updated together (the id Set that drives the grid, and the
 * entry list that drives the wishlist page), otherwise the two views disagree until
 * the next refetch.
 */
export function useToggleWishlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ movie, isSaved }: { movie: MovieSummary; isSaved: boolean }) => {
      if (isSaved) {
        await apiFetch<void>(`/api/wishlist/${movie.id}`, { method: 'DELETE' });
        return null;
      }
      return apiFetch<WishlistEntry>('/api/wishlist', {
        method: 'POST',
        body: JSON.stringify({ movieId: movie.id }),
      });
    },

    onMutate: async ({ movie, isSaved }) => {
      // Cancel in-flight refetches so a response from before the toggle cannot land
      // afterwards and clobber the optimistic value.
      await queryClient.cancelQueries({ queryKey: wishlistKeys.ids() });
      await queryClient.cancelQueries({ queryKey: wishlistKeys.list() });

      const previousIds = queryClient.getQueryData<{ ids: number[] }>(wishlistKeys.ids());
      const previousList = queryClient.getQueryData<{ items: WishlistEntry[]; total: number }>(
        wishlistKeys.list(),
      );

      queryClient.setQueryData<{ ids: number[] }>(wishlistKeys.ids(), (old) => {
        const ids = new Set(old?.ids ?? []);
        if (isSaved) ids.delete(movie.id);
        else ids.add(movie.id);
        return { ids: [...ids] };
      });

      queryClient.setQueryData<{ items: WishlistEntry[]; total: number }>(wishlistKeys.list(), (old) => {
        if (!old) return old;
        if (isSaved) {
          const items = old.items.filter((item) => item.movieId !== movie.id);
          return { items, total: items.length };
        }
        const optimistic: WishlistEntry = {
          movieId: movie.id,
          title: movie.title,
          poster: movie.poster,
          releaseYear: movie.releaseYear,
          rating: movie.rating,
          addedAt: new Date().toISOString(),
        };
        const items = [optimistic, ...old.items];
        return { items, total: items.length };
      });

      return { previousIds, previousList };
    },

    onError: (_error, _variables, context) => {
      if (context?.previousIds) queryClient.setQueryData(wishlistKeys.ids(), context.previousIds);
      if (context?.previousList) queryClient.setQueryData(wishlistKeys.list(), context.previousList);
    },

    onSettled: () => {
      // Reconcile with the server once the dust settles - the snapshot it stored may
      // differ from our optimistic guess (a fuller title, a rating we did not have).
      void queryClient.invalidateQueries({ queryKey: wishlistKeys.ids() });
      void queryClient.invalidateQueries({ queryKey: wishlistKeys.list() });
    },
  });
}
