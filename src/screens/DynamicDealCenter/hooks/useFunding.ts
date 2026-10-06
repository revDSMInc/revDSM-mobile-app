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
import { isOnline } from '../../../services/connectivity';
import { isNetworkError, shouldAnnounceFailure } from '../../../utils/network-error';
import { getRawPhoneNumber } from '../../../utils/phone-util';

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
  /**
   * The CUSTOMER record's id — `lead.customerDetails._id`, a DIFFERENT document
   * from the lead.
   *
   * Used for one thing: when a rep corrects a mistyped phone or email on a resend,
   * the contact record is fixed too (`PATCH /lead/v1/customer/:customerId`).
   * Expiring the old link stops the wrong person using it, but it does NOT correct
   * the record — the next agreement or addendum would go to the same wrong address.
   *
   * ⚠️ It lives here, in the hook, rather than at the two call sites so both funding
   * screens cannot drift on it. ⚠️ And it must be the customer id, never the lead id:
   * the endpoint is keyed on the customer document.
   */
  customerId?: string;
}

export function useFunding(leadId?: string, companyId?: string, logCtx?: FundingLogContext) {
  /**
   * The rep, sent as the `userId` header on EVERY funding call.
   *
   * ⚠️ Not decoration, and not the same thing as the activity log: the funding API
   * keeps its own audit trail (`collectedBy`, each `events[].by`), and without this
   * header every action on the record is attributed to "RevDSM" (system) — a check
   * marked collected by a rep would then carry no name anywhere.
   *
   * Read off `logCtx` rather than added as a fourth argument, so no caller can hand
   * one identity to the logs and a different one to the API.
   */
  const actorId = logCtx?.userId;
  /** See `FundingLogContext.customerId` — the contact-correction target. */
  const customerId = logCtx?.customerId;
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
   * ── live updates ──────────────────────────────────────────────────────────
   * `funding-updated` carries the COMPLETE record on every state change, so the
   * screen never has to poll for one — the homeowner finishing a hosted page, or a
   * lender answering, arrives here rather than on the rep's next tap of Sync.
   *
   * ⚠️ **The event is COMPANY-scoped** (room `company:${companyId}`), so it fires for
   * every lead in the company. Without the `leadId` filter this screen would adopt
   * a DIFFERENT job's funding record over its own — and because `apply` replaces
   * wholesale, the rep would be looking at someone else's payments with no error
   * anywhere. The filter is the whole safety of this subscription.
   *
   * ⚠️ Payload shape is tolerated both ways (`{ funding }` or the record itself):
   * this is the one thing here that has never been driven against a live server, and
   * guessing wrong would otherwise mean silently ignoring every update.
   */
  useEffect(() => {
    if (!leadId) return;
    const off = SocketManager.on('funding-updated', (payload: any) => {
      const next: FundingRecord | null = payload?.funding ?? payload?.data?.funding ?? payload ?? null;
      if (!next || typeof next !== 'object') return;
      // Compared as STRINGS: the id arrives off a socket payload and off a nav
      // param, and those are not guaranteed to be the same type — a raw `!==` would
      // silently drop every update.
      if (String(next.leadId || '') !== String(leadId)) return;
      apply(next);
    });
    return off;
  }, [leadId, apply]);

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

  /**
   * Was this row ALREADY at Link Sent going into the call?
   *
   * ⚠️ Same snapshot rule as `paymentFor`, and for the same reason: `link-sent`
   * answers with a record whose `linkSent` is true, so reading it afterwards would
   * mark every send as a re-send. Kept separate from `paymentFor` because that one
   * narrows to the log payload shape and deliberately drops the step flags.
   */
  const wasLinkSent = useCallback((pid: string): boolean => {
    const row = (recordRef.current?.payments || []).find((x) => x.pid === pid);
    return !!row?.linkSent;
  }, []);

  /**
   * The WHOLE server row as it stands before a call — for rules that need more
   * than one flag off it (`isReissue` reads `linkSent`, `sentChannel` and `sentTo`
   * together).
   *
   * ⚠️ Same snapshot rule as its two siblings: every one of these endpoints answers
   * with a MUTATED record, so reading afterwards would compare the new destination
   * against itself and never see a change.
   */
  const rowFor = useCallback(
    (pid: string): FundingPaymentRow | null =>
      (recordRef.current?.payments || []).find((x) => x.pid === pid) || null,
    []
  );

  const refetch = useCallback(async (): Promise<FundingRecord | null> => {
    if (!leadId) return null;
    try {
      const res = await FundingService.getFunding(leadId, companyId, actorId);
      const next = res.data?.data?.funding ?? null;
      apply(next);
      return next;
    } catch (e) {
      // A failed refresh must never mask the error that triggered it.
      if (__DEV__) console.warn('[funding] refetch failed', e);
      return null;
    }
  }, [leadId, companyId, actorId, apply]);

  /**
   * Report a failure the way its status code says it should be reported, and
   * re-sync the record when the code means "you are looking at a stale copy".
   */
  const report = useCallback(
    async (err: any, context: string, isWrite = false): Promise<FundingError> => {
      const error = classifyFundingError(err);

      /**
       * ⚠️ A TRANSPORT failure is not a funding error, and reporting it as one is what put a red
       * **"Funding — Network Error"** over a sheet the rep was filling in at a door.
       *
       * `run()` gates every WRITE on `isOnline()` before it is attempted, but the reads do not go
       * through it — `load()` on open, and `refreshPayment()` — so offline they threw, landed in
       * `default` below, and flashed axios' own untranslated `message`. The rep is mid-way
       * through completing a job on a form that works perfectly offline, and the app appears to
       * be failing.
       *
       * Checked on the ERROR rather than on `isOnline()`: a request that dies in a tunnel is the
       * same event whatever the connectivity model believed at the time, and `isNetworkError`
       * keys off the absence of an HTTP status, which is the honest signal.
       *
       * Silent for a read. Nothing was written, the sheet already has what it needs, and
       * `OfflineBanner` is already telling the rep they are offline — a second, redder message
       * saying the same thing in worse words only undermines a screen that is working.
       */
      if (isNetworkError(err)) {
        const offline: FundingError = {
          ...error,
          kind: 'offline',
          message: `${context} needs a connection. Nothing was sent — try again once you have signal.`,
        };
        // ⚠️ A WRITE that died in flight still gets a message — `run()`'s pre-flight gate only
        // catches the case where we already knew we were offline, and a rep who tapped Charge
        // must never be left thinking it went through. A read stays silent: nothing was lost,
        // and the sheet is still usable.
        if (shouldAnnounceFailure(err, isWrite)) {
          FlashMessage.info('Needs a connection', offline.message);
        }
        return offline;
      }

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
      /**
       * ⚠️ ONE offline gate for EVERY funding action, here rather than at the
       * dozen call sites below it.
       *
       * Every one of them — save, send link, charge, collect, activate, sync,
       * refund, submit — is a server-owned step on a record only the server
       * holds, and none has an offline queue. A rule repeated at each call site
       * is a rule that will be right at most of them.
       *
       * Left ungated these failed anonymously: axios threw, `report` turned it
       * into a generic network error, and the rep saw a spinner resolve into
       * nothing. The honest message names the action that did not happen.
       */
      if (!isOnline()) {
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

  /**
   * Re-read a single row. The mutating endpoints all return the whole record, so
   * this is only for reconciling one card without disturbing the rest.
   */
  const refreshPayment = useCallback(
    async (pid: string) => {
      if (!leadId) return null;
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
          // ⚠️ `payMode` rides along so the STRUCTURE is STORED rather than guessed
          // back off the rows: `inferPayMode` cannot tell a contract paid in full by
          // one down row from an upfront one. Omitting it leaves the stored value
          // alone, which is why it was invisible until now.
          FundingService.savePayments(
            leadId!,
            { contractPrice, payments, payMode: payMode === 'upfront' ? 'upfront' : 'split' },
            companyId,
            actorId
          )
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
    [run, leadId, companyId, actorId, logBase]
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
      // Read BEFORE the call — see `wasLinkSent`.
      const resend = wasLinkSent(pid);
      const res = await run('Payment link', () => FundingService.getLink(leadId!, pid, companyId, actorId), { pid });
      // ⚠️ The url is NEVER passed to the logger, and `logFundingLinkRequested` does
      // not accept one — it is a bearer credential scoped to this payment.
      logFundingLinkRequested({
        ...logBase,
        payment,
        resend,
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
    [run, leadId, companyId, actorId, logBase, paymentFor, wasLinkSent]
  );

  /**
   * Record that a send happened → Link Sent.
   *
   * ⚠️ Only call this once the send is REAL: a QR the homeowner confirmed scanning,
   * or a text/email the server actually delivered. On 502/503 nothing is written
   * and `ok` is false, so the caller must not show the link as sent.
   *
   * ⚠️ **A DIFFERENT `destination` re-issues the link** (REVDSM-1155). The server
   * expires the open Checkout session before minting the new page, so the url the
   * wrong person is holding stops working. There is no separate endpoint — the
   * behaviour keys off this `destination`. See `isReissue`.
   */
  const markLinkSent = useCallback(
    async (pid: string, channel: FundingChannel, destination?: string): Promise<FundingActionResult<{ reissued: boolean }>> => {
      const payment = paymentFor(pid);
      // Read BEFORE the call, for the reason on `wasLinkSent`.
      const wasSent = wasLinkSent(pid);
      const row = rowFor(pid);
      const reissued = !!row && isReissue(row, channel, destination);

      /**
       * Correct the CONTACT RECORD first, and this ordering is the spec's own.
       *
       * Expiring the old link stops the wrong person using it; it does not fix the
       * number the mistake came from, so the next agreement or addendum would go to
       * the same wrong address. Doing it BEFORE the send means a failed send still
       * leaves the record corrected — which is right on its own terms — whereas the
       * other order can send successfully and leave the typo in place.
       *
       * ⚠️ A failure here must NOT abort the send. The re-issue is the urgent half:
       * it is what kills the link a stranger is holding. So this is awaited (the
       * record should be right before the new link goes out) but never thrown from.
       *
       * ⚠️ Only the ONE changed field is sent. The Lead Center writes the whole
       * customer object, but this is a correction to a single contact detail and
       * blanking a name from the funding screen would be indefensible.
       *
       * ⚠️ `getRawPhoneNumber` matches what the Lead Center already stores
       * (`14438784937`), so the field keeps ONE shape rather than gaining an E.164
       * spelling only this path writes.
       */
      if (reissued && customerId && destination) {
        try {
          await LeadService.updateCustomer(
            customerId,
            channel === 'text'
              ? { phone: getRawPhoneNumber(destination) }
              : { email: destination.trim() }
          );
        } catch (e: any) {
          // Said out loud rather than swallowed: the link is about to be re-issued
          // correctly, but the record the rest of the app reads is still wrong.
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
        // ⚠️ Its own field, not folded into `resend`: a re-issue CANCELLED a live
        // credential, which is a materially different event from re-sending the same
        // page to the same person, and the money trail has to be able to say so.
        reissued,
        channel,
        // QR transmits nothing, so it has no destination to record (spec §5.4).
        destination: channel === 'qr' ? undefined : destination,
        ok: res.ok,
        error: res.error?.message,
      });
      if (res.ok) setPaymentsSetupError(null);
      /**
       * ⚠️ `reissued` is REPORTED BACK because the caller is holding a url that the
       * server has just expired. Computing it here rather than at the two call sites
       * is what stops the funding screens disagreeing about whether a link is still
       * live — and the caller cannot re-derive it afterwards anyway, since the row now
       * carries the NEW destination.
       */
      return { ...res, data: { reissued } };
    },
    [run, leadId, companyId, actorId, logBase, paymentFor, wasLinkSent, rowFor, customerId]
  );

  /**
   * ── refunds (REVDSM-1160) ───────────────────────────────────────────────
   *
   * Raise a refund on a collected row. The only reason one exists in this app is
   * that the rep re-priced a deal BELOW what has already been collected.
   *
   * ⚠️ **The addendum draft must exist first**, and its `draftId` must be in `body`.
   * It is the only join between the refund and the paperwork the customer signs, it
   * can only be set at creation, and without it the refund reaches `pendingCustomer`
   * and waits there forever. `requestRefund` does not enforce it — the caller owns
   * the ordering, because only the caller knows when the draft was submitted.
   *
   * ⚠️ Nothing needs re-fetching afterwards: like every funding endpoint this returns
   * the WHOLE record and `run` applies it.
   *
   * ⚠️ **NO ACTIVITY LOG IS FIRED HERE, AND NONE MAY BE ADDED — the SERVER writes the
   * refund rows now** (`TAYYAB-REFUND-ACTIVITY-LOGS.md`). Every action in this file
   * logs beside its call, so this one reads like an oversight; it is not. The backend
   * files one row per refund transition as a side effect of the endpoints below, still
   * under `module_type: 'funding'`, and re-adding a client emitter files a SECOND row
   * per step — of which the client's is the wrong one of the pair:
   *
   *   1. the amount. `paymentMeta(payment)` writes `amount: p.amount` — the PAYMENT
   *      row's amount — and the portal renders `money(m.amount)`, so a $472 refund out
   *      of a $1,392 down payment rendered as *"Refund requested — $1,392"*.
   *   2. `rid`. The portal's supersede key is `refund-state-${rid || 'unknown'}`, and
   *      the client never had a `rid` to send (the server mints it in this response),
   *      so two refunds on one job collapsed onto one key and struck each other out.
   *
   * It had to move server-side regardless: money actually leaving is a Stripe webhook
   * and the customer's signature is the no-auth consent link — neither has a client.
   *
   * ⚠️ What this file MUST keep doing is passing `actorId`. `cfg()` sends it as the
   * `userId` header, and it is now the ONLY thing telling the backend which rep to
   * attribute its rows to; without it every refund step is filed as "RevDSM" (system).
   */
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

  /**
   * Answer an approval.
   *
   * ⚠️ **Approving returns no money** — it advances the refund to `pendingCustomer`,
   * unlocking the customer's signature and nothing more.
   *
   * ⚠️ Not routed through `run`: this is an APPROVALS endpoint, not a funding one, so
   * its response is `{ approval, funding }` rather than a bare funding envelope. The
   * `funding` half is applied when present — it is there exactly when the refund moved.
   */
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
        // ⚠️ A 403 here carries the server's own wording — wrong role, or the company
        // does not allow approving your own request. It is the only thing that says WHY.
        FlashMessage.error('Could not record the decision', error.message);
        return { ok: false, error };
      }
    },
    [companyId, actorId, apply]
  );

  /**
   * Send a pending request to a different approver. ⚠️ `pending`-only — 409 otherwise.
   *
   * ⚠️ Reassign and resend are the one REAL gap in the server-side move: they are
   * written to `ApprovalRequest.history[]` but produce no timeline row from either
   * side. Do not close it by re-adding a client emitter — ask the backend, which is
   * where the other thirteen refund actions are written. (Neither is wired to any UI
   * today, so nothing is currently losing a row.)
   */
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

  /** Nudge the same approver. ⚠️ `pending`-only — 409 otherwise. */
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

  /** Ask the processor/lender what happened. The main way card and loan rows advance. */
  const syncPayment = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Sync', () => FundingService.syncPayment(leadId!, pid, companyId, actorId), { pid });
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
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  /**
   * Sync every pollable row — **one request**, not a loop.
   *
   * ⚠️ This used to fan out per row through `syncPayment`, which has two problems the
   * bulk endpoint exists to solve. Each response carries the WHOLE record, so a
   * sequential loop leaves the screen describing several different moments as it
   * goes; and one lender being unreachable aborted the rest of the sweep. The
   * endpoint polls them all, never fails on one row, and returns the failures
   * itemised in `problems` alongside the single final record.
   *
   * The pollable set is still computed locally, but only to decide whether the call
   * is worth making at all and to log a count — the SERVER decides what it polls.
   */
  const syncAll = useCallback(async (): Promise<FundingActionResult> => {
    const rows = (recordRef.current?.payments || []).filter(
      (p) => (p.type === 'cc' || p.type === 'bank') && p.linkSent
    );
    if (!rows.length) return OK();
    setSyncingAll(true);
    logFundingSyncAll({ ...logBase, paymentCount: rows.length });
    try {
      const res = await run('Sync all', () => FundingService.syncAll(leadId!, companyId, actorId));
      // ⚠️ `problems` is per row and does NOT make the sweep a failure — the other
      // rows really were refreshed. Surfaced as information so the rep knows which
      // one to chase, rather than as an error that would suggest nothing happened.
      const problems = (res.data as any)?.problems;
      if (res.ok && Array.isArray(problems) && problems.length) {
        FlashMessage.info('Some rows could not be checked', problems.join('\n'));
      }
      return res;
    } finally {
      setSyncingAll(false);
    }
  }, [run, leadId, companyId, actorId, logBase]);

  /**
   * Re-settle a DRIFTED loan against what the job needs now.
   *
   * This is the case an addendum creates every time it moves the contract price: the
   * lender is still committed to `baseline` while the job now needs `liveUsage`, and
   * until this lands the screen would otherwise show a figure nobody has agreed to.
   *
   * ⚠️ Snapshot the two amounts BEFORE the call — the response is the mutated record,
   * so reading `baseline` afterwards gives the new value on both sides of the log and
   * the row reads "changed from X to X".
   */
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

  /**
   * Bring an archived plan back onto a row.
   *
   * ⚠️ **Symmetric** — whatever is current is archived in exchange — so both plans are
   * read off the record BEFORE the call and logged together. Recording only the one
   * restored would leave no trace of what it displaced.
   *
   * ⚠️ Addressed by `archivedId`, never by position: the shelf reorders on every swap.
   */
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

  /** Processor confirmation, out of band. `sync` is the normal path (spec §5.6). */
  const markCardOnFile = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Card on file', () => FundingService.markCardOnFile(leadId!, pid, companyId, actorId), { pid });
      logFundingCardOnFile({ ...logBase, payment, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  /**
   * Record a lender decision reported to the rep directly. Locks the row.
   * In the normal flow the decision arrives through `sync` (spec §5.7).
   */
  const recordDecision = useCallback(
    (pid: string, decision: FundingDecision, approvedAmt?: number) =>
      run('Lender decision', () => FundingService.recordDecision(leadId!, pid, { decision, approvedAmt }, companyId, actorId), {
        pid,
      }),
    [run, leadId, companyId, actorId]
  );

  /** Activate an approved loan. 409 if declined, undecided, or short and uncovered. */
  const activateLoan = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      // Captured before the call: on a partial approval the activated figure is the
      // APPROVED one, not the row's `amount`, and it is what the job is funded for.
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

  /**
   * Charge a card on file. ⚠️ Moves real money.
   *
   * `Card already charged` comes back 200 and is treated as success. A 402 leaves
   * the row un-charged, so the rep can genuinely retry.
   */
  const chargeCard = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Charge card', () => FundingService.chargeCard(leadId!, pid, companyId, actorId), { pid });
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
    [run, leadId, companyId, actorId, logBase, paymentFor]
  );

  /** Rep attestation that a down-payment check was physically taken. */
  const markCheckCollected = useCallback(
    async (pid: string): Promise<FundingActionResult> => {
      const payment = paymentFor(pid);
      const res = await run('Collect check', () => FundingService.markCheckCollected(leadId!, pid, companyId, actorId), {
        pid,
      });
      // ⚠️ The only step in the module with no third-party verification — it is the
      // rep's word — which is exactly why it needs a name against it.
      logFundingCheckCollected({ ...logBase, payment, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, actorId, logBase, paymentFor]
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
      const res = await FundingService.submitFunding(leadId, companyId, actorId);
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
      const reported = await report(e, 'Submit funding', true);
      logFundingSubmitted({ ...logBase, ...shape, ok: false, error: reported.message });
      return { ok: false, error: reported };
    } finally {
      setIsSubmitting(false);
    }
  }, [leadId, companyId, actorId, apply, refetch, report, logBase]);

  /**
   * Set the job outcome.
   *
   * ⚠️ `bankDecline` is refused (409) without a logged `Declined` attempt — the UI
   * must not offer it until one exists — and cannot be undone after submission.
   */
  const setResult = useCallback(
    async (result: FundingResult): Promise<FundingActionResult> => {
      const res = await run('Result', () => FundingService.setResult(leadId!, result, companyId, actorId));
      // ⚠️ A Bank Decline is a lender's verdict the rep is acting on, not an opinion
      // — and it cannot be undone once the funding is submitted. Both directions are
      // logged, including a refused switch, since that says the server had no
      // `Declined` attempt on record.
      logFundingResultChanged({ ...logBase, result, ok: res.ok, error: res.error?.message });
      return res;
    },
    [run, leadId, companyId, actorId, logBase]
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
