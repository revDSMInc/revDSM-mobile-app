import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashMessage } from '../../../config/message';
import SocketManager from '../../../services/SocketManager';
import {
  ApprovalService,
  FundingService,
  classifyFundingError,
  type FundingChannel,
  type FundingDecision,
  type FundingError,
  type FundingPaymentRow,
  type FundingRecord,
  type FundingRefundMethod,
  type FundingRefundReason,
  type FundingResult,
  type FundingUpsertRow,
  type SettledAction,
} from '../../../services/api/FundingService';
import {
  logFundingCardCharged,
  logFundingCardOnFile,
  logFundingCheckCollected,
  logFundingLinkRequested,
  logFundingLinkSent,
  logFundingLoanActivated,
  logFundingLoanReactivated,
  logFundingPlanRestored,
  logFundingPaymentSynced,
  logFundingPaymentsSaved,
  logFundingResultChanged,
  logFundingSubmitted,
  logFundingSyncAll,
  type FundingLogBase,
  type FundingLogPayment,
  type FundingSource,
} from '../../../utils/activity-log/funding-log';
import { isReissue } from '../utils/funding';
import { LeadService } from '../../../services/api/leads';
import { isNetworkError, shouldAnnounceFailure } from '../../../utils/network-error';
import { leadReachableOnServer } from '../../../utils/lead-server-ready';
import { LEAD_NOT_SYNCED_MESSAGE } from '../../../utils/lead-sync-state';
import { getRawPhoneNumber } from '../../../utils/phone-util';

export interface FundingActionResult<T = void> {
  ok: boolean;
  message?: string;
  data?: T;
  error?: FundingError;
}

const OK = <T,>(message?: string, data?: T): FundingActionResult<T> => ({ ok: true, message, data });

export interface FundingLogContext {
  userId?: string;
  calculatorId?: string;
  calculatorTitle?: string;
  source?: FundingSource;
  customerId?: string;
}

