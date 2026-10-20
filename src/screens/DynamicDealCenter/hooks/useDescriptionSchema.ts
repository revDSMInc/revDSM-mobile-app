import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { OFFLINE_CACHE, cachedFetch } from '../../../utils/offline-query-cache';
import { isOnline } from '../../../services/connectivity';
import { useAuth } from '../../../hooks/useAuth';

const DESCRIPTION_SCHEMA_LIST_URL = '/sales-rep/v1/description-schema';

/**
 * IMPORTANT: this list is CACHED, like the single-schema hook below it.
 *
 * It feeds `buildInvestmentJobScope`, which turns the rep's entries into the "Includes the
 * Following" lines a customer reads before signing. Without a cache the offline Investment
 * Center fell back to bare category names - "Gutters", "Soffit" - and the whole scope
 * CHANGED once the lead synced. The rep had already shown the short version at the door.
 *
 * The schemas are company configuration: they change rarely and are identical for every lead,
 * so a cached copy is the same text the server would have sent.
 */
export function useGetDescriptionSchemas(enabled: boolean = true) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  const { data, isLoading, error, isFetching } = useQuery<any>({
    queryKey: ['descriptionSchemas'],
    queryFn: () =>
      cachedFetch<any[]>(
        OFFLINE_CACHE.DESCRIPTION_SCHEMA_LIST,
        async () => {
          const res = await api.get<any>(DESCRIPTION_SCHEMA_LIST_URL);
          return res.data?.data?.schemas || [];
        },
        { online: isOnline(), userId },
      ).catch(() => []), // never take the screen down: the panel degrades to category names
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

export function useGetDescriptionSchema(productId?: string) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  const { data, isLoading, error, isFetching } = useQuery<any>({
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
    enabled: Boolean(productId),
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
