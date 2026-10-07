import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { OFFLINE_CACHE, cachedFetch } from '../../../utils/offline-query-cache';
import { isOnline } from '../../../services/connectivity';
import { useAuth } from '../../../hooks/useAuth';

const AGREEMENT_CONFIG_URL = '/sales-rep/v1/agreement-config';

export function useGetAgreementConfig(enabled: boolean = true) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  const { data, isLoading, error, isFetching } = useQuery<any>({
    queryKey: ['agreementConfig'],
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
