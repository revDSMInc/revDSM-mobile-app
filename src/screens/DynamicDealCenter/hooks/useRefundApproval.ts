import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlashMessage } from '../../../config/message';
import {
  ApprovalService,
  classifyFundingError,
  type ApprovalRecord,
  type FundingApprovalReminder,
  type FundingRefund,
} from '../../../services/api/FundingService';
import { useAuth } from '../../../hooks/useAuth';
import { approvalIdOf, approverNameOf, normalizeApprovalRows, pickRefundApproval, reminderOf } from '../utils/funding';

/**
 * The approval request behind ONE refund, and whether the rep may chase it yet
 * (REVDSM-1160, `TAYYAB-REFUND-HOLD-AND-REMINDERS.md` §2).
 *
 * ⚠️ **The funding record cannot answer this.** `payment.refunds[]` carries the
 * refund's `state` and its `approvalId`, but the reminder window lives on the
 * APPROVAL row — so it has to be read from `GET /lead/v1/:leadId/approvals`, which is
 * the lead-scoped list (the rep sees their own deal, never the company queue).
 *
 * ⚠️ Before this there was **no approver notification of any kind** — not chat, not
 * push, not email — and the legacy `POST …/resend` only appended a history row, so
 * "remind the approver" would have been a button that did nothing, twice. The real
 * endpoint posts a card in the LEAD CHAT and **adds the approver as a participant on
 * that thread**, which is the delivery mechanism Lance asked for: *"that way it's all
 * associated to forever record."*
 */
export function useRefundApproval(
  leadId?: string,
  refund?: FundingRefund | null,
  companyIdOverride?: string
) {
  const { user } = useAuth();
  // The LEAD's company wins, matching `useFunding` and `useRefundApprovers` — the
  // reminder has to be scoped exactly as the request it chases.
  const companyId = companyIdOverride || user?.companyId;
  const userId = user?._id || user?.id;

  const [sending, setSending] = useState(false);
  /**
   * The window as the last call reported it, adopted from the response so the button
   * flips the moment it is pressed rather than a refetch later.
   *
   * ⚠️ Adopted from the **409 as well as the 200** — a refused reminder is exactly
   * when the rep needs to be told when they may try again.
   */
  const [liveReminder, setLiveReminder] = useState<FundingApprovalReminder | null>(null);

  /**
   * ⚠️ Only asked for once there IS a refund to chase. A lead with no refund has no
   * approval, so the request would be a round trip whose answer is always empty.
   */
  const enabled = !!leadId && !!refund;

  const query = useQuery({
    queryKey: ['leadApprovals', leadId || 'none'],
    queryFn: async (): Promise<ApprovalRecord[]> => {
      try {
        const res = await ApprovalService.forLead(leadId!, companyId, userId);
        const rows = normalizeApprovalRows(res?.data);
        if (__DEV__) console.log('[refundApproval] loaded', rows.length, 'approval row(s)');
        return rows;
      } catch (err: any) {
        // Logged rather than swallowed, for the reason `useRefundApprovers` does it:
        // "never asked" and "asked and rejected" are the two explanations for a
        // missing button and they have completely different fixes.
        if (__DEV__) console.log('[refundApproval] FAILED', err?.response?.status, err?.response?.data || err?.message);
        throw err;
      }
    },
    enabled,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const approval = useMemo(() => pickRefundApproval(query.data, refund), [query.data, refund]);
  const approvalId = approvalIdOf(approval);
  const approverName = approverNameOf(approval);
  // The freshest answer wins: a reminder just sent has moved the window, and the
  // refetch behind it may not have landed.
  const reminder = liveReminder || reminderOf(approval);

  const remind = useCallback(
    async (note?: string): Promise<boolean> => {
      if (!approvalId || sending) return false;
      setSending(true);
      try {
        const res = await ApprovalService.remind(approvalId, note, companyId, userId);
        const body: any = res?.data;
        const next = body?.data?.reminder ?? body?.reminder;
        if (next && typeof next === 'object') setLiveReminder({ ...next, canRemind: next.canRemind === true });
        FlashMessage.success(
          'Reminder sent',
          approverName
            ? `${approverName} has been notified in the lead chat.`
            : 'The approver has been notified in the lead chat.'
        );
        // Reconcile with the server's own row; the adopted window above already
        // moved the button, so a failed refetch costs nothing.
        query.refetch().catch(() => {});
        return true;
      } catch (err: any) {
        const error = classifyFundingError(err);
        // The window rides on the 409 body too, so the button can go straight to
        // "you may try again tomorrow" instead of staying live and failing again.
        if (error.reminder) setLiveReminder({ ...error.reminder, canRemind: error.reminder.canRemind === true });
        /**
         * ⚠️ **A 409 here is NOT a failure to swallow.** It means "too soon", and the
         * server's own `message` names the window ("You already sent a reminder
         * today."). Reported as a WARNING, because nothing is broken and there is
         * nothing for the rep to fix — only to wait. Every other status is a real
         * error.
         */
        if (error.kind === 'remindTooSoon') {
          FlashMessage.warning('Not yet', error.message);
        } else {
          FlashMessage.error('Could not send the reminder', error.message);
        }
        return false;
      } finally {
        setSending(false);
      }
    },
    [approvalId, sending, companyId, userId, approverName, query]
  );

  return {
    approval,
    approvalId,
    approverName,
    reminder,
    /** `false` whenever there is no window to read — a deployment predating the feature. */
    canRemind: !!reminder?.canRemind && !!approvalId,
    sending,
    remind,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
