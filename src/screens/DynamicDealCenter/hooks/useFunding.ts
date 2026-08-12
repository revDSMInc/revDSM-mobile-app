import { useCallback, useRef, useState } from 'react';
import { FlashMessage } from '../../../config/message';
import {
  FundingService,
  classifyFundingError,
  type FundingChannel,
  type FundingDecision,
  type FundingError,
  type FundingRecord,
  type FundingResult,
  type FundingUpsertRow,
} from '../../../services/api/FundingService';

/**
 * useFunding — the single seam between the Result Lead sheet and the Funding API
 * (`FUNDING-MOBILE-API.md`).
 *
 * It owns ONE piece of truth: the funding record the server last returned. Every
 * endpoint answers with the whole record, so every action here simply replaces it
 * and the screen re-renders — there is no local step state to drift, and
 * ⚠️ **nothing in the UI may optimistically tick a step** (spec rule 3).
 *
 * It also centralises the per-status error policy from spec §2.1, which is the
 * part worth getting right once rather than at eleven call sites:
 *
 *   409 → the app's copy is BEHIND the server's. Re-`GET` and re-render; the
 *         action that looked dead usually just works on the next tap.
 *   422 → a business rule said no. Show it; retrying identically cannot help.
 *   400 → a bug in this app. Log it loudly in dev; don't invite a retry.
 *   402 → the processor declined the card. Nothing was collected.
 *   502/503 → NOTHING WAS WRITTEN. Offer another channel, or flag the environment.
 *
 * Every action resolves to `{ ok }` so the caller can sequence on it (send the
 * link only if the URL came back; leave the sheet only if the submit landed)
 * without duplicating the error handling.
 */

/** What an action resolves to. `error` is only present when `ok` is false. */
export interface FundingActionResult<T = void> {
  ok: boolean;
  /** The server's own `message` — already surfaced to the rep by the hook. */
  message?: string;
  data?: T;
  error?: FundingError;
}

const OK = <T,>(message?: string, data?: T): FundingActionResult<T> => ({ ok: true, message, data });

