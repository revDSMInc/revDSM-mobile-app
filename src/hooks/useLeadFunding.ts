import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FundingService } from '../services/api/FundingService';
import type { FundingPayment } from '../screens/DynamicDealCenter/utils/funding';
import { fundingContractPrice, paymentsFromFunding } from '../utils/contract-refund-summary';

/**
 * The lead's funding record, read-only — `GET /lead/v1/:leadId/funding`.
 *
 * ⚠️ Deliberately NOT `useFunding`. That hook owns the whole action surface (links,
 * charges, decisions, refunds, a socket subscription and an activity-log identity) and
 * is far more than a screen that only wants to READ a figure should mount. This is the
 * narrow read the Lead Center needs.
 *
 * ⚠️ **One query key across every consumer**, so the approvals card and the contract
 * card share a single request and can never disagree about a lead's refunds. Callers
 * gate it themselves — see `JobDocsSection`, which chains it behind the approvals read
 * rather than firing both at once, because this screen's request count is watched.
 */
export function useLeadFunding(leadId?: string, enabled = true, companyId?: string) {
  const query = useQuery({
    queryKey: ['leadApprovalsFunding', leadId || 'none'],
    queryFn: async () => (await FundingService.getFunding(leadId!, companyId))?.data,
    enabled: enabled && !!leadId,
    staleTime: 60 * 1000,
    retry: 1,
  });

  /**
   * ⚠️ **Unwrapped by `paymentsFromFunding`, NEVER by a hand-rolled path here.** The
   * rows live at `data.funding.payments`; the shallow `data.payments` reads as plausible
   * and resolves to NOTHING on the real envelope, which makes every consumer silently
   * render an empty lead. That exact path shipped once — the helper exists so it cannot
   * again, and it is asserted in `contract-refund-summary.test.ts`.
   */
  const payments = useMemo<FundingPayment[]>(() => paymentsFromFunding(query.data), [query.data]);
  /** The record's own contract price — one of the candidates for the "before" figure. */
  const contractPrice = useMemo(() => fundingContractPrice(query.data), [query.data]);

  return { payments, contractPrice, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}
