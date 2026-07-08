import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

/**
 * Agreement layout/config for the dynamic agreement generator.
 * RN port of web `src/api/agreement-config.js` (useGetAgreementConfig).
 *   GET /sales-rep/v1/agreement-config  ->  { data: { config: {...} } }
 * config = { header, styles, contentBlocks[] } — see the agreement blocks.
 */

const AGREEMENT_CONFIG_URL = '/sales-rep/v1/agreement-config';

export function useGetAgreementConfig(enabled: boolean = true) {
  const { data, isLoading, error, isFetching } = useQuery<any>({
    queryKey: ['agreementConfig'],
    queryFn: async () => {
      const res = await api.get<any>(AGREEMENT_CONFIG_URL);
      return res.data?.data?.config || null;
    },
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
