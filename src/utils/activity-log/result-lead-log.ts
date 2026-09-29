import { logEvent } from '../../services/api/LoggerService';
import { RESULT_LEAD_MODULE } from '../../constants/activity-log.constants';
import { composeFundingAction, type FundingLogBase, type FundingSource } from './funding-log';

/**
 * Result Lead — activity logging (Forever Record).
 *
 * Everything the rep does on the Result Lead sheet, from the moment it opens to the
 * moment they Confirm:
 *
 *   opened              the sheet came up — the start of the flow
 *   the outcome fields  One Leg, Result, contract price, the payment-method scalars
 *                       (emitted by `useOutcomeLogging`, which is handed this module
 *                       rather than having its six payloads duplicated here)
 *   the payment split   the structure choice, and each line added / removed / given
 *                       a method
 *   confirmed           the rep committed the split — the END of the flow
 *   build job           a DEMO's terminal action; it never reaches funding
 *
 * ⚠️ **This module STOPS at Confirm and `funding` takes over there.** The split is an
 * unsaved local draft until then — nothing has been asked of a processor or a lender
 * — so these rows answer "how was this job resulted?" while everything after the
 * `PUT …/funding` answers "how did the money come in?". The two used to be
 * interleaved under one module, which made neither question answerable.
 *
 * ⚠️ The module follows the SCREEN. **Edit payments** comes back to the pricing
 * panel, so a re-price after a lender decision fires `result_lead_opened` again and
 * files its edits here — not under `funding`, even though the deal is by then well
 * into the money flow.
 *
 * ⚠️ These four pricing events have deliberate twins in `funding-log.ts`
 * (`logFundingStructureChanged` / `RowAdded` / `RowRemoved` / `MethodSelected`) and
 * those are NOT dead: `DynamicDealEditScreen`'s Job Price step renders the same
 * pricing components inside the My Deals wizard, which is not a Result Lead sheet and
 * stays on `funding`. Payload keys are kept identical between the twins on purpose,
 * so the portal can render either module's row with one renderer.
 *
 * Conventions are `funding-log.ts`'s, and for the same reasons:
 *  - fire-and-forget; a dropped analytics row must never affect the rep
 *  - one verb per event, reused from `LOG_ACTIONS`
 *  - `meta.action` is the specific event name the portal labels the row from
 *  - a `userId`-less call is a no-op rather than a bad row
 */

/**
 * Identical to `FundingLogBase` — aliased rather than re-declared so the two modules
 * cannot drift on what identifies a row. ONE screen fires into both (the pricing
 * panel here, the funding screen there) from the SAME context object, so a second
 * shape would only ever be a way for them to disagree.
 */
export type ResultLeadLogBase = FundingLogBase;

export type { FundingSource };

const base = (o: ResultLeadLogBase, extra: Record<string, unknown>) => ({
  ...(o.calculatorId ? { calculatorId: o.calculatorId } : {}),
  ...(o.calculatorTitle ? { calculatorTitle: o.calculatorTitle } : {}),
  ...(o.leadId ? { leadId: o.leadId } : {}),
  ...extra,
});

/**
 * One `logEvent` call, shaped the same way for every event in this module.
 *
 * ⚠️ **The single place the flow prefix is applied**, exactly as in `funding-log.ts`:
 * every emitter below hands a bare `action` and this composes `sale` / `rehash` /
 * `my_deals` onto it, so adding an event cannot skip the prefix.
 *
 * ⚠️ It reuses funding's `composeFundingAction` and its `fundingSource` field name
 * rather than inventing a `resultLeadSource`. The flow is a property of the VISIT,
 * not of the module, and one field name means the portal badges a `result_lead` row
 * and a `funding` row from the same deal with the same code.
 */
const fire = (verb: string, o: ResultLeadLogBase, meta: Record<string, unknown>) => {
  if (!o.userId) return Promise.resolve();
  return logEvent(verb, {
    user_id: o.userId,
    created_by: o.userId,
    module_type: RESULT_LEAD_MODULE,
    meta: base(o, {
      ...meta,
      // AFTER the spread: this rewrites the bare action each emitter passed in.
      action: composeFundingAction(String(meta.action || ''), o.source),
      ...(o.source ? { fundingSource: o.source } : {}),
    }),
  });
};

// ── the flow's two ends ────────────────────────────────────────────────────

/**
 * The sheet opened — the START of the flow.
 *
 * ⚠️ Fires again on the way BACK from funding (**Edit payments** / the header
 * arrow), which is intended: that is a second pass at the same decision, usually
 * because a lender decision left money to re-assign, and the timeline should show the
 * rep re-entering rather than a stray edit appearing under a flow that had already
 * been confirmed. `reopened` tells the two apart.
 *
 * ⚠️ `contractPrice` is OMITTED while it is still 0 rather than sent as zero. The
 * sheet seeds it from the calculator a tick after mount, so a `0` here would read as
 * a job quoted at nothing rather than as a price not yet known.
 */
