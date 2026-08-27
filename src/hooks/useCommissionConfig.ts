import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import {
  normalizeCommissionConfig,
  DEFAULT_PAYOUT_CONFIG,
  type CommissionConfig,
  type PayoutConfig,
} from '../utils/calculator/commission-config';

/** Web ref: `src/api/commission-config.js` does not exist yet — this is the first client. */
const COMMISSION_CONFIG_URL = '/company/v1/sales/commission-config';

export const COMMISSION_CONFIG_QUERY_KEY = ['salesCommissionConfig'] as const;

/**
 * The company's commission ladder + payout calendar.
 *
 * ⚠️ Deliberately non-blocking. A miss, an error, or a company that has not
 * configured a ladder all yield `null`, and every consumer falls back to the
 * legacy hardcoded ladder in `utils/calculator/commission-utils.ts`. Nothing in
 * the job-builder submit path may be gated on this request.
 */
export function useCommissionConfig() {
  const { data, isLoading, isError } = useQuery<CommissionConfig | null>({
    queryKey: COMMISSION_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<any>(COMMISSION_CONFIG_URL);
      // The payload nests the config directly under `data` (unlike
      // /company/v1/discount-config/sales, which nests it under `data.config`).
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

/**
 * Read the ladder from OUTSIDE React — for the submit handler, which needs it at
 * the moment it fires rather than at render time.
 *
 * Prefers the cached copy (the screen's `useCommissionConfig` will normally have
 * warmed it) and fetches once if the cache is cold. Returns null on any failure,
 * which is the documented fallback rather than an error state: a job must never
 * fail to reach the job tracker because a config read did.
 */
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
