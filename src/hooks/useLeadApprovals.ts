import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlashMessage } from '../config/message';
import {
  ApprovalService,
  classifyFundingError,
  type ApprovalRecord,
  type FundingApprovalReminder,
} from '../services/api/FundingService';
import { useAuth } from './useAuth';
import {
  approvalIdOf,
  approverNameOf,
  normalizeApprovalRows,
  outstandingApprovals,
  reminderOf,
} from '../screens/DynamicDealCenter/utils/funding';

export function useLeadApprovals(leadId?: string, enabled = true, companyIdOverride?: string) {
  const { user } = useAuth();
  const companyId = companyIdOverride || user?.companyId;
  const userId = user?._id || user?.id;

  const [sendingId, setSendingId] = useState<string | null>(null);
  const [liveReminders, setLiveReminders] = useState<Record<string, FundingApprovalReminder>>({});

  const query = useQuery({
    queryKey: ['leadApprovals', leadId || 'none'],
    queryFn: async (): Promise<ApprovalRecord[]> => {
      try {
        const res = await ApprovalService.forLead(leadId!, companyId, userId);
        const rows = normalizeApprovalRows(res?.data);
        if (__DEV__) console.log('[leadApprovals] loaded', rows.length, 'approval row(s)');
        return rows;
      } catch (err: any) {
        if (__DEV__) console.log('[leadApprovals] FAILED', err?.response?.status, err?.response?.data || err?.message);
        throw err;
      }
    },
    enabled: enabled && !!leadId,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const approvals = useMemo(() => query.data || [], [query.data]);
  const outstanding = useMemo(() => outstandingApprovals(approvals), [approvals]);

  const reminderFor = useCallback(
    (approval?: ApprovalRecord | null): FundingApprovalReminder | null =>
      liveReminders[approvalIdOf(approval)] || reminderOf(approval),
    [liveReminders]
  );

  const remind = useCallback(
    async (approvalId: string, note?: string): Promise<boolean> => {
      if (!approvalId || sendingId) return false;
      setSendingId(approvalId);
      const who = approverNameOf(approvals.find((a) => approvalIdOf(a) === approvalId));
      try {
        const res = await ApprovalService.remind(approvalId, note, companyId, userId);
        const body: any = res?.data;
        const next = body?.data?.reminder ?? body?.reminder;
        if (next && typeof next === 'object') {
          setLiveReminders((cur) => ({ ...cur, [approvalId]: { ...next, canRemind: next.canRemind === true } }));
        }
        FlashMessage.success(
          'Reminder sent',
          who ? `${who} has been notified in the lead chat.` : 'The approver has been notified in the lead chat.'
        );
        query.refetch().catch(() => {});
        return true;
      } catch (err: any) {
        const error = classifyFundingError(err);
        if (error.reminder) {
          setLiveReminders((cur) => ({
            ...cur,
            [approvalId]: { ...error.reminder!, canRemind: error.reminder!.canRemind === true },
          }));
        }
        if (error.kind === 'remindTooSoon') FlashMessage.warning('Not yet', error.message);
        else FlashMessage.error('Could not send the reminder', error.message);
        return false;
      } finally {
        setSendingId(null);
      }
    },
    [sendingId, companyId, userId, approvals, query]
  );

  return {
    approvals,
    outstanding,
    reminderFor,
    remind,
    sendingId,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
