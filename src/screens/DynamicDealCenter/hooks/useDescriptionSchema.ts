import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { OFFLINE_CACHE, cachedFetch } from '../../../utils/offline-query-cache';
import { isOnline } from '../../../services/connectivity';
import { useAuth } from '../../../hooks/useAuth';

/**
 * Per-vertical description schemas that drive the agreement "Description of Work".
 * RN port of web `src/api/description-schema.js`.
 *   list:      GET /sales-rep/v1/description-schema        -> { data: { schemas: [] } }
 *   byProduct: GET /sales-rep/v1/description-schema/:id     -> { data: { schema: {} } }
 * The schema is fed to `evaluateDescriptionSchema(schema, jobState, verticalState)`.
 */

const DESCRIPTION_SCHEMA_LIST_URL = '/sales-rep/v1/description-schema';

export function useGetDescriptionSchemas(enabled: boolean = true) {
  const { data, isLoading, error, isFetching } = useQuery<any>({
    queryKey: ['descriptionSchemas'],
    queryFn: async () => {
      const res = await api.get<any>(DESCRIPTION_SCHEMA_LIST_URL);
      return res.data?.data?.schemas || [];
    },
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
    // ⚠️ Cached PER PRODUCT — the snapshot name carries the product id. One shared key would let a
    // rep who opened Gutters last see Gutters' Description of Work on a Roofing agreement, which
    // is a wrong document rather than a missing one.
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
