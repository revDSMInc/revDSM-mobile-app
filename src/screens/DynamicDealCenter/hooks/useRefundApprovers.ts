import { useQuery } from '@tanstack/react-query';
import { ApprovalService, type ApproverFeed } from '../../../services/api/FundingService';
import { useAuth } from '../../../hooks/useAuth';
import { normalizeApproverFeed } from '../utils/funding';

export function useRefundApprovers(enabled = true, companyIdOverride?: string) {
  const { user } = useAuth();
  const companyId = companyIdOverride || user?.companyId;
  const userId = user?._id || user?.id;

  const query = useQuery({
    queryKey: ['refundApprovers', companyId || 'none'],
    queryFn: async (): Promise<ApproverFeed> => {
      try {
        const res = await ApprovalService.approvers('refund', companyId, userId);
        const feed = normalizeApproverFeed(res?.data);
        if (__DEV__) {
          console.log('[refundApprovers] loaded', feed.approvers.length, 'approver(s)', {
            isConfigured: feed.isConfigured,
            allowSelfApproval: feed.allowSelfApproval,
            roles: feed.roles.length,
          });
        }
        return feed;
      } catch (err: any) {
        if (__DEV__) {
          console.log('[refundApprovers] FAILED', err?.response?.status, err?.response?.data || err?.message);
        }
        throw err;
      }
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const approvers = query.data?.approvers || [];

  return {
    feed: query.data || null,
    approvers,
    isConfigured: query.isSuccess && query.data?.isConfigured === true,
    allowSelfApproval: query.data?.allowSelfApproval === true,
    isLoading: query.isLoading || (query.isFetching && approvers.length === 0),
    isError: query.isError,
    refetch: query.refetch,
  };
}
