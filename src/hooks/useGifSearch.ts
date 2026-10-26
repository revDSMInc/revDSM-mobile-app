import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchGifs, GifItem, isGiphyConfigured } from '../services/api/giphy';

const DEBOUNCE_MS = 350;

export function useGifSearch(query: string, enabled: boolean) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const q = useInfiniteQuery({
    queryKey: ['gifs', debounced],
    queryFn: ({ pageParam, signal }) => fetchGifs(debounced, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: enabled && isGiphyConfigured(),
    staleTime: 5 * 60 * 1000,
  });

  const seen = new Set<string>();
  const items: GifItem[] = [];
  for (const page of q.data?.pages ?? []) {
    for (const g of page.items) {
      if (!seen.has(g.id)) {
        seen.add(g.id);
        items.push(g);
      }
    }
  }

  return {
    items,
    isLoading: q.isLoading || (query.trim() !== debounced && q.isFetching),
    isError: q.isError,
    isFetchingMore: q.isFetchingNextPage,
    hasMore: !!q.hasNextPage,
    loadMore: () => {
      if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
    },
    refetch: q.refetch,
    configured: isGiphyConfigured(),
  };
}
