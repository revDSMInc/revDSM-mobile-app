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

/**
 * Every approval request on one lead — `GET /lead/v1/:leadId/approvals`.
 *
 * ⚠️ **TWO segments, always.** `LeadController` owns `GET /lead/v1/:id`, so a bare
 * `/lead/v1/approvals` is ambiguous with a lead whose id is that word and which one wins
 * depends on controller registration order. `/approvals/list`, `/approvals/mine` and
 * `/approvals/approvers` are the company-wide reads; **this** one is the lead-scoped read
 * a rep is entitled to, and the only one that matters on their own deal.
 *
 * Lives in `src/hooks/` rather than beside the deal-edit screen because two screens now
 * read it — the wizard's refund rail and the Lead Center's approvals card — and they
 * share ONE query key so the two can never show a different answer for the same lead,
 * and a reminder sent from one refreshes the other.
 */
export function useLeadApprovals(leadId?: string, enabled = true, companyIdOverride?: string) {
  const { user } = useAuth();
  // The LEAD's company wins where the caller has one, matching `useFunding` and
  // `useRefundApprovers` — a reminder has to be scoped exactly as the request it chases.
  const companyId = companyIdOverride || user?.companyId;
  const userId = user?._id || user?.id;

  /** The approval currently being reminded, so only THAT row spins. */
  const [sendingId, setSendingId] = useState<string | null>(null);
  /**
   * Windows as the last call reported them, keyed by approval id.
   *
   * ⚠️ Adopted from the **409 as well as the 200** — a refused reminder is exactly when
   * the rep needs to be told when they may try again, and the server puts the window on
   * both. Keyed rather than a single value because a lead can carry several approvals.
   */
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
        // Logged rather than swallowed, for the reason `useRefundApprovers` does it:
        // "never asked" and "asked and rejected" are the two explanations for an empty
        // card and they have completely different fixes.
        if (__DEV__) console.log('[leadApprovals] FAILED', err?.response?.status, err?.response?.data || err?.message);
        throw err;
      }
    },
    enabled: enabled && !!leadId,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const approvals = useMemo(() => query.data || [], [query.data]);
  /** Still waiting on somebody — the only rows worth a card. */
  const outstanding = useMemo(() => outstandingApprovals(approvals), [approvals]);

  /**
   * The window for one row: whatever the last call reported, else the row's own.
   *
   * ⚠️ **Never recomputed on the device.** The window is two backend constants (48 h
   * before a first reminder, then one a day) and 48 is the backend's own assumption
   * pending confirmation — serving it is precisely what lets it change with no app
   * release. A client that did its own arithmetic would offer a button the endpoint
   * then refuses.
   */
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
        // Reconcile with the server's own row; the adopted window already moved the
        // button, so a failed refetch costs nothing.
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
        /**
         * ⚠️ **A 409 here is NOT a failure to swallow.** It means "too soon", and the
         * server's own `message` names the window ("You already sent a reminder
         * today."). Reported as a WARNING because nothing is broken and there is nothing
         * for the rep to fix — only to wait. Every other status is a real error.
         */
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
    /** The approval currently being reminded — spin only that row. */
    sendingId,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
