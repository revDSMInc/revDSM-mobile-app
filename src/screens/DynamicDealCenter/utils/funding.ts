import type { DealPlan } from '../hooks/useDealPricing';
import {
  newPaymentId,
  toWholeDollars,
  type FundingApplicationClosed,
  type ApprovalRecord,
  type FundingApprovalReminder,
  type FundingArchivedPlan,
  type FundingChannel,
  type FundingRefund,
  type FundingRefundMethod,
  type FundingRefundReason,
  type FundingRefundState,
  type FundingDecision,
  type FundingKind,
  type FundingMethodType,
  type FundingPaymentRow,
  type FundingRecord,
  type FundingUpsertRow,
  type PaymentAllocation,
} from '../../../services/api/FundingService';
import { formatLocalUSPhone, toE164USPhone } from '../../../utils/phone-util';

export const MULTI_METHOD_ENABLED = true;


export const FINANCING_BYPASS_ENABLED = false;

export const FINANCING_BYPASS_NOTICE_ENABLED = false;

export function isFinancingBypassed(payment: Pick<FundingPayment, 'type'>): boolean {
  return FINANCING_BYPASS_ENABLED && payment?.type === 'bank';
}

export type PayMode = 'split' | 'upfront';

export type PayStructure = 'none' | 'split' | 'upfront';

export function payStructureOf(mode: PayMode, noDown: boolean): PayStructure {
  return mode === 'upfront' ? 'upfront' : noDown ? 'none' : 'split';
}

export function inferNoDownPayment(record: FundingRecord | null | undefined): boolean {
  const saved = record?.payments || [];
  if (!saved.length || inferPayMode(record) !== 'split') return false;
  return !saved.some((p) => p.kind === 'down' && Number(p.amount) > 0);
}

export type PaymentKind = FundingKind | 'up';
export type MethodType = FundingMethodType;
export type Decision = FundingDecision;
export type FundingPayment = FundingPaymentRow;

export { newPaymentId, toWholeDollars };

export function wireKind(kind: PaymentKind): FundingKind {
  return kind === 'up' ? 'down' : kind;
}

export function remainderKind(mode: PayMode): PaymentKind {
  return mode === 'upfront' ? 'up' : 'bal';
}

function money(n: number): string {
  return Math.round(n).toLocaleString();
}

export const FLOW: Record<MethodType, string[]> = {
  check: ['Collected', 'Deposited'],
  cc: ['Link Sent', 'Card on File', 'Charged'],
  bank: ['Link Sent', 'Approved', 'Activated', 'Funded'],
};

export type StepState = 'done' | 'now' | 'next' | 'warn' | 'bad' | 'locked';

export interface PaymentRow {
  pid: string;
  kind: PaymentKind;
  amount: string;
  method: string;
  methodLabel?: string;
  auto?: boolean;
  decision?: Decision | null;

  linkSent?: boolean;
  activated?: boolean;
  charged?: boolean;
  collected?: boolean;

  archived?: FundingArchivedPlan[];

  baseline?: number | null;
  liveUsage?: number | null;
  drifted?: boolean;
}

export type LenderTone = 'neutral' | 'pending' | 'approved' | 'declined';

export function lenderState(
  row: PaymentRow,
  financing?: boolean
): { tone: LenderTone; sub: string } {
  if (row.decision === 'declined') return { tone: 'declined', sub: 'Declined by lender' };
  if (row.decision === 'full' || row.decision === 'short') {
    return {
      tone: 'approved',
      sub: row.activated
        ? 'Approved & activated'
        : row.decision === 'short'
          ? 'Approved in part'
          : 'Approved',
    };
  }
  if (row.charged) return { tone: 'approved', sub: 'Charged' };
  if (row.collected) return { tone: 'approved', sub: 'Collected' };
  if (row.linkSent) return { tone: 'pending', sub: 'Pending lender decision' };
  return { tone: financing ? 'pending' : 'neutral', sub: 'Not yet submitted' };
}

const LOCAL_ARCHIVE_PREFIX = 'local-';

export function isLocalArchive(entry: { archivedId?: string } | null | undefined): boolean {
  return String(entry?.archivedId || '').startsWith(LOCAL_ARCHIVE_PREFIX);
}

function snapshotPlan(row: PaymentRow, plans: Record<string, DealPlan>): FundingArchivedPlan {
  const type = methodTypeOf(plans, row.method);
  return {
    archivedId: `${LOCAL_ARCHIVE_PREFIX}${Math.random().toString(36).slice(2, 10)}`,
    method: methodLabelOf(plans, row.method) || row.methodLabel || row.method || '',
    planKey: row.method || methodLabelOf(plans, row.method) || row.methodLabel || '',
    ...(type ? { type } : {}),
    ...(row.decision ? { decision: row.decision } : {}),
    ...(row.decision ? { linkSent: true, activated: !!row.activated, approvedAmt: rowAmount(row) } : {}),
    // A financing application that is out but undecided is still worth keeping (pending financing).
    ...(!row.decision && type === 'bank' && row.linkSent ? { linkSent: true } : {}),
  };
}

/**
 * REVUIUX-536 - the archive is a reference list of payments that are ACTUALLY ACTIVE, not a
 * selection history. Financing files once the application is out (or decided); a card only once
 * it is charged; a cheque only once it is collected. A card whose link merely went out, or that
 * the homeowner saved but nobody charged, files nothing. Mirrors the server's `worthArchiving`.
 *
 * ⚠️ Not `hasLenderState`: that also asks "has this row started at all" (`showsChip`, and the
 * reset branch of `swapRowMethod`), and narrowing it there changes unrelated behaviour.
 */
export function worthArchiving(row: PaymentRow, plans?: Record<string, DealPlan>): boolean {
  if (row.charged || row.collected) return true;
  // Only a lender row carries a decision or an activation.
  if (row.decision || row.activated) return true;
  return Boolean(row.linkSent && plans && methodTypeOf(plans, row.method) === 'bank');
}

/** An entry whose money actually moved: kept so a card/cheque is never lost, never restorable. */
export function isReferenceEntry(entry: Pick<FundingArchivedPlan, 'charged' | 'collected'> | null | undefined): boolean {
  return Boolean(entry?.charged || entry?.collected);
}

export function referenceEntryNote(entry: FundingArchivedPlan): string {
  const verb = entry.collected ? 'collected' : 'charged';
  const amount = Number(entry.amount) > 0 ? ` $${money(Number(entry.amount))}` : '';
  const refunded = Number(entry.refundedAmount) > 0 ? `, refunded $${money(Number(entry.refundedAmount))}` : ', refunded';
  return `Kept for reference - ${verb}${amount}${refunded}`;
}

/**
 * Local mirror of the server's two restore refusals, so the app never offers what it will reject:
 * a reference entry (422) and financing onto a down payment (422). Server wording is the fallback.
 */
export function canRestoreEntry(
  row: Pick<PaymentRow, 'kind'>,
  entry: Pick<FundingArchivedPlan, 'charged' | 'collected' | 'type'>
): boolean {
  if (isReferenceEntry(entry)) return false;
  if (entry.type === 'bank' && wireKind(row.kind) === 'down') return false;
  return true;
}

function planKeyOf(entry: FundingArchivedPlan): string {
  return String((entry as any).planKey || entry.method || '');
}

function withoutPlan(
  shelf: FundingArchivedPlan[],
  key: string,
  plans?: Record<string, DealPlan>
): FundingArchivedPlan[] {
  if (!key) return shelf;
  const label = plans ? methodLabelOf(plans, key) : key;
  return shelf.filter((a) => planKeyOf(a) !== key && a.method !== label);
}

