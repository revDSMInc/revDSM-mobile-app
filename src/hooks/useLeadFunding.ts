import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FundingService } from '../services/api/FundingService';
import type { FundingPayment } from '../screens/DynamicDealCenter/utils/funding';
import { fundingContractPrice, paymentsFromFunding } from '../utils/contract-refund-summary';

export function useLeadFunding(leadId?: string, enabled = true, companyId?: string) {
  const query = useQuery({
    queryKey: ['leadApprovalsFunding', leadId || 'none'],
    queryFn: async () => (await FundingService.getFunding(leadId!, companyId))?.data,
    enabled: enabled && !!leadId,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const payments = useMemo<FundingPayment[]>(() => paymentsFromFunding(query.data), [query.data]);
  const contractPrice = useMemo(() => fundingContractPrice(query.data), [query.data]);

  return { payments, contractPrice, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}
