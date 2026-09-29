import { useCallback, useMemo } from 'react';
import type { FundingRefund } from '../../../services/api/FundingService';
import { useLeadApprovals } from '../../../hooks/useLeadApprovals';
import { approvalIdOf, approverNameOf, pickRefundApproval } from '../utils/funding';

/**
 * The approval request behind ONE refund, and whether the rep may chase it yet
 * (REVDSM-1160, `TAYYAB-REFUND-HOLD-AND-REMINDERS.md` §2).
 *
 * ⚠️ **The funding record cannot answer this.** `payment.refunds[]` carries the refund's
 * `state` and its `approvalId`, but the reminder WINDOW lives on the approval row — so it
 * comes from `GET /lead/v1/:leadId/approvals`, the lead-scoped list (the rep sees their
 * own deal, never the company queue).
 *
 * A thin selector over `useLeadApprovals`, which owns the request. They share ONE query
 * key, so the wizard's rail and the Lead Center's approvals card can never disagree about
 * a lead, and a reminder sent from either refreshes both.
 */
export function useRefundApproval(
  leadId?: string,
  refund?: FundingRefund | null,
  companyIdOverride?: string
) {
  /**
   * ⚠️ Only asked for once there IS a refund to chase — a lead with none has no approval,
   * so the request would be a round trip whose answer is always empty.
   */
  const feed = useLeadApprovals(leadId, !!refund, companyIdOverride);

  const approval = useMemo(() => pickRefundApproval(feed.approvals, refund), [feed.approvals, refund]);
  const approvalId = approvalIdOf(approval);
  const approverName = approverNameOf(approval);
  const reminder = feed.reminderFor(approval);

  const remind = useCallback(
    (note?: string) => feed.remind(approvalId, note),
    [feed, approvalId]
  );

  return {
    approval,
    approvalId,
    approverName,
    reminder,
    /** `false` whenever there is no window to read — a deployment predating the feature. */
    canRemind: !!reminder?.canRemind && !!approvalId,
    sending: feed.sendingId === approvalId && !!approvalId,
    remind,
    isLoading: feed.isLoading,
    refetch: feed.refetch,
  };
}