export function visibleArchived(
  row: Pick<PaymentRow, 'archived' | 'method'>,
  activeLabels: string[] = [],
  plans?: Record<string, DealPlan>
): FundingArchivedPlan[] {
  const seen = new Set<string>();
  const list = withoutPlan(
    (row.archived || []).filter((a) => {
      const e = a as any;
      return (
        isLocalArchive(a) ||
        Boolean(e.decision || e.approvedAmt != null || e.charged || e.collected || e.activated || (e.linkSent && e.type === 'bank'))
      );
    }),
    row.method,
    plans
  );
  return list.filter((a) => {
    const label = String(a.method || planKeyOf(a));
    if (seen.has(label) || activeLabels.includes(label)) return false;
    seen.add(label);
    return true;
  });
}

export type PartialApproval =
  | { kind: 'short'; approvedAmt: number }
  | { kind: 'full' }
  | { kind: 'invalid'; message: string };

export function parsePartialApproval(text: string, requested: number): PartialApproval {
  const n = Math.round(parseFloat(String(text).replace(/[^0-9.]/g, '')));
  if (!Number.isFinite(n) || n < 1) return { kind: 'invalid', message: 'Enter the approved amount in whole dollars.' };
  if (n >= requested) return { kind: 'full' };
  return { kind: 'short', approvedAmt: n };
}

export function canRecordDecision(
  p: Pick<FundingPayment, 'type' | 'linkSent' | 'decision'>,
  opts?: { offline?: boolean }
): boolean {
  return p.type === 'bank' && !p.decision && (!!p.linkSent || !!opts?.offline);
}

export function applyOfflineDecision(
  record: FundingRecord,
  pid: string,
  decision: FundingDecision,
  approvedAmt?: number
): FundingRecord {
  return {
    ...record,
    payments: record.payments.map((p) => {
      if (p.pid !== pid) return p;
      const approved = decision === 'full' ? p.amount : decision === 'short' ? approvedAmt ?? 0 : 0;
      return { ...p, linkSent: true, decision, requested: p.amount, approvedAmt: approved, step: Math.max(p.step, 1) };
    }),
  };
}

export function applyOfflineActivation(record: FundingRecord, pid: string): FundingRecord {
  return { ...record, payments: record.payments.map((p) => (p.pid === pid ? { ...p, activated: true, step: Math.max(p.step, 2) } : p)) };
}

export function findApprovedArchive(
  row: Pick<PaymentRow, 'archived'>,
  key: string,
  plans: Record<string, DealPlan>
): FundingArchivedPlan | undefined {
  const label = methodLabelOf(plans, key);
  return (row.archived || []).find(
    (a) =>
      (planKeyOf(a) === key || a.method === label) &&
      !isReferenceEntry(a) &&
      (a.decision === 'full' || a.decision === 'short' || (a.type === 'bank' && !!a.linkSent))
  );
}

export function swapRowMethod(
  rows: PaymentRow[],
  pid: string,
  nextKey: string,
  plans: Record<string, DealPlan>
): PaymentRow[] {
  return rows.map((r) => {
    if (r.pid !== pid) return r;
    if (!nextKey || nextKey === r.method) return { ...r, method: nextKey };
    const shelf = r.archived || [];
    const approved = findApprovedArchive(r, nextKey, plans);
    if (approved && canRestoreEntry(r, approved)) return restoreRowPlan([r], pid, approved.archivedId, plans)[0];
    if (!(r.method || r.methodLabel) || !worthArchiving(r, plans)) {
      return {
        ...r,
        method: nextKey,
        ...(hasLenderState(r) ? { methodLabel: undefined, linkSent: false, activated: false, decision: null } : {}),
        archived: shelf,
      };
    }
    const snap = snapshotPlan(r, plans);
    return {
      ...r,
      method: nextKey,
      methodLabel: undefined,
      linkSent: false,
      activated: false,
      decision: null,
      archived: [snap, ...withoutPlan(shelf, planKeyOf(snap), plans).filter((a) => a.method !== snap.method)],
    };
  });
}

export function restoreRowPlan(
  rows: PaymentRow[],
  pid: string,
  archivedId: string,
  plans: Record<string, DealPlan>
): PaymentRow[] {
  return rows.map((r) => {
    if (r.pid !== pid) return r;
    const shelf = r.archived || [];
    const entry = shelf.find((a) => a.archivedId === archivedId);
    if (!entry || !canRestoreEntry(r, entry)) return r;
    const key = (entry as any).planKey || planKeyForLabel(plans, entry.method) || entry.method || '';
    const rest = shelf.filter((a) => a.archivedId !== archivedId);
    const outgoing = (r.method || r.methodLabel) && worthArchiving(r, plans) ? [snapshotPlan(r, plans)] : [];
    return {
      ...r,
      method: key,
      methodLabel: key && plans[key] ? undefined : entry.method,
      ...(entry.decision === 'full' || entry.decision === 'short' || entry.linkSent
        ? {
            linkSent: true,
            activated: !!(entry as any).activated,
            decision: entry.decision === 'full' || entry.decision === 'short' ? entry.decision : null,
            ...(entry.approvedAmt != null ? { amount: String(entry.approvedAmt) } : {}),
          }
        : { linkSent: false, activated: false, decision: null }),
      archived: [...outgoing, ...rest.filter((a) => !outgoing[0] || a.method !== outgoing[0].method)],
    };
  });
}

export function isSettledRow(row: PaymentRow): boolean {
  return Boolean(row.decision || row.charged || row.collected);
}

export function lockedMethodNote(row: PaymentRow): string {
  if (!isMethodLockedRow(row)) return '';
  if (row.charged) {
    return 'This card has already been charged. Changing the method would reset the payment, so it is locked — a refund is the only way money goes back.';
  }
  if (row.collected) {
    return 'This payment has already been collected. Changing the method would reset it, so it is locked — a refund is the only way money goes back.';
  }
  if (row.activated) {
    return 'This financing has already been activated, so its method is locked.';
  }
  return 'This payment has already started, so its method is locked.';
}

/**
 * Does the saved funding record belong to this calculator? Ownership is the server's
 * `record.calculatorId` (null = unclaimed). A different owner means the rep is re-scoping,
 * so the sheet must not hydrate from those rows; the server moves it or answers 409.
 */
export function fundingBelongsToCalculator(
  recordCalculatorId: string | null | undefined,
  calculatorId: string | null | undefined
): boolean {
  if (!recordCalculatorId || !calculatorId) return true;
  return String(recordCalculatorId) === String(calculatorId);
}

/** Real money has moved (charged card / collected cheque) — mirrors the server's `isSettled`. A lender decision alone is not money. */
export function hasCollectedMoney(
  record: { payments?: Array<{ charged?: boolean; collected?: boolean }> } | null | undefined
): boolean {
  return (record?.payments || []).some((p) => Boolean(p.charged || p.collected));
}

/**
 * Collected money pins the lead's funding to the calculator that took it: any OTHER calculator
 * may not result a Sale until that is refunded. Fully-financed funding pins nothing.
 */
export function fundingPinnedToOtherCalculator(
  record: { calculatorId?: string | null; payments?: Array<{ charged?: boolean; collected?: boolean }> } | null | undefined,
  calculatorId: string | null | undefined
): boolean {
  if (!record?.calculatorId || !calculatorId) return false;
  return !fundingBelongsToCalculator(record.calculatorId, calculatorId) && hasCollectedMoney(record);
}