export function useFunding(leadId?: string, companyId?: string, logCtx?: FundingLogContext) {
  const actorId = logCtx?.userId;
  const customerId = logCtx?.customerId;
  const [record, setRecord] = useState<FundingRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyPid, setBusyPid] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [serverBlockers, setServerBlockers] = useState<string[] | null>(null);
  const [paymentsSetupError, setPaymentsSetupError] = useState<string | null>(null);

  const logBase: FundingLogBase = useMemo(
    () => ({
      userId: logCtx?.userId,
      leadId,
      calculatorId: logCtx?.calculatorId,
      calculatorTitle: logCtx?.calculatorTitle,
      source: logCtx?.source,
    }),
    [logCtx?.userId, logCtx?.calculatorId, logCtx?.calculatorTitle, logCtx?.source, leadId]
  );

  const recordRef = useRef<FundingRecord | null>(null);
  const apply = useCallback((next: FundingRecord | null | undefined) => {
    if (!next) return;
    recordRef.current = next;
    setRecord(next);
  }, []);

  useEffect(() => {
    if (!leadId) return;
    const off = SocketManager.on('funding-updated', (payload: any) => {
      const next: FundingRecord | null = payload?.funding ?? payload?.data?.funding ?? payload ?? null;
      if (!next || typeof next !== 'object') return;
      if (String(next.leadId || '') !== String(leadId)) return;
      apply(next);
    });
    return off;
  }, [leadId, apply]);

  const paymentFor = useCallback((pid: string): FundingLogPayment => {
    const p: FundingPaymentRow | undefined = (recordRef.current?.payments || []).find((x) => x.pid === pid);
    return p
      ? { pid: p.pid, method: p.method, type: p.type, kind: p.kind, amount: p.amount }
      : { pid };
  }, []);

  const wasLinkSent = useCallback((pid: string): boolean => {
    const row = (recordRef.current?.payments || []).find((x) => x.pid === pid);
    return !!row?.linkSent;
  }, []);

  const rowFor = useCallback(
    (pid: string): FundingPaymentRow | null =>
      (recordRef.current?.payments || []).find((x) => x.pid === pid) || null,
    []
  );

  const refetch = useCallback(async (): Promise<FundingRecord | null> => {
    if (!leadId || !leadReachableOnServer(leadId)) return null;
    try {
      const res = await FundingService.getFunding(leadId, companyId, actorId);
      const next = res.data?.data?.funding ?? null;
      apply(next);
      return next;
    } catch (e) {
      if (__DEV__) console.warn('[funding] refetch failed', e);
      return null;
    }
  }, [leadId, companyId, actorId, apply]);

  const report = useCallback(
    async (err: any, context: string, isWrite = false): Promise<FundingError> => {
      const error = classifyFundingError(err);

      if (isNetworkError(err)) {
        const offline: FundingError = {
          ...error,
          kind: 'offline',
          message: `${context} needs a connection. Nothing was sent — try again once you have signal.`,
        };
        if (shouldAnnounceFailure(err, isWrite)) {
          FlashMessage.info('Needs a connection', offline.message);
        }
        return offline;
      }

      switch (error.kind) {
        case 'stale':
          await refetch();
          FlashMessage.info('Funding updated', error.message);
          break;
        case 'setupRequired':
          setPaymentsSetupError(error.message);
          FlashMessage.error('Payments not set up', error.message);
          break;
        case 'rule':
          FlashMessage.warning(context, error.message);
          break;
        case 'cardDeclined':
          FlashMessage.error('Card declined', error.message);
          break;
        case 'delivery':
          FlashMessage.error('Not sent', error.message);
          break;
        case 'noProvider':
          FlashMessage.error('No payment provider', error.message);
          break;
        case 'settledOnOtherCalculator':
          FlashMessage.warning('Funding is on another job scope', error.message);
          break;
        case 'scopeNeedsDecision':
        case 'scopeNeedsRefundApproval':
        case 'scopeRefundFirst':
          // The sheet turns these into a prompt; a banner on top of it would be noise.
          break;
        case 'scopeAfterSubmit':
          // Terminal: a signed job needs an addendum. No refetch (nothing changed), no retry.
          // The Result sheet also raises an OK card for it, so this stays quiet there.
          break;
        case 'rowSettled':
        case 'rowRefundInFlight':
        case 'rowHasDecision':
        case 'rowApplicationSent':
        case 'rowHoldsPlans':
          // The server's own sentence says what is in the way. Not a stale record: refetching
          // would reload the rep's rows away and announce "Funding updated".
          FlashMessage.warning(context, error.message);
          break;
        case 'notFound':
          await refetch();
          FlashMessage.error(context, error.message);
          break;
        case 'bug':
          if (__DEV__) console.error(`[funding] BAD REQUEST during ${context}:`, error.message);
          FlashMessage.error(context, error.message);
          break;
        case 'leadNotSynced':
          FlashMessage.info('Saved on your device', error.message);
          break;
        default:
          FlashMessage.error(context, error.message);
      }
      return error;
    },
    [refetch]
  );

  const run = useCallback(
    async (
      context: string,
      call: () => Promise<any>,
      opts: { pid?: string } = {}
    ): Promise<FundingActionResult<any>> => {
      if (!leadId) return { ok: false, error: { kind: 'bug', message: 'No lead id' } };
      if (!leadReachableOnServer(leadId)) {
        const message = `${context} needs a connection. Nothing was sent — try again once you have signal.`;
        FlashMessage.info('Needs a connection', message);
        return { ok: false, error: { kind: 'offline', message } };
      }
      if (opts.pid) setBusyPid(opts.pid);
      try {
        const res = await call();
        apply(res?.data?.data?.funding);
        return OK(res?.data?.message, res?.data?.data);
      } catch (e) {
        const error = await report(e, context, true);
        return { ok: false, error };
      } finally {
        if (opts.pid) setBusyPid(null);
      }
    },
    [leadId, apply, report]
  );

  const load = useCallback(async (): Promise<FundingRecord | null> => {
    if (!leadId || !leadReachableOnServer(leadId)) return null;
    setIsLoading(true);
    setPaymentsSetupError(null);
    try {
      const res = await FundingService.getFunding(leadId, companyId, actorId);
      const next = res.data?.data?.funding ?? null;
      apply(next);
      return next;
    } catch (e) {
      await report(e, 'Funding');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [leadId, companyId, actorId, apply, report]);

  const refreshPayment = useCallback(
    async (pid: string) => {
      if (!leadId || !leadReachableOnServer(leadId)) return null;
      try {
        const res = await FundingService.getPayment(leadId, pid, companyId, actorId);
        const payment = res.data?.data?.payment;
        if (!payment || !recordRef.current) return payment ?? null;
        apply({
          ...recordRef.current,
          payments: recordRef.current.payments.map((p) => (p.pid === pid ? payment : p)),
        });
        return payment;
      } catch (e) {
        await report(e, 'Payment');
        return null;
      }
    },
    [leadId, companyId, actorId, apply, report]
  );

  const savePayments = useCallback(
    async (
      contractPrice: number,
      payments: FundingUpsertRow[],
      payMode = 'split',
      settledAction?: SettledAction
    ): Promise<FundingActionResult<{ refundDue?: number }>> => {
      setIsSaving(true);
      try {
        const res = await run('Save payments', () =>
          FundingService.savePayments(
            leadId!,
            {
              contractPrice,
              payments,
              payMode: payMode === 'upfront' ? 'upfront' : 'split',
              // Lets the server claim (or move) ownership; omitted = leave it untouched.
              ...(logCtx?.calculatorId ? { calculatorId: String(logCtx.calculatorId) } : {}),
              ...(settledAction ? { settledAction } : {}),
            },
            companyId,
            actorId
          )
        );
        logFundingPaymentsSaved({
          ...logBase,
          contractPrice,
          payMode,
          payments: payments.map((p) => ({ kind: p.kind, method: p.method, amount: p.amount })),
          ok: res.ok,
          error: res.error?.message,
        });
        return res;
      } finally {
        setIsSaving(false);
      }
    },
    [run, leadId, companyId, actorId, logBase, logCtx?.calculatorId]
  );

  const fetchLink = useCallback(
    async (pid: string): Promise<FundingActionResult<{ url: string }>> => {
      const payment = paymentFor(pid);
      const resend = wasLinkSent(pid);
      const res = await run('Payment link', () => FundingService.getLink(leadId!, pid, companyId, actorId), { pid });
      logFundingLinkRequested({
        ...logBase,
        payment,
        resend,
        ok: res.ok,
        blocked: res.error?.kind === 'setupRequired',
        error: res.error?.message,
      });
      if (!res.ok) return res as FundingActionResult<{ url: string }>;
      setPaymentsSetupError(null);
      return OK(res.message, { url: res.data?.url || '' });
    },
    [run, leadId, companyId, actorId, logBase, paymentFor, wasLinkSent]
  );

  const markLinkSent = useCallback(
    async (pid: string, channel: FundingChannel, destination?: string): Promise<FundingActionResult<{ reissued: boolean }>> => {
      const payment = paymentFor(pid);
      const wasSent = wasLinkSent(pid);
      const row = rowFor(pid);
      const reissued = !!row && isReissue(row, channel, destination);

      if (reissued && customerId && destination) {
        try {
          await LeadService.updateCustomer(
            customerId,
            channel === 'text'
              ? { phone: getRawPhoneNumber(destination) }
              : { email: destination.trim() }
          );
        } catch (e: any) {
          FlashMessage.warning(
            'Contact not updated',
            'The link will go to the corrected address, but the customer record still has the old one. Fix it in Edit Customer.'
          );
          if (__DEV__) console.warn('[useFunding] customer correction failed:', e?.message || e);
        }
      }

      const res = await run(
        'Send link',
        () => FundingService.markLinkSent(leadId!, pid, { channel, destination }, companyId, actorId),
        { pid }
      );
      logFundingLinkSent({
        ...logBase,
        payment,
        resend: wasSent,
        reissued,
        channel,
        destination: channel === 'qr' ? undefined : destination,
        ok: res.ok,
        error: res.error?.message,
      });
      if (res.ok) setPaymentsSetupError(null);
      return { ...res, data: { reissued } };
    },
    [run, leadId, companyId, actorId, logBase, paymentFor, wasLinkSent, rowFor, customerId]
  );

  const requestRefund = useCallback(
    async (
      pid: string,
      body: {
        amount: number;
        method: FundingRefundMethod;
        reason: FundingRefundReason;
        feeBorne?: 'company' | 'customer';
        note?: string;
        assignedToUserId?: string;
        draftId?: string;
      }
    ): Promise<FundingActionResult> => {
      const res = await run(
        'Request refund',
        () => FundingService.requestRefund(leadId!, pid, body, companyId, actorId),
        { pid }
      );
      return res;
    },
    [run, leadId, companyId, actorId]
  );

  const decideApproval = useCallback(
    async (
      approvalId: string,
      decision: 'approved' | 'declined',
      opts?: { note?: string }
    ): Promise<FundingActionResult> => {
      try {
        const res = await ApprovalService.decide(
          approvalId,
          { decision, ...(opts?.note ? { note: opts.note } : {}) },
          companyId,
          actorId
        );
        const body: any = res?.data?.data ?? res?.data;
        if (body?.funding) apply(body.funding);
        FlashMessage.success(
          decision === 'approved' ? 'Refund approved' : 'Refund declined',
          decision === 'approved'
            ? 'The customer can now sign the addendum. No money has moved yet.'
            : 'The rep will have to raise a new refund.'
        );
        return { ok: true };
      } catch (err: any) {
        const error = classifyFundingError(err);
        FlashMessage.error('Could not record the decision', error.message);
        return { ok: false, error };
      }
    },
    [companyId, actorId, apply]
  );

  const reassignApproval = useCallback(
    async (approvalId: string, toUserId: string, opts?: { note?: string }): Promise<FundingActionResult> => {
      try {
        await ApprovalService.reassign(approvalId, toUserId, opts?.note, companyId, actorId);
        FlashMessage.success('Sent on', 'The request is now with the new approver.');
        return { ok: true };
      } catch (err: any) {
        const error = classifyFundingError(err);
        FlashMessage.error('Could not reassign', error.message);
        return { ok: false, error };
      }
    },
    [companyId, actorId]
  );

  const resendApproval = useCallback(
    async (approvalId: string): Promise<FundingActionResult> => {
      try {
        await ApprovalService.resend(approvalId, companyId, actorId);
        FlashMessage.success('Reminder sent', 'The approver has been nudged again.');
        return { ok: true };
      } catch (err: any) {
        const error = classifyFundingError(err);
        FlashMessage.error('Could not resend', error.message);
        return { ok: false, error };
      }
    },
    [companyId, actorId]
  );

  const syncPayment = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Sync', () => FundingService.syncPayment(leadId!, pid, companyId, actorId), { pid });
      logFundingPaymentSynced({
        ...logBase,
        payment,
        ok: res.ok,
        result: res.message,
        error: res.error?.message,
      });
      return res;
    },
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  const syncAll = useCallback(async (): Promise<FundingActionResult> => {
    const rows = (recordRef.current?.payments || []).filter(
      (p) => (p.type === 'cc' || p.type === 'bank') && p.linkSent
    );
    if (!rows.length) return OK();
    setSyncingAll(true);
    logFundingSyncAll({ ...logBase, paymentCount: rows.length });
    try {
      const res = await run('Sync all', () => FundingService.syncAll(leadId!, companyId, actorId));
      const problems = (res.data as any)?.problems;
      if (res.ok && Array.isArray(problems) && problems.length) {
        FlashMessage.info('Some rows could not be checked', problems.join('\n'));
      }
      return res;
    } finally {
      setSyncingAll(false);
    }
  }, [run, leadId, companyId, actorId, logBase]);

  const reactivateLoan = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const row = (recordRef.current?.payments || []).find((p) => p.pid === pid);
      const from = row?.baseline ?? undefined;
      const to = row?.liveUsage ?? undefined;
      const res = await run('Reactivate loan', () => FundingService.reactivateLoan(leadId!, pid, companyId, actorId), {
        pid,
      });
      logFundingLoanReactivated({ ...logBase, payment, from, to, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  const restoreArchivedPlan = useCallback(
    async (pid: string, archivedId: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const row = (recordRef.current?.payments || []).find((p) => p.pid === pid);
      const restored = (row?.archived || []).find((a) => a.archivedId === archivedId)?.method;
      const displaced = row?.method;
      const res = await run(
        'Restore plan',
        () => FundingService.restoreArchivedPlan(leadId!, pid, archivedId, companyId, actorId),
        { pid }
      );
      logFundingPlanRestored({ ...logBase, payment, restored, displaced, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  const markCardOnFile = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Card on file', () => FundingService.markCardOnFile(leadId!, pid, companyId, actorId), { pid });
      logFundingCardOnFile({ ...logBase, payment, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  const recordDecision = useCallback(
    (pid: string, decision: FundingDecision, approvedAmt?: number) =>
      run('Lender decision', () => FundingService.recordDecision(leadId!, pid, { decision, approvedAmt }, companyId, actorId), {
        pid,
      }),
    [run, leadId, companyId, actorId]
  );

  const activateLoan = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const approvedAmt = (recordRef.current?.payments || []).find((p) => p.pid === pid)?.approvedAmt ?? undefined;
      const res = await run('Activate loan', () => FundingService.activateLoan(leadId!, pid, companyId, actorId), { pid });
      logFundingLoanActivated({
        ...logBase,
        payment,
        approvedAmt: approvedAmt ?? undefined,
        ok: res.ok,
        error: res.error?.message,
      });
      return res;
    },
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  const chargeCard = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Charge card', () => FundingService.chargeCard(leadId!, pid, companyId, actorId), { pid });
      logFundingCardCharged({
        ...logBase,
        payment,
        ok: res.ok,
        declined: res.error?.kind === 'cardDeclined',
        error: res.error?.message,
      });
      if (res.ok) FlashMessage.success('Charged', res.message || 'The card was charged.');
      return res;
    },
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  const markCheckCollected = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Collect check', () => FundingService.markCheckCollected(leadId!, pid, companyId, actorId), {
        pid,
      });
      logFundingCheckCollected({ ...logBase, payment, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  const submit = useCallback(async (): Promise<FundingActionResult> => {
    if (!leadId) return { ok: false, error: { kind: 'bug', message: 'No lead id' } };
    if (!leadReachableOnServer(leadId)) {
      return { ok: false, error: { kind: 'offline', message: LEAD_NOT_SYNCED_MESSAGE } };
    }
    setIsSubmitting(true);
    const submitted = recordRef.current;
    const shape = {
      contractPrice: submitted?.contractPrice ?? 0,
      paymentCount: (submitted?.payments || []).length,
      bankDecline: submitted?.result === 'bankDecline',
    };
    try {
      const res = await FundingService.submitFunding(leadId, companyId, actorId);
      apply(res.data?.data?.funding);
      setServerBlockers(null);
      logFundingSubmitted({ ...logBase, ...shape, ok: true });
      return OK(res.data?.message);
    } catch (e) {
      const error = classifyFundingError(e);
      if (error.blockers?.length) {
        setServerBlockers(error.blockers);
        logFundingSubmitted({ ...logBase, ...shape, ok: false, blockers: error.blockers, error: error.message });
        await refetch();
        return { ok: false, error };
      }
      const reported = await report(e, 'Submit funding', true);
      logFundingSubmitted({ ...logBase, ...shape, ok: false, error: reported.message });
      return { ok: false, error: reported };
    } finally {
      setIsSubmitting(false);
    }
  }, [leadId, companyId, actorId, apply, refetch, report, logBase]);

  const setResult = useCallback(
    async (result: FundingResult): Promise<FundingActionResult> => {
      const res = await run('Result', () => FundingService.setResult(leadId!, result, companyId, actorId));
      logFundingResultChanged({ ...logBase, result, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, actorId, logBase]
  );

  return {
    record,
    payments: record?.payments || [],
    attemptHistory: record?.attemptHistory || [],
    isLoading,
    isSaving,
    isSubmitting,
    busyPid,
    syncingAll,
    serverBlockers,
    clearServerBlockers: () => setServerBlockers(null),
    paymentsSetupError,
    load,
    refetch,
    refreshPayment,
    savePayments,
    fetchLink,
    markLinkSent,
    syncPayment,
    syncAll,
    markCardOnFile,
    recordDecision,
    activateLoan,
    reactivateLoan,
    restoreArchivedPlan,
    requestRefund,
    decideApproval,
    reassignApproval,
    resendApproval,
    chargeCard,
    markCheckCollected,
    submit,
    setResult,
  };
}

export type UseFunding = ReturnType<typeof useFunding>;
