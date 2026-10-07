import { logEvent } from '../../services/api/LoggerService';
import { RESULT_LEAD_MODULE } from '../../constants/activity-log.constants';
import { composeFundingAction, type FundingLogBase, type FundingSource } from './funding-log';

export type ResultLeadLogBase = FundingLogBase;

export type { FundingSource };

const base = (o: ResultLeadLogBase, extra: Record<string, unknown>) => ({
  ...(o.calculatorId ? { calculatorId: o.calculatorId } : {}),
  ...(o.calculatorTitle ? { calculatorTitle: o.calculatorTitle } : {}),
  ...(o.leadId ? { leadId: o.leadId } : {}),
  ...extra,
});

const fire = (verb: string, o: ResultLeadLogBase, meta: Record<string, unknown>) => {
  if (!o.userId) return Promise.resolve();
  return logEvent(verb, {
    user_id: o.userId,
    created_by: o.userId,
    module_type: RESULT_LEAD_MODULE,
    meta: base(o, {
      ...meta,
      action: composeFundingAction(String(meta.action || ''), o.source),
      ...(o.source ? { fundingSource: o.source } : {}),
    }),
  });
};

export const logResultLeadOpened = (
  o: ResultLeadLogBase & {
    resultType: string;
    payMode: string;
    contractPrice?: number;
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

export const logResultLeadBuildJob = (
  o: ResultLeadLogBase & { resultType: string; contractPrice?: number; reason?: string },
) =>
  fire('submit', o, {
    action: 'result_lead_build_job',
    resultType: o.resultType,
    ...(o.contractPrice ? { contractPrice: o.contractPrice } : {}),
    ...(o.reason ? { reason: o.reason } : {}),
  });

export const logResultLeadStructureChanged = (
  o: ResultLeadLogBase & { from: string; to: string },
) => fire('select', o, { action: 'result_lead_structure_changed', from: o.from, to: o.to });

export const logResultLeadRowAdded = (o: ResultLeadLogBase & { kind: string; rowCount?: number }) =>
  fire('add', o, {
    action: 'result_lead_payment_row_added',
    paymentKind: o.kind,
    ...(o.rowCount !== undefined ? { rowCount: o.rowCount } : {}),
  });

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