export function isSettledPayment(p: { charged?: boolean; collected?: boolean }): boolean {
  return Boolean(p.charged || p.collected);
}

/**
 * Every row the server will not let a save drop by omission (REVUIUX-519 add. 3 s2): money on it,
 * a lender decision, a sent credit application, or filed plans on its shelf. Funding is lead-wide,
 * so a client sending only the new scope's rows omits every one of these by definition.
 */
export function mustCarryPayment(p: Partial<FundingPaymentRow>): boolean {
  return Boolean(
    p.charged ||
      p.collected ||
      p.decision != null ||
      (p.linkSent && p.type === 'bank') ||
      (p.archived?.length ?? 0) > 0
  );
}

/**
 * Re-scoping only: a card the homeowner saved but nobody charged IS removable by omission (REVDSM-1155
 * changes a card by removing it), and the rep never sees it on the new scope's blank rows - so it
 * would vanish at HTTP 200. On a scope change, carry it. Never when staying on the same scope, or a
 * deliberate card removal would be undone.
 */
function isUnseenCardOnFile(p: Partial<FundingPaymentRow>): boolean {
  return p.type === 'cc' && (Boolean(p.linkSent) || Number(p.step) >= 2);
}

export function withSettledRows(
  upsert: FundingUpsertRow[],
  record: FundingRecord | null | undefined,
  opts?: { rescoping?: boolean }
): FundingUpsertRow[] {
  const have = new Set(upsert.map((r) => r.pid));
  const carried = (record?.payments || [])
    .filter((p) => (mustCarryPayment(p) || (opts?.rescoping && isUnseenCardOnFile(p))) && !have.has(p.pid))
    .map(
      (p) =>
        ({
          pid: p.pid,
          kind: p.kind,
          method: p.method,
          type: p.type,
          amount: p.amount,
        }) as FundingUpsertRow
    );
  return carried.length ? [...carried, ...upsert] : upsert;
}

export function scopeSwitchOptions(settledAmount: number, overage?: number) {
  const held = `$${Math.round(settledAmount).toLocaleString()}`;
  return {
    reuse: `Re-use the ${held} already collected on this job scope`,
    refund: `Refund the ${held} already collected`,
    reuseNote:
      overage && overage > 0
        ? `The new contract can’t hold it all — $${Math.round(overage).toLocaleString()} would need to be refunded, which requires approvals.`
        : '',
  };
}

export function scopeOverCollectedBlocker(settled: number, price: number): string | null {
  const over = settled - price;
  return over > EPS ? `$${money(over)} more has been collected than the contract price — refund it to submit` : null;
}

export function isMethodLockedRow(row: PaymentRow): boolean {
  return Boolean(row.charged || row.collected);
}

export function isRemovableRow(row: PaymentRow): boolean {
  return !isSettledRow(row) && !row.linkSent;
}

export function hasLenderState(row: PaymentRow): boolean {
  return Boolean(row.decision || row.linkSent || row.activated || row.charged || row.collected);
}

export function showsChip(row: PaymentRow): boolean {
  return Boolean(row.auto) || hasLenderState(row);
}

export function driftNote(row: PaymentRow): { prior: string; delta: string; up: boolean } | null {
  if (!row.drifted) return null;
  const prior = Number(row.baseline);
  const live = Number(row.liveUsage);
  if (!Number.isFinite(prior) || !Number.isFinite(live) || prior <= 0) return null;
  const diff = live - prior;
  if (diff === 0) return null;
  return {
    prior: `Prior $${money(prior)}`,
    delta: `${diff > 0 ? '+' : '−'}$${money(Math.abs(diff))}`,
    up: diff > 0,
  };
}

export interface DecisionBanner {
  id: string;
  tone: 'warn' | 'bad';
  text: string;
}

export interface AttemptLogEntry {
  method: string;
  amt: number;
  approved: number;
  at: string;
  outcome: 'Full' | 'Partial' | 'Declined';
}

