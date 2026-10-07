import { useCallback, useMemo } from 'react';
import type { FundingRefund } from '../../../services/api/FundingService';
import { useLeadApprovals } from '../../../hooks/useLeadApprovals';
import { approvalIdOf, approverNameOf, pickRefundApproval } from '../utils/funding';

export function useRefundApproval(
  leadId?: string,
  refund?: FundingRefund | null,
  companyIdOverride?: string
) {
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
    canRemind: !!reminder?.canRemind && !!approvalId,
    sending: feed.sendingId === approvalId && !!approvalId,
    remind,
    isLoading: feed.isLoading,
    refetch: feed.refetch,
  };
}
