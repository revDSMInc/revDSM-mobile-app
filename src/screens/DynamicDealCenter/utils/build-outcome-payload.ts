/**
 * build-outcome-payload.ts — pure builder for the calculator-scoped LeadOutcome
 * payload (`PUT lead/v1/{leadId}/outcome/{calculatorId}`). Ports the field set the
 * web result modal persists (`result-lead-modal.js` handleUpdateJobBuilder /
 * JobBuilderContext.buildSavePayload), closing these mobile gaps:
 *   - `LFCalculator`: the full calculator snapshot (web always sends it, with a
 *     `{}` fallback for backend validation). Mobile previously omitted it.
 *   - `selectedAppointmentId`: web sends `targetCalc?.appointmentId || formData.selectedAppointmentId`.
 *   - Demo `lastPriceQuoted`: web persists the last price quoted for a Demo; mobile
 *     dropped it (passed `undefined`) because the modal cleared contractPrice for demos.
 *   - `versatile` / `pineapple`: mobile-only extras — now included so they rehydrate on reopen.
 */

export interface ResultData {
  resultType?: 'sale' | 'demo';
  result?: string;
  oneLeg?: string;
  contractPrice?: number;
  originalContractPrice?: number;
  lastPriceQuoted?: number;
  downPayment?: number;
  balance?: number;
  downPaymentMethod?: string;
  balancePaymentMethod?: string;
  demoReason?: string;
  reasonExplanation?: string;
  versatile?: boolean;
  pineapple?: boolean;
  LFCalculator?: any;
  selectedAppointmentId?: string;
  calculatorId?: string;
  appointmentId?: string;
}

export function normalizeResult(rd: ResultData): 'Sale' | 'Demo' | undefined {
  const t = (rd.resultType || rd.result || '').toString().toLowerCase();
  if (t === 'sale') return 'Sale';
  if (t === 'demo') return 'Demo';
  return undefined;
}

/**
 * Build the calculator-scoped outcome payload. `jobBuilder` is the serialized
 * job-builder wrapper (draft or submitted). `fallbackAppointmentId` (usually the
 * leadId) is used when neither the calculator nor the result data carries one.
 */
export function buildCalculatorOutcomePayload(args: {
  rd: ResultData;
  calcId: string;
  jobBuilder: any;
  fallbackAppointmentId?: string;
}): Record<string, any> {
  const { rd, calcId, jobBuilder, fallbackAppointmentId } = args;
  const result = normalizeResult(rd);
  const isDemo = result === 'Demo';

  // Web: lastPriceQuoted is the demo's quoted price; contractPrice drives it for
  // sales' originalContractPrice. Demo's contractPrice is cleared in the modal, so
  // prefer the explicit lastPriceQuoted field.
  const lastPriceQuoted = isDemo
    ? rd.lastPriceQuoted ?? rd.contractPrice
    : rd.lastPriceQuoted ?? rd.contractPrice;

  // Web parity (JobBuilderContext.buildSavePayload): ONLY include `LFCalculator`
  // when it is a FULL backend calculator doc. The backend's `LFCalculator` is a
  // Mongoose subdocument whose `createdBy`/`appointmentId`/`title` are all required
  // — sending an empty `{}` (or a partial local tab that lacks them) triggers those
  // required-field validators and 500s the whole PUT ("Validation failed:
  // LFCalculator.createdBy is required, ..."). Web always has the real doc from
  // `GET /appointments/{id}/lfcalculators`, so its snapshot passes; mobile's in-memory
  // `CalcTab` does NOT carry `createdBy`/`appointmentId`, so it must be omitted and the
  // backend stores null (which the reopen / summary / edit paths all tolerate).
  const lf = rd.LFCalculator;
  const hasLFCalculator =
    lf && typeof lf === 'object' && lf.createdBy && lf.appointmentId && lf.title;

  return {
    selectedCalculatorId: calcId,
    oneLeg: rd.oneLeg,
    result,
    reason: rd.demoReason,
    explain: rd.reasonExplanation,
    lastPriceQuoted,
    originalContractPrice: rd.contractPrice ?? rd.originalContractPrice,
    downPayment: rd.downPayment,
    // Web outcome uses `paymentMethod` for the down-payment method (not `downPaymentMethod`).
    paymentMethod: rd.downPaymentMethod,
    balancePaymentMethod: rd.balancePaymentMethod,
    balance: rd.balance,
    // Web parity — the associated calculator snapshot (only when present).
    ...(hasLFCalculator && { LFCalculator: rd.LFCalculator }),
    selectedAppointmentId: rd.selectedAppointmentId || rd.LFCalculator?.appointmentId || fallbackAppointmentId,
    // Mobile-only extras (harmless additional keys; rehydrate on reopen).
    versatile: rd.versatile,
    pineapple: rd.pineapple,
    jobBuilder,
  };
}
