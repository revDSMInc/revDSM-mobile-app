import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import {
  normalizeCommissionConfig,
  DEFAULT_PAYOUT_CONFIG,
  type CommissionConfig,
  type PayoutConfig,
} from '../utils/calculator/commission-config';

const COMMISSION_CONFIG_URL = '/company/v1/sales/commission-config';

export const COMMISSION_CONFIG_QUERY_KEY = ['salesCommissionConfig'] as const;

export function useCommissionConfig() {
  const { data, isLoading, isError } = useQuery<CommissionConfig | null>({
    queryKey: COMMISSION_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<any>(COMMISSION_CONFIG_URL);
      return normalizeCommissionConfig(res.data?.data ?? res.data);
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    commissionConfig: data ?? null,
    payoutConfig: (data?.payout as PayoutConfig) || DEFAULT_PAYOUT_CONFIG,
    isCommissionConfigLoading: isLoading,
    isCommissionConfigError: isError,
  };
}

export async function fetchCommissionConfig(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<CommissionConfig | null> {
  try {
    const cached = queryClient.getQueryData<CommissionConfig | null>(COMMISSION_CONFIG_QUERY_KEY);
    if (cached !== undefined) return cached ?? null;

    return await queryClient.fetchQuery<CommissionConfig | null>({
      queryKey: COMMISSION_CONFIG_QUERY_KEY,
      queryFn: async () => {
        const res = await api.get<any>(COMMISSION_CONFIG_URL);
        return normalizeCommissionConfig(res.data?.data ?? res.data);
      },
      staleTime: 5 * 60 * 1000,
    });
  } catch (e: any) {
    console.warn('[commissionConfig] read failed, using legacy ladder:', e?.message || e);
    return null;
  }
}
