import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { OFFLINE_CACHE, cachedFetch } from '../../../utils/offline-query-cache';
import { isOnline } from '../../../services/connectivity';
import { useAuth } from '../../../hooks/useAuth';

/**
 * Agreement layout/config for the dynamic agreement generator.
 * RN port of web `src/api/agreement-config.js` (useGetAgreementConfig).
 *   GET /sales-rep/v1/agreement-config  ->  { data: { config: {...} } }
 * config = { header, styles, contentBlocks[] } — see the agreement blocks.
 */

const AGREEMENT_CONFIG_URL = '/sales-rep/v1/agreement-config';

export function useGetAgreementConfig(enabled: boolean = true) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  const { data, isLoading, error, isFetching } = useQuery<any>({
    queryKey: ['agreementConfig'],
    // Cached per rep so the device can render the agreement at a door with no signal — see
    // OFFLINE_CACHE.AGREEMENT_CONFIG. Offline the fetcher is never called; the saved copy is served,
    // and if there is none the caller degrades exactly as it did before this existed.
    queryFn: () =>
      cachedFetch<any>(
        OFFLINE_CACHE.AGREEMENT_CONFIG,
        async () => {
          const res = await api.get<any>(AGREEMENT_CONFIG_URL);
          return res.data?.data?.config || null;
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
      agreementConfig: data || null,
      agreementConfigLoading: isLoading,
      agreementConfigError: error,
      agreementConfigValidating: isFetching,
    }),
    [data, error, isLoading, isFetching]
  );
}
