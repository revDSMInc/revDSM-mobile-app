import { logEvent } from '../../services/api/LoggerService';
import {
  FUNDING_MODULE,
  FUNDING_SOURCES,
  type FundingSource,
} from '../../constants/activity-log.constants';

export interface FundingLogBase {
  userId?: string;
  leadId?: string;
  calculatorId?: string;
  calculatorTitle?: string;
  source?: FundingSource;
}

export type { FundingSource };

export function resolveFundingSource(o: {
  lead?: { isRehashed?: boolean } | null;
  mode?: string | null;
}): FundingSource {
  if (o?.mode === 'edit') return FUNDING_SOURCES.MY_DEALS;
  if (o?.lead?.isRehashed === true) return FUNDING_SOURCES.REHASH;
  return FUNDING_SOURCES.SALE;
}

export function composeFundingAction(action: string, source?: FundingSource | null): string {
  const a = String(action || '');
  if (!source || !a) return a;
  if (a.startsWith(`${source}_`)) return a;
  return `${source}_${a}`;
}

export function baseFundingAction(action: string): string {
  return String(action || '').replace(
    new RegExp(`^(${Object.values(FUNDING_SOURCES).join('|')})_`),
    ''
  );
}

export interface FundingLogPayment {
  pid?: string;
  method?: string;
  type?: string;
  kind?: string;
  amount?: number;
}

const base = (o: FundingLogBase, extra: Record<string, unknown>) => ({
  ...(o.calculatorId ? { calculatorId: o.calculatorId } : {}),
  ...(o.calculatorTitle ? { calculatorTitle: o.calculatorTitle } : {}),
  ...(o.leadId ? { leadId: o.leadId } : {}),
  ...extra,
});

const paymentMeta = (p?: FundingLogPayment) =>
  p
    ? {
        ...(p.pid ? { paymentId: p.pid } : {}),
        ...(p.method ? { paymentMethod: p.method } : {}),
        ...(p.type ? { methodType: p.type } : {}),
        ...(p.kind ? { paymentKind: p.kind } : {}),
        ...(p.amount !== undefined ? { amount: p.amount } : {}),
      }
    : {};

const fire = (verb: string, o: FundingLogBase, meta: Record<string, unknown>) => {
  if (!o.userId) return Promise.resolve();
  return logEvent(verb, {
    user_id: o.userId,
    created_by: o.userId,
    module_type: FUNDING_MODULE,
    meta: base(o, {
      ...meta,
      action: composeFundingAction(String(meta.action || ''), o.source),
      ...(o.source ? { fundingSource: o.source } : {}),
    }),
  });
};

export const logFundingStructureChanged = (o: FundingLogBase & { from: string; to: string }) =>
  fire('select', o, { action: 'funding_structure_changed', from: o.from, to: o.to });

export const logFundingRowAdded = (o: FundingLogBase & { kind: string; rowCount?: number }) =>
  fire('add', o, {
    action: 'funding_payment_row_added',
    paymentKind: o.kind,
    ...(o.rowCount !== undefined ? { rowCount: o.rowCount } : {}),
  });

export const logFundingRowRemoved = (
  o: FundingLogBase & { kind: string; amount?: number; method?: string; methodLabel?: string },
) =>
  fire('delete', o, {
    action: 'funding_payment_row_removed',
    paymentKind: o.kind,
    ...(o.amount !== undefined ? { amount: o.amount } : {}),
    ...(o.method ? { paymentMethod: o.method } : {}),
    ...(o.methodLabel ? { methodLabel: o.methodLabel } : {}),
  });

export const logFundingMethodSelected = (
  o: FundingLogBase & { kind: string; method: string; methodLabel?: string; amount?: number },
) => {
  if (!o.method) return Promise.resolve();
  return fire('select', o, {
    action: 'funding_payment_method_selected',
    paymentKind: o.kind,
    paymentMethod: o.method,
    ...(o.methodLabel ? { methodLabel: o.methodLabel } : {}),
    ...(o.amount !== undefined ? { amount: o.amount } : {}),
  });
};

