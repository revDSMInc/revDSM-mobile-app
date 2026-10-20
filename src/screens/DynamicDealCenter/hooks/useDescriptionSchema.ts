import { useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import api from '../../../services/api';
import { OFFLINE_CACHE, cachedFetch } from '../../../utils/offline-query-cache';
import { isOnline } from '../../../services/connectivity';
import { useAuth } from '../../../hooks/useAuth';

const DESCRIPTION_SCHEMA_LIST_URL = '/sales-rep/v1/description-schema';

export function useGetDescriptionSchemas(enabled: boolean = true) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  const { data, isLoading, error, isFetching } = useQuery<any>({
    queryKey: ['descriptionSchemas'],
    // Through the offline cache: the Investment Center builds its Description of Work from THIS list, and a plain fetch left
    // it with no lines at all once the device lost signal.
    queryFn: () =>
      cachedFetch<any[]>(
        OFFLINE_CACHE.DESCRIPTION_SCHEMA_LIST,
        async () => {
          const res = await api.get<any>(DESCRIPTION_SCHEMA_LIST_URL);
          return res.data?.data?.schemas || [];
        },
        { online: isOnline(), userId }
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return useMemo(
    () => ({
      schemas: data || [],
      schemasLoading: isLoading,
      schemasError: error,
      schemasValidating: isFetching,
    }),
    [data, error, isLoading, isFetching]
  );
}

/** One product's schema, through the offline cache. Shared by the reading hook and the warmer so both use the SAME query key. */
const descriptionSchemaQuery = (productId: string, userId?: string | null) => ({
  queryKey: ['descriptionSchema', productId || null],
  queryFn: () =>
    cachedFetch<any>(
      `${OFFLINE_CACHE.DESCRIPTION_SCHEMA}:${productId}`,
      async () => {
        const res = await api.get<any>(`${DESCRIPTION_SCHEMA_LIST_URL}/${productId}`);
        return res.data?.data?.schema || null;
      },
      { online: isOnline(), userId }
    ),
  staleTime: 5 * 60 * 1000,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

/**
 * Saves every product's description schema while the device still has signal, so an agreement drawn offline (or for a lead
 * created at a door) has its Description of Work lines - including the lighting `[IF]` lines - instead of only the products
 * somebody happened to open online first. Reads and writes go through the same cache `useGetDescriptionSchema` reads.
 */
export function useWarmDescriptionSchemas(productIds: string[]): void {
  const { user } = useAuth();
  const userId = user?._id || user?.id;
  useQueries({
    queries: productIds.map((id) => ({ ...descriptionSchemaQuery(id, userId), enabled: Boolean(id) })),
  });
}

export function useGetDescriptionSchema(productId?: string) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  const { data, isLoading, error, isFetching } = useQuery<any>({
    ...descriptionSchemaQuery(productId || '', userId),
    enabled: Boolean(productId),
  });

  return useMemo(
    () => ({
      schema: data || null,
      schemaLoading: isLoading,
      schemaError: error,
      schemaValidating: isFetching,
    }),
    [data, error, isLoading, isFetching]
  );
}
