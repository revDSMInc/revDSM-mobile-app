import type { FundingRefund } from '../services/api/FundingService';
import type { FundingPayment } from '../screens/DynamicDealCenter/utils/funding';

function toMoney(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function isAcceptedRefund(refund?: FundingRefund | null): boolean {
  const accepted = new Set(['customerSigned', 'issuing', 'refunded']);
  return accepted.has(String(refund?.state || ''));
}

function isDeadRefund(refund?: FundingRefund | null): boolean {
  const dead = new Set(['declined', 'cancelled', 'canceled']);
  return dead.has(String(refund?.state || ''));
}

function allRefunds(payments?: FundingPayment[] | null): FundingRefund[] {
  const out: FundingRefund[] = [];
  for (const p of payments || []) for (const r of p?.refunds || []) if (r) out.push(r);
  return out;
}

export function acceptedRefundTotal(payments?: FundingPayment[] | null): number {
  return Math.round(
    allRefunds(payments)
      .filter(isAcceptedRefund)
      .reduce((n, r) => n + (Number(r.amount) || 0), 0)
  );
}

export function firstAcceptedRefund(payments?: FundingPayment[] | null): FundingRefund | null {
  const dated = allRefunds(payments)
    .filter(isAcceptedRefund)
    .map((r) => ({ r, t: Date.parse(String(r.at || '')) }));
  const withDate = dated.filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  if (withDate.length) return withDate[0].r;
  return dated.length ? dated[0].r : null;
}

export function paymentsFromFunding(body: any): FundingPayment[] {
  const record = body?.data?.funding ?? body?.funding ?? body?.data ?? body;
  const rows = record?.payments;
  return Array.isArray(rows) ? rows : [];
}

export function fundingContractPrice(body: any): number | null {
  const record = body?.data?.funding ?? body?.funding ?? body?.data ?? body;
  return toMoney(record?.contractPrice);
}

export function contractPricesFromDraft(draft: any): { before: number; after: number } | null {
  const before = toMoney(draft?.current?.pricing?.originalContractPrice);
  const after = toMoney(draft?.proposed?.pricing?.originalContractPrice);
  if (before === null || after === null) return null;
  return { before, after };
}

export function contractFromSaleParts(down: any, balance: any): number | null {
  const d = toMoney(down);
  const b = toMoney(balance);
  if (d === null && b === null) return null;
  return (d || 0) + (b || 0);
}

export function resolveBeforePrice(candidates: (number | null | undefined)[], after: number): number | null {
  const viable = (candidates || [])
    .map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : null))
    .filter((c): c is number => c !== null && c > after);
  return viable.length ? Math.max(...viable) : null;
}

export interface ContractRefundSummary {
  before: number | null;
  after: number;
  refunded: number;
  accepted: boolean;
  multiple: boolean;
  settled: boolean;
  refund: FundingRefund;
}

export function buildContractRefundSummary(opts: {
  payments?: FundingPayment[] | null;
  currentContractPrice: number;
  draftSummary?: any;
  fundingContractPrice?: number | null;
  saleTotal?: number | null;
}): ContractRefundSummary | null {
  const refunds = allRefunds(opts.payments).filter((r) => !isDeadRefund(r));
  if (!refunds.length) return null;

  const after = Number(opts.currentContractPrice) || 0;
  const accepted = refunds.filter(isAcceptedRefund);
  const isAccepted = accepted.length > 0;

  const representative = isAccepted ? firstAcceptedRefund(opts.payments)! : refunds[0];

  const refunded = isAccepted
    ? acceptedRefundTotal(opts.payments)
    : Math.round(refunds.reduce((n, r) => n + (Number(r.amount) || 0), 0));

  // ⚠️ Only an ACCEPTED refund earns a "before" price — see the in-flight note above.
  const before = isAccepted
    ? resolveBeforePrice(
        [contractPricesFromDraft(opts.draftSummary)?.before, opts.fundingContractPrice, opts.saleTotal],
        after
      )
    : null;

  return {
    before,
    after,
    refunded,
    accepted: isAccepted,
    multiple: accepted.length > 1,
    settled: isAccepted && accepted.every((r) => String(r.state) === 'refunded'),
    refund: representative,
  };
}