export const logResultLeadOpened = (
  o: ResultLeadLogBase & {
    /** `sale` | `demo`, as the sheet opened — the rep can still switch it. */
    resultType: string;
    payMode: string;
    contractPrice?: number;
    /** Whether this is a return trip from the funding screen. */
    reopened?: boolean;
  },
) =>
  fire('view', o, {
    action: 'result_lead_opened',
    resultType: o.resultType,
    payMode: o.payMode,
    ...(o.contractPrice ? { contractPrice: o.contractPrice } : {}),
    ...(o.reopened ? { reopened: true } : {}),
  });

/**
 * **Confirm** — the END of the flow, and the hand-off to `funding`.
 *
 * ⚠️ Fired on the PRESS, once the local blockers pass, and deliberately BEFORE the
 * `PUT …/funding` that follows it. The press is the boundary the flow is defined by,
 * and firing here guarantees the Result Lead flow always has a terminal row: gating
 * it on the save succeeding would leave a failed confirm as an open-ended flow with
 * no end marker — worse to read than an end marker followed by the save's own
 * `funding_payments_save_failed`.
 *
 * It carries the split as confirmed, so the hand-off is legible on its own without
 * having to be joined to the funding row that follows it.
 */
export const logResultLeadConfirmed = (
  o: ResultLeadLogBase & {
    contractPrice: number;
    payMode: string;
    paymentCount: number;
    payments: { kind: string; method: string; amount: number }[];
  },
) =>
  fire('submit', o, {
    action: 'result_lead_confirmed',
    contractPrice: o.contractPrice,
    payMode: o.payMode,
    paymentCount: o.paymentCount,
    payments: o.payments,
  });

/**
 * **Build Job** on a DEMO — the flow's other end.
 *
 * A demo funds nothing, so it never reaches Confirm and never enters the funding
 * module at all. Without this the demo arm would be the one path through this screen
 * that started and simply stopped, with no row saying the rep finished.
 *
 * ⚠️ A SALE's Build Job is NOT logged here — by then the rep is on the funding
 * screen, and `funding_submitted` already records it together with the server's
 * answer.
 */
export const logResultLeadBuildJob = (
  o: ResultLeadLogBase & { resultType: string; contractPrice?: number; reason?: string },
) =>
  fire('submit', o, {
    action: 'result_lead_build_job',
    resultType: o.resultType,
    ...(o.contractPrice ? { contractPrice: o.contractPrice } : {}),
    ...(o.reason ? { reason: o.reason } : {}),
  });

// ── the payment split ──────────────────────────────────────────────────────

/**
 * How the contract is being paid changed — a down payment plus a balance, or the
 * whole thing collected upfront.
 *
 * Worth its own event because it is the one choice on this screen that cannot be
 * taken back once a payment starts moving, and it decides whether a balance exists at
 * all.
 */
export const logResultLeadStructureChanged = (
  o: ResultLeadLogBase & { from: string; to: string },
) => fire('select', o, { action: 'result_lead_structure_changed', from: o.from, to: o.to });

/** The rep added a payment line to the Down Payment / Balance / Upfront group. */
export const logResultLeadRowAdded = (o: ResultLeadLogBase & { kind: string; rowCount?: number }) =>
  fire('add', o, {
    action: 'result_lead_payment_row_added',
    paymentKind: o.kind,
    ...(o.rowCount !== undefined ? { rowCount: o.rowCount } : {}),
  });

/**
 * The rep removed a payment line.
 *
 * The amount and method it was carrying are logged with it — after the fact the row
 * is gone, so the event is the only record that money was ever assigned there.
 */
export const logResultLeadRowRemoved = (
  o: ResultLeadLogBase & { kind: string; amount?: number; method?: string; methodLabel?: string },
) =>
  fire('delete', o, {
    action: 'result_lead_payment_row_removed',
    paymentKind: o.kind,
    ...(o.amount !== undefined ? { amount: o.amount } : {}),
    ...(o.method ? { paymentMethod: o.method } : {}),
    ...(o.methodLabel ? { methodLabel: o.methodLabel } : {}),
  });

/**
 * A payment method was picked for one line.
 *
 * ⚠️ Carries BOTH spellings on purpose: `paymentMethod` is the plan KEY (what the
 * lead's own `paymentMethod` scalar stores and what every consumer resolves against
 * the catalogue) and `methodLabel` is what the rep actually saw. A log holding only
 * the key reads as `2521` to a human; one holding only the label cannot be matched
 * back to the catalogue.
 */
export const logResultLeadMethodSelected = (
  o: ResultLeadLogBase & { kind: string; method: string; methodLabel?: string; amount?: number },
) => {
  if (!o.method) return Promise.resolve();
  return fire('select', o, {
    action: 'result_lead_payment_method_selected',
    paymentKind: o.kind,
    paymentMethod: o.method,
    ...(o.methodLabel ? { methodLabel: o.methodLabel } : {}),
    ...(o.amount !== undefined ? { amount: o.amount } : {}),
  });
};
