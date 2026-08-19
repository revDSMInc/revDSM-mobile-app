import { useCallback, useMemo, useRef, useState } from 'react';
import { FlashMessage } from '../../../config/message';
import {
  FundingService,
  classifyFundingError,
  type FundingChannel,
  type FundingDecision,
  type FundingError,
  type FundingPaymentRow,
  type FundingRecord,
  type FundingResult,
  type FundingUpsertRow,
} from '../../../services/api/FundingService';
import {
  logFundingCardCharged,
  logFundingCardOnFile,
  logFundingCheckCollected,
  logFundingLinkRequested,
  logFundingLinkSent,
  logFundingLoanActivated,
  logFundingPaymentSynced,
  logFundingPaymentsSaved,
  logFundingResultChanged,
  logFundingSubmitted,
  logFundingSyncAll,
  type FundingLogBase,
  type FundingLogPayment,
  type FundingSource,
} from '../../../utils/activity-log/funding-log';

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
 *   409 on `…/link` / `…/link-sent` → ⚠️ **the exception.** The company's Stripe
 *         account is connected but cannot take payments yet. Nothing about the
 *         record is stale, so refreshing returns the same answer and a client that
 *         implements the 409 rule above LOOPS. Terminal for now; surface it once,
 *         company-wide, and stop offering the send.
 *   422 → a business rule said no. Show it; retrying identically cannot help.
 *   400 → a bug in this app. Log it loudly in dev; don't invite a retry.
 *   402 → the processor declined the card. Nothing was collected.
 *   502/503 → NOTHING WAS WRITTEN. Offer another channel, or flag the environment.
 *
 * Every action resolves to `{ ok }` so the caller can sequence on it (send the
 * link only if the URL came back; leave the sheet only if the submit landed)
 * without duplicating the error handling.
 *
 * It is also where the **Forever Record** logging for every endpoint-driven action
 * lives (`utils/activity-log/funding-log.ts`). That is deliberate rather than doing
 * it at the call sites: every funding endpoint already funnels through here, so a
 * new action cannot ship unlogged, and — the deciding reason — the outcome only
 * exists here. `sync`'s 200 message is what the lender actually said, and a `402`
 * on a charge is the difference between "the card was charged" and "the card was
 * declined and nothing moved"; a call site sees neither.
 *
 * ⚠️ One thing is deliberately NOT logged: the hosted-page URL, which is a bearer
 * credential scoped to a single payment — see `funding-log.ts`.
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

/**
 * Who is doing this and to which job — stamped on every funding log row.
 *
 * `leadId` is taken from the hook's own argument rather than duplicated here, so
 * the record being written and the record being logged can never disagree.
 */
export interface FundingLogContext {
  userId?: string;
  /** The calculator the sale was resulted from, so the money links back to the quote. */
  calculatorId?: string;
  calculatorTitle?: string;
  /**
   * WHICH FLOW this funding screen was reached through — `rehash` | `sale` |
   * `my_deals`. Composed onto every `meta.action` this hook emits, so the backend
   * can tell the three apart while `module_type` stays `funding` for all of them.
   */
  source?: FundingSource;
}