export const logFundingPaymentsSaved = (
  o: FundingLogBase & {
    contractPrice: number;
    payMode: string;
    payments: { kind: string; method: string; amount: number }[];
    ok: boolean;
    error?: string;
  },
) =>
  fire('save', o, {
    action: o.ok ? 'funding_payments_saved' : 'funding_payments_save_failed',
    contractPrice: o.contractPrice,
    payMode: o.payMode,
    paymentCount: o.payments.length,
    payments: o.payments,
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingOpened = (
  o: FundingLogBase & { contractPrice: number; paymentCount: number; payMode: string },
) =>
  fire('view', o, {
    action: 'funding_opened',
    contractPrice: o.contractPrice,
    paymentCount: o.paymentCount,
    payMode: o.payMode,
  });

export const logFundingEditPayments = (o: FundingLogBase & { reassigning?: boolean }) =>
  fire('navigate', o, {
    action: 'funding_edit_payments',
    ...(o.reassigning ? { reassigning: true } : {}),
  });

export const logFundingLinkRequested = (
  o: FundingLogBase & {
    payment: FundingLogPayment;
    ok: boolean;
    blocked?: boolean;
    resend?: boolean;
    error?: string;
  },
) =>
  fire('open', o, {
    action: o.ok ? 'funding_link_requested' : o.blocked ? 'funding_link_blocked' : 'funding_link_failed',
    ...paymentMeta(o.payment),
    ...(o.resend ? { resend: true } : {}),
    ...(o.ok ? {} : { outcome: o.blocked ? 'blocked' : 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingLinkSent = (
  o: FundingLogBase & {
    payment: FundingLogPayment;
    channel: string;
    destination?: string;
    resend?: boolean;
    reissued?: boolean;
    ok: boolean;
    error?: string;
  },
) =>
  fire('send', o, {
    action: o.ok ? 'funding_link_sent' : 'funding_link_send_failed',
    ...paymentMeta(o.payment),
    channel: o.channel,
    ...(o.destination ? { destination: o.destination } : {}),
    ...(o.resend ? { resend: true } : {}),
    ...(o.reissued ? { reissued: true } : {}),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingLinkCopied = (o: FundingLogBase & { payment: FundingLogPayment }) =>
  fire('click', o, { action: 'funding_link_copied', ...paymentMeta(o.payment) });

export const logFundingPaymentSynced = (
  o: FundingLogBase & { payment: FundingLogPayment; ok: boolean; result?: string; error?: string },
) =>
  fire('update', o, {
    action: o.ok ? 'funding_payment_synced' : 'funding_payment_sync_failed',
    ...paymentMeta(o.payment),
    ...(o.result ? { result: o.result } : {}),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingSyncAll = (o: FundingLogBase & { paymentCount: number }) =>
  fire('update', o, { action: 'funding_sync_all', paymentCount: o.paymentCount });

export const logFundingCheckCollected = (
  o: FundingLogBase & { payment: FundingLogPayment; ok: boolean; error?: string },
) =>
  fire('update', o, {
    action: o.ok ? 'funding_check_collected' : 'funding_check_collect_failed',
    ...paymentMeta(o.payment),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingCardOnFile = (
  o: FundingLogBase & { payment: FundingLogPayment; ok: boolean; error?: string },
) =>
  fire('update', o, {
    action: o.ok ? 'funding_card_on_file' : 'funding_card_on_file_failed',
    ...paymentMeta(o.payment),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingCardCharged = (
  o: FundingLogBase & { payment: FundingLogPayment; ok: boolean; declined?: boolean; error?: string },
) =>
  fire('submit', o, {
    action: o.ok ? 'funding_card_charged' : o.declined ? 'funding_card_declined' : 'funding_card_charge_failed',
    ...paymentMeta(o.payment),
    ...(o.ok ? {} : { outcome: o.declined ? 'declined' : 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingLoanActivated = (
  o: FundingLogBase & { payment: FundingLogPayment; approvedAmt?: number; ok: boolean; error?: string },
) =>
  fire('submit', o, {
    action: o.ok ? 'funding_loan_activated' : 'funding_loan_activate_failed',
    ...paymentMeta(o.payment),
    ...(o.approvedAmt !== undefined ? { approvedAmt: o.approvedAmt } : {}),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingLoanReactivated = (
  o: FundingLogBase & {
    payment: FundingLogPayment;
    from?: number;
    to?: number;
    ok: boolean;
    error?: string;
  },
) =>
  fire('update', o, {
    action: o.ok ? 'funding_loan_reactivated' : 'funding_loan_reactivate_failed',
    ...paymentMeta(o.payment),
    ...(o.from !== undefined ? { previousAmount: o.from } : {}),
    ...(o.to !== undefined ? { newAmount: o.to } : {}),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingPlanRestored = (
  o: FundingLogBase & {
    payment: FundingLogPayment;
    restored?: string;
    displaced?: string;
    ok: boolean;
    error?: string;
  },
) =>
  fire('update', o, {
    action: o.ok ? 'funding_plan_restored' : 'funding_plan_restore_failed',
    ...paymentMeta(o.payment),
    ...(o.restored ? { restoredMethod: o.restored } : {}),
    ...(o.displaced ? { displacedMethod: o.displaced } : {}),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingResultChanged = (
  o: FundingLogBase & { result: string; ok: boolean; error?: string },
) =>
  fire('select', o, {
    action: 'funding_result_changed',
    result: o.result,
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

export const logFundingSubmitted = (
  o: FundingLogBase & {
    contractPrice: number;
    paymentCount: number;
    bankDecline?: boolean;
    ok: boolean;
    blockers?: string[];
    error?: string;
  },
) =>
  fire('submit', o, {
    action: o.ok ? 'funding_submitted' : 'funding_submit_blocked',
    contractPrice: o.contractPrice,
    paymentCount: o.paymentCount,
    ...(o.bankDecline ? { bankDecline: true } : {}),
    ...(o.ok
      ? {}
      : {
          outcome: 'blocked',
          ...(o.blockers?.length ? { blockers: o.blockers } : {}),
          ...(o.error ? { error: o.error } : {}),
        }),
  });
