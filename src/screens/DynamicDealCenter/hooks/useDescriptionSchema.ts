import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

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
  const { data, isLoading, error, isFetching } = useQuery<any>({
    queryKey: ['descriptionSchema', productId || null],
    queryFn: async () => {
      const res = await api.get<any>(`${DESCRIPTION_SCHEMA_LIST_URL}/${productId}`);
      return res.data?.data?.schema || null;
    },
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