export function useFunding(leadId?: string, companyId?: string, logCtx?: FundingLogContext) {
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
  /**
   * The company's payment gateway is connected but cannot accept payments yet
   * (`charges_enabled: false`) — the server's own wording, held until a link call
   * succeeds.
   *
   * ⚠️ Held ONCE for the whole screen, not per row: the condition is company-wide,
   * so a job with three card rows would otherwise meet the same message three
   * times. And ⚠️ it is NOT cleared by a refetch — nothing about the record is
   * stale, and someone with portal access has to finish setup in Stripe. The rep
   * cannot fix this at the table, so the screen must stop offering the send rather
   * than inviting a retry that can only fail.
   */
  const [paymentsSetupError, setPaymentsSetupError] = useState<string | null>(null);

  /**
   * The identity every funding log row carries.
   *
   * Memoised on its own fields rather than on `logCtx`, because the caller builds
   * that object inline — depending on its identity would re-create every callback
   * below on every render of the sheet.
   */
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

  /** Latest record, readable from inside a callback without re-creating it. */
  const recordRef = useRef<FundingRecord | null>(null);
  const apply = useCallback((next: FundingRecord | null | undefined) => {
    if (!next) return;
    recordRef.current = next;
    setRecord(next);
  }, []);

  /**
   * The payment a per-row log line is about, read from the record as it stands
   * BEFORE the action runs.
   *
   * ⚠️ Snapshot it up front, never after: every one of these endpoints returns a
   * MUTATED record, so reading afterwards would describe a charged card as
   * "charged" in the very event that says it was charged — and on a failure the row
   * may not come back at all. `pid` alone would identify it, but a timeline row
   * reading `p-yboq8agk` tells the reader nothing.
   */
  const paymentFor = useCallback((pid: string): FundingLogPayment => {
    const p: FundingPaymentRow | undefined = (recordRef.current?.payments || []).find((x) => x.pid === pid);
    return p
      ? { pid: p.pid, method: p.method, type: p.type, kind: p.kind, amount: p.amount }
      : { pid };
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
        case 'setupRequired':
          // ⚠️ Deliberately NO refetch and NO retry affordance. The record is
          // current; the company's Stripe account is not usable. Every other
          // funding error is either transient or the rep's to resolve — this one
          // needs somebody with portal access, so it is framed as "not yours to
          // fix" and remembered for the screen rather than only flashed.
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
    // A fresh open is a fresh chance: the account may have finished onboarding
    // since the sheet was last closed, and the server trusts a `true` for only ten
    // minutes while re-asking on every `false`.
    setPaymentsSetupError(null);
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
    async (
      contractPrice: number,
      payments: FundingUpsertRow[],
      /** Split or upfront — logged with the save, since the rows alone don't say. */
      payMode = 'split'
    ): Promise<FundingActionResult> => {
      setIsSaving(true);
      try {
        const res = await run('Save payments', () =>
          FundingService.savePayments(leadId!, { contractPrice, payments }, companyId)
        );
        // The one row that records what the contract was actually split into, so it
        // carries the whole breakdown — this list IS the deal as filed.
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
    [run, leadId, companyId, logBase]
  );

  /**
   * Fetch the hosted-page URL for the send sheet. Marks nothing sent.
   *
   * ⚠️ The url is a bearer credential — it is handed straight to the sheet and
   * never stored, logged or cached.
   */
  const fetchLink = useCallback(
    async (pid: string): Promise<FundingActionResult<{ url: string }>> => {
      const payment = paymentFor(pid);
      const res = await run('Payment link', () => FundingService.getLink(leadId!, pid, companyId), { pid });
      // ⚠️ The url is NEVER passed to the logger, and `logFundingLinkRequested` does
      // not accept one — it is a bearer credential scoped to this payment.
      logFundingLinkRequested({
        ...logBase,
        payment,
        ok: res.ok,
        blocked: res.error?.kind === 'setupRequired',
        error: res.error?.message,
      });
      if (!res.ok) return res as FundingActionResult<{ url: string }>;
      // A link came back, so the gateway is usable again — the account may have
      // finished onboarding since the last attempt (the server re-asks Stripe on
      // every `false`, precisely so a fixed account is never blocked forever).
      setPaymentsSetupError(null);
      return OK(res.message, { url: res.data?.url || '' });
    },
    [run, leadId, companyId, logBase, paymentFor]
  );

  /**
   * Record that a send happened → Link Sent.
   *
   * ⚠️ Only call this once the send is REAL: a QR the homeowner confirmed scanning,
   * or a text/email the server actually delivered. On 502/503 nothing is written
   * and `ok` is false, so the caller must not show the link as sent.
   */
  const markLinkSent = useCallback(
    async (pid: string, channel: FundingChannel, destination?: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run(
        'Send link',
        () => FundingService.markLinkSent(leadId!, pid, { channel, destination }, companyId),
        { pid }
      );
      logFundingLinkSent({
        ...logBase,
        payment,
        channel,
        // QR transmits nothing, so it has no destination to record (spec §5.4).
        destination: channel === 'qr' ? undefined : destination,
        ok: res.ok,
        error: res.error?.message,
      });
      if (res.ok) setPaymentsSetupError(null);
      return res;
    },
    [run, leadId, companyId, logBase, paymentFor]
  );

  /** Ask the processor/lender what happened. The main way card and loan rows advance. */
  const syncPayment = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Sync', () => FundingService.syncPayment(leadId!, pid, companyId), { pid });
      // ⚠️ `res.message` is the SERVER's own wording — `No change yet`, `Lender
      // approved in full`, `Lender declined`. It is the whole point of this row:
      // the verdict belongs to the third party, so the timeline must carry what
      // THEY said rather than what the app inferred from the record afterwards.
      logFundingPaymentSynced({
        ...logBase,
        payment,
        ok: res.ok,
        result: res.message,
        error: res.error?.message,
      });
      return res;
    },
    [run, leadId, companyId, logBase, paymentFor]
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
    // One row for the sweep itself; each `syncPayment` below logs its own outcome,
    // so the timeline reads "synced all 3" followed by what each of the three said.
    logFundingSyncAll({ ...logBase, paymentCount: rows.length });
    try {
      for (const p of rows) {
        // eslint-disable-next-line no-await-in-loop
        await syncPayment(p.pid);
      }
      return OK();
    } finally {
      setSyncingAll(false);
    }
  }, [syncPayment, logBase]);

  /** Processor confirmation, out of band. `sync` is the normal path (spec §5.6). */
  const markCardOnFile = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Card on file', () => FundingService.markCardOnFile(leadId!, pid, companyId), { pid });
      logFundingCardOnFile({ ...logBase, payment, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, logBase, paymentFor]
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
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      // Captured before the call: on a partial approval the activated figure is the
      // APPROVED one, not the row's `amount`, and it is what the job is funded for.
      const approvedAmt = (recordRef.current?.payments || []).find((p) => p.pid === pid)?.approvedAmt ?? undefined;
      const res = await run('Activate loan', () => FundingService.activateLoan(leadId!, pid, companyId), { pid });
      logFundingLoanActivated({
        ...logBase,
        payment,
        approvedAmt: approvedAmt ?? undefined,
        ok: res.ok,
        error: res.error?.message,
      });
      return res;
    },
    [run, leadId, companyId, logBase, paymentFor]
  );

  /**
   * Charge a card on file. ⚠️ Moves real money.
   *
   * `Card already charged` comes back 200 and is treated as success. A 402 leaves
   * the row un-charged, so the rep can genuinely retry.
   */
  const chargeCard = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Charge card', () => FundingService.chargeCard(leadId!, pid, companyId), { pid });
      // ⚠️ A decline is logged as loudly as a charge, and separately: on a `402` the
      // row is left un-charged and nothing moved, so a retry is a genuine second
      // attempt — a timeline showing only successes would hide a run of declines.
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
    [run, leadId, companyId, logBase, paymentFor]
  );

  /** Rep attestation that a down-payment check was physically taken. */
  const markCheckCollected = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Collect check', () => FundingService.markCheckCollected(leadId!, pid, companyId), {
        pid,
      });
      // ⚠️ The only step in the module with no third-party verification — it is the
      // rep's word — which is exactly why it needs a name against it.
      logFundingCheckCollected({ ...logBase, payment, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, logBase, paymentFor]
  );

  /**
   * Submit. On a block the server returns `409` with an itemised `blockers` list,
   * which is stored for verbatim rendering rather than flashed — a toast would
   * scroll away the very list the rep needs to work through.
   */
  const submit = useCallback(async (): Promise<FundingActionResult> => {
    if (!leadId) return { ok: false, error: { kind: 'bug', message: 'No lead id' } };
    setIsSubmitting(true);
    // Snapshot the record as submitted — the response replaces it, and on a refusal
    // the refetch below replaces it again.
    const submitted = recordRef.current;
    const shape = {
      contractPrice: submitted?.contractPrice ?? 0,
      paymentCount: (submitted?.payments || []).length,
      bankDecline: submitted?.result === 'bankDecline',
    };
    try {
      const res = await FundingService.submitFunding(leadId, companyId);
      apply(res.data?.data?.funding);
      setServerBlockers(null);
      logFundingSubmitted({ ...logBase, ...shape, ok: true });
      return OK(res.data?.message);
    } catch (e) {
      const error = classifyFundingError(e);
      if (error.blockers?.length) {
        // Not a flash: this is a checklist the rep works through, and it belongs
        // on the screen next to the button that refused.
        setServerBlockers(error.blockers);
        // ⚠️ The blockers ride the log verbatim. "The rep could not submit" is only
        // useful with what stopped them, and this list is already itemised and
        // ordered by the server.
        logFundingSubmitted({ ...logBase, ...shape, ok: false, blockers: error.blockers, error: error.message });
        await refetch();
        return { ok: false, error };
      }
      const reported = await report(e, 'Submit funding');
      logFundingSubmitted({ ...logBase, ...shape, ok: false, error: reported.message });
      return { ok: false, error: reported };
    } finally {
      setIsSubmitting(false);
    }
  }, [leadId, companyId, apply, refetch, report, logBase]);

  /**
   * Set the job outcome.
   *
   * ⚠️ `bankDecline` is refused (409) without a logged `Declined` attempt — the UI
   * must not offer it until one exists — and cannot be undone after submission.
   */
  const setResult = useCallback(
    async (result: FundingResult): Promise<FundingActionResult> => {
      const res = await run('Result', () => FundingService.setResult(leadId!, result, companyId));
      // ⚠️ A Bank Decline is a lender's verdict the rep is acting on, not an opinion
      // — and it cannot be undone once the funding is submitted. Both directions are
      // logged, including a refused switch, since that says the server had no
      // `Declined` attempt on record.
      logFundingResultChanged({ ...logBase, result, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, logBase]
  );

  /**
   * ⚠️ **`mockProvider` is gone**, with the Scenario Simulator it drove. It wrote an
   * invented approval or decline onto a real funding record; the only decisions this
   * hook now carries are the ones `syncPayment` reads back from the actual processor
   * or lender. `recordDecision` remains for a genuine out-of-band decision reported
   * to the rep directly — that is a real verdict, not a simulated one.
   */

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
    /** Company-wide `charges_enabled` gate — one banner, never one per row. */
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
    chargeCard,
    markCheckCollected,
    submit,
    setResult,
  };
}

export type UseFunding = ReturnType<typeof useFunding>;