export function useFunding(leadId?: string, companyId?: string) {
  const [record, setRecord] = useState<FundingRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** The pid whose own action is in flight, so only that card shows a spinner. */
  const [busyPid, setBusyPid] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  /**
   * The server's blocker list from a rejected submit. Rendered VERBATIM (spec
   * §5.12) in place of the locally-derived list, because it is authoritative and
   * already itemised and ordered.
   */
  const [serverBlockers, setServerBlockers] = useState<string[] | null>(null);
  /** Set when the server reports it is not in mock mode, so the simulator can say so. */
  const [mockDisabled, setMockDisabled] = useState(false);

  /** Latest record, readable from inside a callback without re-creating it. */
  const recordRef = useRef<FundingRecord | null>(null);
  const apply = useCallback((next: FundingRecord | null | undefined) => {
    if (!next) return;
    recordRef.current = next;
    setRecord(next);
  }, []);

  const refetch = useCallback(async (): Promise<FundingRecord | null> => {
    if (!leadId) return null;
    try {
      const res = await FundingService.getFunding(leadId, companyId);
      const next = res.data?.data?.funding ?? null;
      apply(next);
      return next;
    } catch (e) {
      // A failed refresh must never mask the error that triggered it.
      if (__DEV__) console.warn('[funding] refetch failed', e);
      return null;
    }
  }, [leadId, companyId, apply]);

  /**
   * Report a failure the way its status code says it should be reported, and
   * re-sync the record when the code means "you are looking at a stale copy".
   */
  const report = useCallback(
    async (err: any, context: string): Promise<FundingError> => {
      const error = classifyFundingError(err);

      switch (error.kind) {
        case 'stale':
          // Don't shout — the usual cause is a step that landed elsewhere. Refresh
          // the record and let the screen redraw with what is actually true.
          await refetch();
          FlashMessage.info('Funding updated', error.message);
          break;
        case 'rule':
          FlashMessage.warning(context, error.message);
          break;
        case 'cardDeclined':
          FlashMessage.error('Card declined', error.message);
          break;
        case 'delivery':
          // 502: nothing was written, so the step has NOT advanced.
          FlashMessage.error('Not sent', error.message);
          break;
        case 'noProvider':
          FlashMessage.error('No payment provider', error.message);
          break;
        case 'notFound':
          await refetch();
          FlashMessage.error(context, error.message);
          break;
        case 'bug':
          // A malformed request is ours, not the rep's. Loud in dev, plain outside.
          if (__DEV__) console.error(`[funding] BAD REQUEST during ${context}:`, error.message);
          FlashMessage.error(context, error.message);
          break;
        default:
          FlashMessage.error(context, error.message);
      }
      return error;
    },
    [refetch]
  );

  /**
   * Run one funding call: apply the record it returns, or classify and report the
   * failure. `pid` marks a single card busy rather than the whole screen.
   */
  const run = useCallback(
    async (
      context: string,
      call: () => Promise<any>,
      opts: { pid?: string } = {}
    ): Promise<FundingActionResult<any>> => {
      if (!leadId) return { ok: false, error: { kind: 'bug', message: 'No lead id' } };
      if (opts.pid) setBusyPid(opts.pid);
      try {
        const res = await call();
        apply(res?.data?.data?.funding);
        return OK(res?.data?.message, res?.data?.data);
      } catch (e) {
        const error = await report(e, context);
        return { ok: false, error };
      } finally {
        if (opts.pid) setBusyPid(null);
      }
    },
    [leadId, apply, report]
  );

  // ── reads ────────────────────────────────────────────────────────────────

  /** Open the sheet. Safe on a lead with nothing saved — the server synthesises one. */
  const load = useCallback(async (): Promise<FundingRecord | null> => {
    if (!leadId) return null;
    setIsLoading(true);
    try {
      const res = await FundingService.getFunding(leadId, companyId);
      const next = res.data?.data?.funding ?? null;
      apply(next);
      return next;
    } catch (e) {
      await report(e, 'Funding');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [leadId, companyId, apply, report]);

  /**
   * Re-read a single row. The mutating endpoints all return the whole record, so
   * this is only for reconciling one card without disturbing the rest.
   */
  const refreshPayment = useCallback(
    async (pid: string) => {
      if (!leadId) return null;
      try {
        const res = await FundingService.getPayment(leadId, pid, companyId);
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
    [leadId, companyId, apply, report]
  );

  // ── writes ───────────────────────────────────────────────────────────────

  /**
   * Save the whole pricing screen.
   *
   * ⚠️ `payments` is the COMPLETE list — omitted rows are deleted. A `409` here is
   * usually "you edited a locked row" or "you removed a row with a link sent", and
   * the refresh `report` performs is exactly the right recovery.
   */
  const savePayments = useCallback(
    async (contractPrice: number, payments: FundingUpsertRow[]): Promise<FundingActionResult> => {
      setIsSaving(true);
      try {
        return await run('Save payments', () =>
          FundingService.savePayments(leadId!, { contractPrice, payments }, companyId)
        );
      } finally {
        setIsSaving(false);
      }
    },
    [run, leadId, companyId]
  );

  /**
   * Fetch the hosted-page URL for the send sheet. Marks nothing sent.
   *
   * ⚠️ The url is a bearer credential — it is handed straight to the sheet and
   * never stored, logged or cached.
   */
  const fetchLink = useCallback(
    async (pid: string): Promise<FundingActionResult<{ url: string }>> => {
      const res = await run('Payment link', () => FundingService.getLink(leadId!, pid, companyId), { pid });
      if (!res.ok) return res as FundingActionResult<{ url: string }>;
      return OK(res.message, { url: res.data?.url || '' });
    },
    [run, leadId, companyId]
  );

  /**
   * Record that a send happened → Link Sent.
   *
   * ⚠️ Only call this once the send is REAL: a QR the homeowner confirmed scanning,
   * or a text/email the server actually delivered. On 502/503 nothing is written
   * and `ok` is false, so the caller must not show the link as sent.
   */
  const markLinkSent = useCallback(
    (pid: string, channel: FundingChannel, destination?: string) =>
      run('Send link', () => FundingService.markLinkSent(leadId!, pid, { channel, destination }, companyId), { pid }),
    [run, leadId, companyId]
  );

  /** Ask the processor/lender what happened. The main way card and loan rows advance. */
  const syncPayment = useCallback(
    (pid: string) => run('Sync', () => FundingService.syncPayment(leadId!, pid, companyId), { pid }),
    [run, leadId, companyId]
  );

  /**
   * Sync every row that has something to poll.
   *
   * There is no bulk endpoint, so this fans out per row — sequentially, because
   * each response carries the WHOLE record and parallel writes would race, with
   * the last one home overwriting the others' results.
   */
  const syncAll = useCallback(async (): Promise<FundingActionResult> => {
    const rows = (recordRef.current?.payments || []).filter(
      (p) => (p.type === 'cc' || p.type === 'bank') && p.linkSent
    );
    if (!rows.length) return OK();
    setSyncingAll(true);
    try {
      for (const p of rows) {
        // eslint-disable-next-line no-await-in-loop
        await syncPayment(p.pid);
      }
      return OK();
    } finally {
      setSyncingAll(false);
    }
  }, [syncPayment]);

  /** Processor confirmation, out of band. `sync` is the normal path (spec §5.6). */
  const markCardOnFile = useCallback(
    (pid: string) => run('Card on file', () => FundingService.markCardOnFile(leadId!, pid, companyId), { pid }),
    [run, leadId, companyId]
  );

  /**
   * Record a lender decision reported to the rep directly. Locks the row.
   * In the normal flow the decision arrives through `sync` (spec §5.7).
   */
  const recordDecision = useCallback(
    (pid: string, decision: FundingDecision, approvedAmt?: number) =>
      run('Lender decision', () => FundingService.recordDecision(leadId!, pid, { decision, approvedAmt }, companyId), {
        pid,
      }),
    [run, leadId, companyId]
  );

  /** Activate an approved loan. 409 if declined, undecided, or short and uncovered. */
  const activateLoan = useCallback(
    (pid: string) => run('Activate loan', () => FundingService.activateLoan(leadId!, pid, companyId), { pid }),
    [run, leadId, companyId]
  );

  /**
   * Charge a card on file. ⚠️ Moves real money.
   *
   * `Card already charged` comes back 200 and is treated as success. A 402 leaves
   * the row un-charged, so the rep can genuinely retry.
   */
  const chargeCard = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const res = await run('Charge card', () => FundingService.chargeCard(leadId!, pid, companyId), { pid });
      if (res.ok) FlashMessage.success('Charged', res.message || 'The card was charged.');
      return res;
    },
    [run, leadId, companyId]
  );

  /** Rep attestation that a down-payment check was physically taken. */
  const markCheckCollected = useCallback(
    (pid: string) => run('Collect check', () => FundingService.markCheckCollected(leadId!, pid, companyId), { pid }),
    [run, leadId, companyId]
  );

  /**
   * Submit. On a block the server returns `409` with an itemised `blockers` list,
   * which is stored for verbatim rendering rather than flashed — a toast would
   * scroll away the very list the rep needs to work through.
   */
  const submit = useCallback(async (): Promise<FundingActionResult> => {
    if (!leadId) return { ok: false, error: { kind: 'bug', message: 'No lead id' } };
    setIsSubmitting(true);
    try {
      const res = await FundingService.submitFunding(leadId, companyId);
      apply(res.data?.data?.funding);
      setServerBlockers(null);
      return OK(res.data?.message);
    } catch (e) {
      const error = classifyFundingError(e);
      if (error.blockers?.length) {
        // Not a flash: this is a checklist the rep works through, and it belongs
        // on the screen next to the button that refused.
        setServerBlockers(error.blockers);
        await refetch();
        return { ok: false, error };
      }
      return { ok: false, error: await report(e, 'Submit funding') };
    } finally {
      setIsSubmitting(false);
    }
  }, [leadId, companyId, apply, refetch, report]);

  /**
   * Set the job outcome.
   *
   * ⚠️ `bankDecline` is refused (409) without a logged `Declined` attempt — the UI
   * must not offer it until one exists — and cannot be undone after submission.
   */
  const setResult = useCallback(
    (result: FundingResult) => run('Result', () => FundingService.setResult(leadId!, result, companyId)),
    [run, leadId, companyId]
  );

  /**
   * TEST ONLY — stand in for the homeowner or the lender (spec §10).
   *
   * A `404` here means the server is not in mock mode; that is recorded once so
   * the simulator can explain itself instead of failing on every tap.
   */
  const mockProvider = useCallback(
    async (pid: string, action: 'cardOnFile' | FundingDecision, approvedAmt?: number): Promise<FundingActionResult> => {
      const res = await run(
        'Simulator',
        () => FundingService.mockProvider(leadId!, pid, { action, approvedAmt }, companyId),
        { pid }
      );
      if (!res.ok && res.error?.kind === 'notFound') setMockDisabled(true);
      return res;
    },
    [run, leadId, companyId]
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
    mockDisabled,
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
    chargeCard,
    markCheckCollected,
    submit,
    setResult,
    mockProvider,
  };
}

export type UseFunding = ReturnType<typeof useFunding>;