export function rowAmount(row: Pick<PaymentRow, 'amount'>): number {
  const n = parseFloat(String(row.amount).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function autoAmount(rows: PaymentRow[], price: number): number {
  const used = rows.reduce((sum, r) => (r.auto ? sum : sum + rowAmount(r)), 0);
  return Math.max(price - used, 0);
}

export function effectiveRowAmount(row: PaymentRow, rows: PaymentRow[], price: number): number {
  return row.auto ? autoAmount(rows, price) : rowAmount(row);
}

export function assignedTotal(rows: PaymentRow[], price: number): number {
  return rows.reduce((sum, r) => sum + effectiveRowAmount(r, rows, price), 0);
}

const EPS = 0.01;

export function inferPayMode(record: FundingRecord | null | undefined): PayMode {
  const saved = record?.payments || [];
  if (!saved.length) return 'split';
  return saved.some((p) => p.kind === 'bal') ? 'split' : 'upfront';
}

/**
 * REVUIUX-519 add. 3 s3 - matches the server: a lender decision, collected/charged money or an
 * activated loan locks the structure. A sent link (re-sendable) or a vaulted card (undone by a new
 * link) does not, and neither does a plain `step > 0`.
 */
export function structureLocked(payments: Array<Partial<FundingPaymentRow>>): boolean {
  return payments.some((p) => p.decision != null || p.collected || p.charged || p.activated);
}

/** The same rule over the rows on screen (what the rep is actually editing). */
export function structureLockedRows(rows: PaymentRow[]): boolean {
  return rows.some((r) => r.decision != null || r.collected || r.charged || r.activated);
}

export function structureHint(mode: PayMode, locked: boolean, nudge?: boolean, noDown?: boolean): string {
  if (locked) {
    return nudge
      ? 'A payment on this job has already started. Remove that payment, or refund it if money has already moved, before switching structure.'
      : 'Structure is set — a payment on this job has already started.';
  }
  if (mode === 'upfront') return 'Upfront collects the whole contract now. No down payment or balance is created.';
  return noDown ? 'No money down. The whole contract is the balance.' : '';
}

export type CoverageTone = 'ok' | 'short' | 'over';

export function coverageState(assigned: number, price: number): { tone: CoverageTone; message: string; tally: string } {
  const gap = price - assigned;
  const tally = `$${money(assigned)} of $${money(price)}`;
  if (Math.abs(gap) <= EPS) return { tone: 'ok', message: 'Full contract covered', tally };
  if (gap > 0) return { tone: 'short', message: `$${money(gap)} still to assign`, tally };
  return { tone: 'over', message: `$${money(-gap)} over contract price`, tally };
}

export function confirmBlockers(
  rows: PaymentRow[],
  price: number,
  mode: PayMode = 'split',
  opts?: {
    refundDue?: number;
    plans?: Record<string, DealPlan>;
    online?: boolean;
  }
): string[] {
  if (!(price > 0)) return ['Enter the contract price'];

  const out: string[] = [];
  const funded = rows.filter((r) => effectiveRowAmount(r, rows, price) > 0);
  if (!funded.length) out.push('Assign the contract to at least one payment method');
  if (funded.some((r) => !r.method && !r.methodLabel)) {
    out.push(
      mode === 'upfront'
        ? 'Pick a payment method for every upfront amount'
        : 'Pick a payment method for every amount entered'
    );
  }

  if (opts?.plans && opts?.online === false) {
    const stranded = funded.filter(
      (r) => !isSettledRow(r) && !r.decision && planBlockedOffline(opts.plans!, r.method || '', false)
    );
    if (stranded.length) {
      out.push(
        stranded.length === 1
          ? 'One payment uses a card, which needs a connection — switch it to a check or financing, or reconnect'
          : `${stranded.length} payments use a card, which needs a connection — switch them to a check or financing, or reconnect`
      );
    }
  }

  const downIsFunded = rows.some((r) => r.kind === 'down' && effectiveRowAmount(r, rows, price) > 0);
  const emptyNamed = rows.filter(
    (r) =>
      !r.auto &&
      !r.decision &&
      (r.method || r.methodLabel) &&
      effectiveRowAmount(r, rows, price) <= 0 &&
      !(r.kind === 'down' && !downIsFunded)
  );
  if (emptyNamed.length) {
    out.push(
      emptyNamed.length === 1
        ? 'Enter an amount for the payment method you added, or remove that line'
        : `Enter an amount for every payment method you added — ${emptyNamed.length} have none`
    );
  }

  const total = assignedTotal(rows, price);
  const refunded = Math.max(0, Math.round(Number(opts?.refundDue) || 0));
  const over = total - price - refunded;
  if (over > EPS) {
    out.push(
      mode === 'upfront'
        ? `Upfront is $${money(over)} over the contract price`
        : `Payments add up to $${money(total)} — $${money(over)} more than the contract price`
    );
  } else if (total < price - EPS) {
    out.push(`$${money(price - total)} of the contract is still unassigned`);
  }
  return out;
}

export function methodTypeOf(plans: Record<string, DealPlan>, key?: string): MethodType | null {
  const plan = plans[key || ''];
  if (!plan) return null;
  if (plan.type === 'financing') return 'bank';
  if (plan.type === 'card') return 'cc';
  return 'check';
}

export function methodAvailableOffline(plan?: DealPlan | null): boolean {
  if (!plan) return true;
  return plan.type === 'cash' || plan.type === 'financing';
}

export function planBlockedOffline(
  plans: Record<string, DealPlan>,
  key: string,
  online: boolean,
): boolean {
  if (online) return false;
  const plan = plans[key];
  if (!plan) return false;
  return !methodAvailableOffline(plan);
}

export function blockedOfflineMsg(plans: Record<string, DealPlan>, key: string): string {
  const plan = plans[key];
  const what = plan?.type === 'financing' ? 'A loan application' : 'A card payment';
  return `${what} needs a connection — the link is created on the server. Take a check now, or add this once you have signal.`;
}

export function methodLabelOf(plans: Record<string, DealPlan>, key?: string): string {
  return plans[key || '']?.label || key || '';
}

export function planKeyForLabel(plans: Record<string, DealPlan>, label?: string): string {
  if (!label) return '';
  const hit = Object.keys(plans).find((k) => plans[k]?.label === label);
  return hit || '';
}

export function shortMethod(label: string): string {
  return String(label).split(' (')[0].trim() || label;
}

export function describePayment(payment: FundingPayment, payments: FundingPayment[]): string {
  const base = `$${payment.amount.toLocaleString()} ${shortMethod(payment.method)}`;
  const twins = payments.filter(
    (p) => p.amount === payment.amount && shortMethod(p.method) === shortMethod(payment.method)
  );
  if (twins.length < 2) return base;
  const ordinal = twins.findIndex((p) => p.pid === payment.pid) + 1;
  if (ordinal < 1) return base;
  return `${base} (${ordinal} of ${twins.length})`;
}

export const APPLICATION_CLOSED_TEXT: Record<FundingApplicationClosed, string> = {
  abandoned: 'The homeowner left the page without finishing.',
  canceled: 'The homeowner cancelled on the payment page.',
  expired: 'The link expired before it was completed.',
  error: 'The provider hit an error and could not finish.',
};

const APPLICATION_CLOSED_SHORT: Record<FundingApplicationClosed, string> = {
  abandoned: 'was abandoned',
  canceled: 'was cancelled',
  expired: 'expired',
  error: 'hit a provider error',
};

/** An undecided application that wound back: needs a new link. */
export function isApplicationClosed(p: FundingPayment): boolean {
  return !!p.applicationClosed && !p.linkSent && !p.decision;
}

/**
 * REVUIUX-536 s3: a lender closed an application that was ALREADY approved. The row keeps `step`,
 * `linkSent`, `decision` and the lender ids, but `approvedAmt` is 0 and `activated` false. Key it off
 * `applicationClosed`, never `decision`/`step`, or a dead loan renders as approved.
 */
export function isClosedAfterApproval(p: FundingPayment): boolean {
  return !!p.applicationClosed && p.decision != null && p.decision !== 'declined' && !p.activated && !(Number(p.approvedAmt) > 0);
}

export function canResendLink(p: FundingPayment): boolean {
  if (!p) return false;
  if (p.type !== 'cc' && p.type !== 'bank') return false;
  if (!p.linkSent) return false;
  if (p.charged || p.collected) return false;
  if (p.type === 'cc') return !(p.step >= 2);
  return !p.decision && !p.activated;
}

export function lastSendNote(p: FundingPayment): string | null {
  if (!p || !p.linkSent || !p.sentChannel) return null;
  const at = formatStamp(p.sentAt);
  const when = at ? ` · ${at}` : '';
  if (p.sentChannel === 'qr') return `Scanned at the table${when}`;
  const to = String(p.sentTo || '').trim();
  const pretty = p.sentChannel === 'text' && to ? formatLocalUSPhone(to) || to : to;
  const verb = p.sentChannel === 'text' ? 'Texted to' : 'Emailed to';
  if (!pretty) return `${p.sentChannel === 'text' ? 'Texted' : 'Emailed'}${when}`;
  return `${verb} ${pretty}${when}`;
}

export function resendSeed(p: FundingPayment): {
  stage: 'choose' | 'text' | 'email';
  phone: string;
  email: string;
} {
  const blank = { stage: 'choose' as const, phone: '', email: '' };
  if (!p || !canResendLink(p) || !p.sentChannel) return blank;
  const to = String(p.sentTo || '').trim();
  if (p.sentChannel === 'text') return { stage: 'text', phone: formatLocalUSPhone(to), email: '' };
  if (p.sentChannel === 'email') return { stage: 'email', phone: '', email: to };
  return blank;
}

export function normalizeDestination(channel: FundingChannel, value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (channel === 'text') return toE164USPhone(raw);
  if (channel === 'email') return raw.toLowerCase();
  return '';
}

export function isReissue(
  p: FundingPayment,
  channel: FundingChannel,
  destination?: string | null
): boolean {
  if (!p || !p.linkSent || channel === 'qr') return false;
  if (p.sentChannel !== 'text' && p.sentChannel !== 'email') return false;
  const next = normalizeDestination(channel, destination);
  const prev = normalizeDestination(p.sentChannel, p.sentTo);
  if (!next || !prev) return false;
  return next !== prev;
}

export function reissueWarning(
  p: FundingPayment,
  channel: FundingChannel,
  destination?: string | null
): string | null {
  if (!isReissue(p, channel, destination)) return null;
  const old = String(p.sentTo || '').trim();
  const pretty = p.sentChannel === 'text' ? formatLocalUSPhone(old) || old : old;
  return `This cancels the link already sent to ${pretty}. It will stop working, and a new one will be sent instead.`;
}
export function applicationClosedNote(p: FundingPayment): string | null {
  if (isClosedAfterApproval(p)) {
    const why = APPLICATION_CLOSED_TEXT[p.applicationClosed as FundingApplicationClosed];
    return `${why || 'The lender closed this application.'} It was approved, but it no longer covers any of the contract.`;
  }
  if (!isApplicationClosed(p)) return null;
  const why = APPLICATION_CLOSED_TEXT[p.applicationClosed as FundingApplicationClosed];
  return `${why || 'The application closed without completing.'} Send them a new link to try again.`;
}

export function hydrateRowsFromRecord(
  record: FundingRecord | null | undefined,
  plans: Record<string, DealPlan>
): PaymentRow[] {
  const saved = record?.payments || [];
  if (!saved.length) return [];
  const upfront = inferPayMode(record) === 'upfront';
  const rows: PaymentRow[] = saved.map((p) => ({
    pid: p.pid,
    kind: upfront ? 'up' : p.kind,
    amount: String(p.decision && !isClosedAfterApproval(p) ? (p.approvedAmt ?? p.amount) : p.amount),
    method: planKeyForLabel(plans, p.method),
    methodLabel: p.method,
    decision: p.decision,
    linkSent: p.linkSent,
    activated: p.activated,
    charged: p.charged,
    collected: p.collected,
    archived: p.archived,
    baseline: p.baseline,
    liveUsage: p.liveUsage,
    drifted: p.drifted,
  }));
  const lastOpenBalance = [...rows].reverse().find((r) => r.kind === 'bal' && !r.decision);
  if (lastOpenBalance) lastOpenBalance.auto = true;
  return rows;
}

export function toUpsertRows(
  rows: PaymentRow[],
  price: number,
  plans: Record<string, DealPlan>
): FundingUpsertRow[] {
  return rows
    .map((row) => {
      const amount = toWholeDollars(effectiveRowAmount(row, rows, price));
      const method = row.method ? methodLabelOf(plans, row.method) : row.methodLabel || '';
      if (!method || amount <= 0) return null;
      return {
        // ⚠️ `up` is a client-side grouping; the wire only knows down/bal.
        pid: row.pid,
        kind: wireKind(row.kind),
        method,
        ...(methodTypeOf(plans, row.method) ? { type: methodTypeOf(plans, row.method)! } : {}),
        amount,
      } as FundingUpsertRow;
    })
    .filter((r): r is FundingUpsertRow => r !== null);
}

export function paymentAllocations(
  rows: PaymentRow[],
  price: number,
  plans: Record<string, DealPlan>
): { downPayments: PaymentAllocation[]; balancePayments: PaymentAllocation[] } {
  const downPayments: PaymentAllocation[] = [];
  const balancePayments: PaymentAllocation[] = [];

  rows.forEach((row) => {
    const amount = toWholeDollars(effectiveRowAmount(row, rows, price));
    const method = row.method || row.methodLabel || '';
    if (!method || amount <= 0) return;

    const entry: PaymentAllocation = {
      method,
      amount,
      label: methodLabelOf(plans, row.method) || row.methodLabel || method,
      ...(methodTypeOf(plans, row.method) ? { type: methodTypeOf(plans, row.method)! } : {}),
    };
    if (wireKind(row.kind) === 'bal') balancePayments.push(entry);
    else downPayments.push(entry);
  });

  return { downPayments, balancePayments };
}

export function attemptLog(record: FundingRecord | null | undefined): AttemptLogEntry[] {
  return (record?.attemptHistory || []).map((a) => ({
    method: a.method,
    amt: a.requested,
    approved: a.approved,
    at: formatStamp(a.at),
    outcome: a.outcome,
  }));
}

export function formatStamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fundedAmount(p: FundingPayment): number {
  if (p.type === 'bank') return p.approvedAmt ?? 0;
  return p.amount;
}

const COVERAGE_CLAIMING_REFUND_STATES: FundingRefundState[] = [
  'pendingApproval',
  'pendingCustomer',
  'customerSigned',
  'issuing',
  'refunded',
];

/** Refunded or promised back from the moment it is raised. declined / cancelled / failed promise nothing. */
export function refundedAgainst(p: FundingPayment): number {
  return (p.refunds || [])
    .filter((r) => r && COVERAGE_CLAIMING_REFUND_STATES.includes(r.state))
    .reduce((n, r) => n + (Number(r.amount) || 0), 0);
}

/** Coverage is NET of live refunds (REVUIUX-519). A row's own amount and label stay gross - that is history. */
export function netFundedAmount(p: FundingPayment): number {
  return Math.max(0, fundedAmount(p) - refundedAgainst(p));
}

export function coverageOK(payments: FundingPayment[], price: number): boolean {
  return payments.reduce((n, p) => n + netFundedAmount(p), 0) >= price;
}

export function openShort(p: FundingPayment, covered: boolean): boolean {
  return p.decision === 'short' && !covered;
}

export function ownerOf(p: FundingPayment): string {
  if (p.type === 'check') return p.kind === 'bal' ? 'Install crew' : 'Bank';
  if (p.type === 'cc') return 'Processor';
  return 'Lender';
}

export function stateOf(p: FundingPayment, covered: boolean): Record<number, StepState> {
  const st: Record<number, StepState> = {};

  if (p.type === 'check') {
    if (p.kind === 'bal') {
      st[0] = 'locked';
      st[1] = 'locked';
    } else {
      st[0] = p.collected ? 'done' : 'now';
      st[1] = 'locked';
    }
    return st;
  }

  const linkStep: StepState = isApplicationClosed(p) ? 'warn' : p.linkSent ? 'done' : 'now';

  if (p.type === 'cc') {
    const onFile = p.step >= 2 || p.charged;
    st[0] = linkStep;
    st[1] = onFile ? 'done' : p.linkSent ? 'now' : 'next';
    st[2] = p.kind === 'bal' ? 'locked' : p.charged ? 'done' : 'next';
    return st;
  }

  st[0] = linkStep;
  if (isClosedAfterApproval(p)) {
    // Dead loan: key off `applicationClosed`, not `decision`/`step`.
    st[1] = 'bad';
    st[2] = 'locked';
    st[3] = 'locked';
    return st;
  }
  if (p.decision === 'declined') st[1] = 'bad';
  else if (p.decision === 'short') st[1] = openShort(p, covered) ? 'warn' : 'done';
  else if (p.decision === 'full') st[1] = 'done';
  else st[1] = p.linkSent ? 'now' : 'next';
  st[2] = p.activated
    ? 'done'
    : p.decision === 'full' || p.decision === 'short'
      ? 'now'
      : 'next';
  st[3] = 'locked';
  return st;
}

export type ConnectorTone = 'green' | 'grey' | 'dashed';

export function connectorTones(state: StepState): { left: ConnectorTone; right: ConnectorTone } {
  if (state === 'locked') return { left: 'dashed', right: 'dashed' };
  if (state === 'done') return { left: 'green', right: 'green' };
  if (state === 'now') return { left: 'green', right: 'grey' };
  return { left: 'grey', right: 'grey' };
}

export function doneFor(p: FundingPayment, covered: boolean): string | null {
  if (p.type === 'check') {
    if (p.kind === 'bal') return 'Collected and deposited by the install crew after the job is done.';
    if (p.collected) return 'Take the check to the branch to deposit it. Deposited checks off once the bank posts it.';
    return null;
  }
  if (p.type === 'cc') {
    const onFile = p.step >= 2 || p.charged;
    if (p.kind === 'bal') return onFile ? 'Card is on file. It gets charged after install is verified.' : null;
    return p.charged ? 'Charged. Funds confirmed.' : null;
  }
  if (p.decision === 'declined' || openShort(p, covered)) return null;
  if (!p.activated) return null;
  return p.kind === 'bal'
    ? 'Loan activated. Funds release after install is verified.'
    : "Loan activated. Draw settles on the lender's next funding cycle.";
}

export function canSync(p: FundingPayment): boolean {
  return (p.type === 'cc' || p.type === 'bank') && p.linkSent;
}

export function fundingBlockers(
  payments: FundingPayment[],
  price: number,
  opts?: {
    setupBlocked?: boolean;
    offline?: boolean;
  }
): string[] {
  const covered = coverageOK(payments, price);
  const out: string[] = [];
  payments.forEach((p) => {
    const who = describePayment(p, payments);
    const reason =
      isClosedAfterApproval(p)
        ? `— the approved application ${APPLICATION_CLOSED_SHORT[p.applicationClosed as FundingApplicationClosed] || 'closed'}; it no longer covers anything`
      // A declined row only blocks while nothing else covers the contract: once the other methods are
      // approved it stays on the record as history and Submit is allowed.
      : p.decision === 'declined' ? (covered ? null : 'was declined — reassign it')
      : openShort(p, covered) ? 'came back short — cover the difference'
      : isApplicationClosed(p)
        ? `— the application ${APPLICATION_CLOSED_SHORT[p.applicationClosed as FundingApplicationClosed] || 'closed'}; send a new link`
      : isFinancingBypassed(p) ? null
      : (p.type === 'cc' || (p.type === 'bank' && !opts?.offline)) && !p.linkSent ? '— link not sent yet'
      : p.type === 'bank' && !p.decision ? '— waiting on lender decision'
      : p.type === 'bank' && !p.activated ? '— loan not activated yet'
      : p.type === 'cc' && p.step < 2 && !p.charged ? '— card not on file yet'
      : p.type === 'cc' && p.kind === 'down' && !p.charged ? '— card on file but not charged'
      : p.type === 'check' && p.kind === 'down' && !p.collected ? '— check not marked collected'
      : null;
    if (reason) out.push(`${who} ${reason}`);
  });

  const total = payments.reduce((n, p) => n + netFundedAmount(p), 0);
  const heldOver = scopeOverCollectedBlocker(
    payments.filter(isSettledPayment).reduce((n, p) => n + Math.max(0, p.amount - refundedAgainst(p)), 0),
    price
  );
  if (heldOver) {
    out.push(heldOver);
  } else if (total < price - EPS) {
    out.push(`$${money(price - total)} of the contract is still unassigned`);
  } else if (total > price + EPS) {
    out.push(`$${money(total - price)} more than the contract price is allocated`);
  }

  if (opts?.setupBlocked) {
    out.push('Payments are not set up for your company yet — contact your office');
  }
  return out;
}

export function canResumeJobBuild(record: FundingRecord | null | undefined): boolean {
  return record?.status === 'submitted' && (record?.payments?.length || 0) > 0;
}

export function resumeOutcomeFromRecord(
  record: FundingRecord | null | undefined,
  plans: Record<string, DealPlan>
): Record<string, any> | null {
  if (!canResumeJobBuild(record)) return null;
  const payments = record!.payments || [];
  const down = payments.filter((p) => p.kind === 'down');
  const bal = payments.filter((p) => p.kind === 'bal');

  const keyOf = (p: FundingPayment) => planKeyForLabel(plans, p.method) || p.method || '';
  const primary = (rows: FundingPayment[]) => {
    const hit = rows.find((p) => p.method && fundedAmount(p) > 0) || rows.find((p) => p.method);
    return hit ? keyOf(hit) : '';
  };
  const allocate = (rows: FundingPayment[]): PaymentAllocation[] =>
    rows
      .filter((p) => p.method && fundedAmount(p) > 0)
      .map((p) => ({
        method: keyOf(p),
        amount: toWholeDollars(fundedAmount(p)),
        label: p.method,
        ...(p.type ? { type: p.type } : {}),
      }));

  return {
    resultType: 'sale' as const,
    oneLeg: 'No',
    contractPrice: record!.contractPrice || undefined,
    downPayment: groupTotal(down) || undefined,
    balance: groupTotal(bal),
    downPaymentMethod: primary(down) || undefined,
    balancePaymentMethod: primary(bal) || undefined,
    downPayments: allocate(down),
    balancePayments: allocate(bal),
    versatile: false,
    pineapple: false,
    bankDecline: record!.result === 'bankDecline',
    payments,
    fundingAttempts: record!.attemptHistory || [],
  };
}

export function groupTotal(payments: FundingPayment[]): number {
  return payments.reduce((n, p) => n + fundedAmount(p), 0);
}

/**
 * Build the funding record the Funding screen renders, from rows held on the device.
 *
 * Online the screen reads `funding.record`, which the server returns from `savePayments`.
 * Offline there is no server, so Confirm used to skip the screen entirely and jump to Build
 * Job - the rep never saw the Funding step, and the split they had just entered was never
 * shown back to them.
 *
 * Only CHECK rows can exist here: `confirmBlockers` already refuses to confirm offline while
 * any row needs a card or loan link, because those are minted server-side. So every row is
 * one the install crew collects, and the fields a card/loan row would carry stay at rest.
 */
export function offlineFundingRecord(
  leadId: string,
  contractPrice: number,
  rows: FundingUpsertRow[],
  payMode: PayMode
): FundingRecord {
  return {
    leadId,
    contractPrice: toWholeDollars(contractPrice),
    payMode,
    result: 'sale',
    status: 'pending',
    payments: rows.map((r, i) => ({
      pid: r.pid || newPaymentId(),
      kind: r.kind,
      method: r.method,
      type: r.type || 'check',
      amount: toWholeDollars(r.amount),
      step: i,
      linkSent: false,
      sentChannel: null,
      sentTo: null,
      decision: null,
      requested: null,
      approvedAmt: null,
      activated: false,
      charged: false,
      collected: false,
      syncedAt: null,
    })),
    attemptHistory: [],
  } as FundingRecord;
}

/** A financing row the lender approved (in full or part) and has not since closed. */
export function hasApprovedFinancing(payments: FundingPayment[]): boolean {
  return (payments || []).some(
    (p) => p.type === 'bank' && (p.decision === 'full' || p.decision === 'short') && !isClosedAfterApproval(p) && Number(p.approvedAmt) > 0
  );
}

export const BANK_DECLINE_BLOCKER =
  'The lender declined this financing. Add a new financing method and get it approved before you can submit this job.';

/**
 * While the job is resulted as a Bank Decline, nothing may be submitted until a NEW financing
 * method is approved. Returns the reason, or null when the rep may go on.
 */
export function bankDeclineSubmitBlocker(bankDeclined: boolean, payments: FundingPayment[]): string | null {
  if (!bankDeclined) return null;
  return hasApprovedFinancing(payments) ? null : BANK_DECLINE_BLOCKER;
}

export function hasDecline(record: FundingRecord | null | undefined): boolean {
  if (!record) return false;
  return (
    (record.payments || []).some((p) => p.decision === 'declined') ||
    (record.attemptHistory || []).some((a) => a.outcome === 'Declined')
  );
}

export function applyDecisionsToRows(
  rows: PaymentRow[],
  payments: FundingPayment[],
  price: number,
  mode: PayMode = 'split'
): { rows: PaymentRow[]; banners: DecisionBanner[] } {
  const gapKind = remainderKind(mode);
  const covered = coverageOK(payments, price);
  const banners: DecisionBanner[] = [];

  let next = rows.map((row) => {
    const p = payments.find((x) => x.pid === row.pid);
    if (!p) return row;

    const settled = {
      linkSent: p.linkSent,
      activated: p.activated,
      charged: p.charged,
      collected: p.collected,
    };

    if (!p.decision) return { ...row, ...settled };

    if (p.decision === 'declined') {
      banners.push({
        id: p.pid,
        tone: 'bad',
        text: `${shortMethod(p.method)} was declined. The full $${p.amount.toLocaleString()} needs a different payment method.`,
      });
      return { ...row, ...settled, amount: '0', auto: false, decision: 'declined' as Decision };
    }

    const approved = p.approvedAmt ?? p.amount;
    const requested = p.requested ?? p.amount;
    if (p.decision === 'short' && requested > approved) {
      banners.push({
        id: p.pid,
        tone: 'warn',
        text: `${shortMethod(p.method)} approved $${approved.toLocaleString()} of the $${requested.toLocaleString()} requested. Assign the remaining $${(requested - approved).toLocaleString()} to another payment method below.`,
      });
    }
    return { ...row, ...settled, amount: String(approved), auto: false, decision: p.decision };
  });

  if (banners.length && !covered) {
    const hasOpenRow = next.some((r) => r.kind === gapKind && !r.decision);
    if (!hasOpenRow) {
      next = [
        ...next,
        { pid: newPaymentId(), kind: gapKind, amount: '', method: '', ...(mode === 'split' ? { auto: true } : {}) },
      ];
    }
  }

  return { rows: next, banners };
}

export function needsAttentionRowId(
  rows: PaymentRow[],
  banners: DecisionBanner[],
  mode: PayMode = 'split'
): string | null {
  if (!banners.length) return null;
  const gapKind = remainderKind(mode);
  return rows.find((r) => r.kind === gapKind && !r.decision)?.pid ?? null;
}

export const REFUND_STATE_LABELS: Record<FundingRefundState, string> = {
  pendingApproval: 'Waiting on approval',
  pendingCustomer: 'Waiting on customer',
  customerSigned: 'Customer signed',
  issuing: 'Issuing',
  refunded: 'Refunded',
  failed: 'Failed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const REFUND_REASON_LABELS: Record<FundingRefundReason, string> = {
  priceDrop: 'Price reduced',
  jobCancelled: 'Job cancelled',
  bankDecline: 'Lender declined',
  customerDispute: 'Customer dispute',
  completionDispute: 'Completion dispute',
  other: 'Other',
};

const TERMINAL_REFUND_STATES: FundingRefundState[] = ['refunded', 'declined', 'cancelled'];

export function isRefundLive(r?: FundingRefund | null): boolean {
  if (!r || !r.state) return false;
  return !TERMINAL_REFUND_STATES.includes(r.state);
}

export function refundStateTone(state: FundingRefundState): 'ok' | 'warn' | 'bad' | 'muted' {
  if (state === 'refunded') return 'ok';
  if (state === 'declined' || state === 'failed') return 'bad';
  if (state === 'cancelled') return 'muted';
  return 'warn';
}

export function collectedOn(p: FundingPayment): number {
  if (!p) return 0;
  if (p.charged || p.collected) return fundedAmount(p);
  if (p.type === 'bank' && p.activated) return fundedAmount(p);
  return 0;
}

export function collectedDownPayment(payments: FundingPayment[]): number {
  return (payments || [])
    .filter((p) => p && p.kind !== 'bal')
    .reduce((n, p) => n + collectedOn(p), 0);
}

export function collectedTotal(payments: FundingPayment[]): number {
  return (payments || []).reduce((n, p) => n + collectedOn(p), 0);
}

export function refundableAmount(p: FundingPayment): number {
  const collected = collectedOn(p);
  if (collected <= 0) return 0;
  const spoken = (p.refunds || [])
    .filter((r) => r && r.state !== 'declined' && r.state !== 'cancelled')
    .reduce((n, r) => n + (Number(r.amount) || 0), 0);
  return Math.max(0, collected - spoken);
}

export function liveRefunds(payments: FundingPayment[]): { payment: FundingPayment; refund: FundingRefund }[] {
  const out: { payment: FundingPayment; refund: FundingRefund }[] = [];
  for (const p of payments || []) {
    for (const r of p?.refunds || []) if (isRefundLive(r)) out.push({ payment: p, refund: r });
  }
  return out;
}

export function refundDueFor(newContract: number, payments: FundingPayment[]): number {
  const collected = collectedTotal(payments);
  if (!(collected > 0)) return 0;
  const price = Number(newContract) || 0;
  const stillRefundable = (payments || []).reduce((n, p) => n + refundableAmount(p), 0);
  const spokenFor = collected - stillRefundable;
  return Math.max(0, Math.round(collected - price - spokenFor));
}

export function requiresRefundApproval(newContract: number, payments: FundingPayment[]): boolean {
  return refundDueFor(newContract, payments) > 0;
}

export function isDownPaymentLocked(newContract: number, payments: FundingPayment[]): boolean {
  const down = collectedDownPayment(payments);
  if (!(down > 0)) return false;
  return (Number(newContract) || 0) >= down;
}

export const REFUND_APPROVAL_WARNING =
  'new contract price is less than collected down payment. This will require approvals. Do you wish to proceed?';

export function refundBlockers(opts: {
  payment: FundingPayment | null;
  amount: number;
  method: FundingRefundMethod | '';
  reason: FundingRefundReason | '';
  approverId?: string;
  approversConfigured: boolean;
}): string[] {
  const { payment, amount, method, reason, approverId, approversConfigured } = opts;
  const out: string[] = [];

  if (!approversConfigured) {
    out.push('No refund approvers are configured — ask your admin to set them in the portal');
    return out;
  }
  if (!payment) return ['Pick the payment to refund'];

  const max = refundableAmount(payment);
  if (max <= 0) out.push('Nothing has been collected on this payment yet');
  // ⚠️ Whole dollars, everywhere in this system.
  else if (!(amount > 0) || !Number.isInteger(amount)) out.push('Enter a whole-dollar refund amount above zero');
  else if (amount > max) out.push(`Refund cannot be more than the $${money(max)} available on this payment`);

  if (!method) out.push('Choose how the money goes back');
  // ⚠️ A cheque can refund a card payment; a card cannot refund a non-card one.
  else if (method === 'card' && payment.type !== 'cc') out.push('Only a payment taken by card can be refunded to a card');

  if (!reason) out.push('Choose a reason for the refund');
  if (!approverId) out.push('Choose who approves this refund');
  return out;
}

export function pickableApprovers(
  feed: { approvers?: { id: string; name: string; roleName?: string }[]; allowSelfApproval?: boolean } | null | undefined,
  selfUserId?: string
): { id: string; name: string; roleName?: string }[] {
  const list = feed?.approvers || [];
  if (feed?.allowSelfApproval === false && selfUserId) {
    return list.filter((a) => String(a.id) !== String(selfUserId));
  }
  return list;
}

export const REFUND_APPROVAL_STEPS = ['Refund Raised', 'Approved', 'Customer Signs', 'Refunded'];

export function refundApprovalStates(refund?: FundingRefund | null): StepState[] {
  switch (refund?.state) {
    case 'pendingApproval':
      return ['done', 'warn', 'next', 'next'];
    case 'pendingCustomer':
      return ['done', 'done', 'warn', 'next'];
    case 'customerSigned':
    case 'issuing':
      return ['done', 'done', 'done', 'now'];
    case 'refunded':
      return ['done', 'done', 'done', 'done'];
    case 'failed':
      return ['done', 'done', 'done', 'bad'];
    case 'declined':
      return ['done', 'bad', 'locked', 'locked'];
    case 'cancelled':
      return ['done', 'locked', 'locked', 'locked'];
    default:
      return ['now', 'next', 'next', 'next'];
  }
}

export function refundApprovalNote(refund?: FundingRefund | null): string {
  switch (refund?.state) {
    case 'pendingApproval':
      return 'Out for approval. Approving does not return the money — it lets the customer sign.';
    case 'pendingCustomer':
      return 'Approved. Waiting on the customer to sign the addendum.';
    case 'customerSigned':
      return 'The customer has signed. A manager releases the money from Command Center.';
    case 'issuing':
      return 'On its way back to the customer.';
    case 'refunded':
      return 'The money has gone back to the customer.';
    case 'failed':
      return 'The refund failed on the way out and can be retried from Command Center.';
    case 'declined':
      return 'Declined. A declined request cannot be re-opened — raise a new refund.';
    case 'cancelled':
      return 'Cancelled. Nothing went back to the customer.';
    default:
      return 'Nothing is raised yet. Submitting the addendum sends this to the approver you choose.';
  }
}

export function refundsOnJob(payments: FundingPayment[]): { payment: FundingPayment; refund: FundingRefund }[] {
  const out: { payment: FundingPayment; refund: FundingRefund }[] = [];
  for (const p of payments || []) {
    for (const r of p?.refunds || []) if (r) out.push({ payment: p, refund: r });
  }
  return out.sort((a, b) => new Date(b.refund.at || 0).getTime() - new Date(a.refund.at || 0).getTime());
}

export function normalizeApproverFeed(body: any): {
  approvers: { id: string; name: string; email?: string; roleId?: string; roleName?: string }[];
  roles: { id: string; name: string }[];
  isConfigured: boolean;
  allowSelfApproval: boolean;
} {
  const b = body?.data?.data ?? body?.data ?? body ?? {};
  const approvers = (Array.isArray(b.approvers) ? b.approvers : [])
    .filter((a: any) => a && (a.id || a._id))
    .map((a: any) => ({
      id: String(a.id || a._id),
      name: String(a.name || a.fullName || a.email || 'Unnamed'),
      email: a.email,
      roleId: a.roleId,
      roleName: a.roleName || a.role,
    }));
  return {
    approvers,
    roles: Array.isArray(b.roles) ? b.roles : [],
    isConfigured: b.isConfigured === true || approvers.length > 0,
    allowSelfApproval: b.allowSelfApproval === true,
  };
}

export type AddendumRelease = 'send-now' | 'hold-for-approval' | 'abort';

export function addendumReleasePlan(o: {
  refundAcknowledged: boolean;
  hasSourceRow: boolean;
  gateClear: boolean;
  draftId?: string | null;
}): AddendumRelease {
  if (!o.refundAcknowledged) return 'send-now';
  const draftId = o.draftId ? String(o.draftId).trim() : '';
  if (o.hasSourceRow && o.gateClear && draftId) return 'hold-for-approval';
  return 'abort';
}

export function normalizeApprovalRows(body: any): ApprovalRecord[] {
  const b = body?.data?.data ?? body?.data ?? body ?? {};
  const rows = Array.isArray(b) ? b : Array.isArray(b.approvals) ? b.approvals : Array.isArray(b.rows) ? b.rows : [];
  return (rows as any[]).filter((r) => r && typeof r === 'object') as ApprovalRecord[];
}

export function approvalIdOf(approval?: ApprovalRecord | null): string {
  const id = approval?.id ?? approval?._id;
  return id ? String(id).trim() : '';
}

export function pickRefundApproval(
  rows: ApprovalRecord[] | null | undefined,
  refund?: FundingRefund | null
): ApprovalRecord | null {
  if (!refund) return null;
  const list = Array.isArray(rows) ? rows : [];
  const wantApproval = refund.approvalId ? String(refund.approvalId).trim() : '';
  if (wantApproval) {
    const byId = list.find((r) => approvalIdOf(r) === wantApproval);
    if (byId) return byId;
  }
  const wantRid = refund.rid ? String(refund.rid).trim() : '';
  if (wantRid) {
    const byRid = list.find((r) => {
      const subjectRid = r?.subject?.refundId ? String(r.subject.refundId).trim() : '';
      const embeddedRid = r?.refund?.rid ? String(r.refund.rid).trim() : '';
      return subjectRid === wantRid || embeddedRid === wantRid;
    });
    if (byRid) return byRid;
  }
  return null;
}

export function reminderOf(approval?: ApprovalRecord | null): FundingApprovalReminder | null {
  const r = approval?.reminder;
  if (!r || typeof r !== 'object') return null;
  return { ...r, canRemind: r.canRemind === true };
}

export function outstandingApprovals(rows: ApprovalRecord[] | null | undefined): ApprovalRecord[] {
  const done = new Set(['approved', 'declined', 'cancelled', 'canceled']);
  return (Array.isArray(rows) ? rows : []).filter((r) => !done.has(String(r?.state || '').toLowerCase()));
}

export function describeApproval(
  approval?: ApprovalRecord | null,
  payments?: FundingPayment[] | null
): string {
  const kind = String(approval?.type || '').toLowerCase() === 'refund' ? 'Refund' : 'Approval';
  const amount = Number(approval?.refund?.amount) || Number(refundForApproval(approval, payments)?.amount) || 0;
  return amount > 0 ? `${kind} · $${Math.round(amount).toLocaleString()}` : kind;
}

export function refundWaitingOn(state?: FundingRefundState | null): string {
  switch (state) {
    case 'pendingApproval':
      return 'Waiting on the approver';
    case 'pendingCustomer':
      return 'Waiting on the customer to sign';
    case 'customerSigned':
    case 'issuing':
      return 'Waiting on a manager to release the money in Command Center';
    default:
      return '';
  }
}

export function assignedApproverId(approval?: ApprovalRecord | null): string {
  const id = approval?.assignedToUserId ?? (approval?.assignedTo as any)?.id;
  return id ? String(id).trim() : '';
}

export function isApprovalAssigned(approval?: ApprovalRecord | null): boolean {
  return !!assignedApproverId(approval) || !!(approval?.assignedTo as any)?.name;
}

export function approverNameOf(
  approval?: ApprovalRecord | null,
  byUserId?: Record<string, string> | null
): string {
  const embedded = (approval?.assignedTo as any)?.name;
  if (embedded) return String(embedded).trim();
  const id = assignedApproverId(approval);
  const looked = id && byUserId ? byUserId[id] : '';
  return looked ? String(looked).trim() : '';
}

export function refundForApproval(
  approval?: ApprovalRecord | null,
  payments?: FundingPayment[] | null
): FundingRefund | null {
  const rid = approval?.subject?.refundId
    ? String(approval.subject.refundId).trim()
    : approval?.refund?.rid
      ? String(approval.refund.rid).trim()
      : '';
  if (!rid) return null;
  for (const p of payments || []) {
    for (const r of p?.refunds || []) if (r?.rid && String(r.rid).trim() === rid) return r;
  }
  return null;
}

export function waitingLabel(reminder?: FundingApprovalReminder | null, approverName?: string): string {
  if (!reminder) return '';
  const days = Number(reminder.waitingDays) || 0;
  const who = (approverName || '').trim();
  const span = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : 'today';
  return who ? `Waiting ${span} on ${who}` : `Waiting ${span}`;
}
