/**
 * The `POST /lead/v1/{leadId}/job-builder` body, built to the shape the backend
 * documents (`payload.dynamic.json`) and the web app actually sends
 * (`web-job-builder.txt`, a capture of a real web submit).
 *
 * ```
 * {
 *   leadData: {
 *     oneLeg, result, reason, explain, lastPriceQuoted, originalContractPrice,
 *     downPayment, paymentMethod, balancePaymentMethod, balance,
 *     LFCalculator,                 // the FULL calculator document
 *     selectedCalculatorId, selectedAppointmentId,
 *     jobBuilder,                   // web sends this on its outcome save too
 *   },
 *   isDynamic, configId, configSnapshotId,
 *   jobState,                  // serialized dynamic job state
 *   agreements: [{ name, file, type }],
 *   orderSheets: [], paperWork: [], downPaymentReceipt: [],
 * }
 * ```
 *
 * Pure and RN-free so the assembly is testable — `DynamicJobBuilderScreen` is
 * not (same reason `utils/uploaded-document-refs.ts` and
 * `utils/addendum-drafts.ts` exist).
 *
 * ⚠️ MONEY FIELDS GO OUT AS STRINGS. Both reference payloads carry
 * `"originalContractPrice": "24900"` / `"balance": "21900"` — web's `formData`
 * holds them as typed text — while mobile's result modal produces numbers.
 * A field with no value is `''`, never `0` and never omitted: `0` reads as a
 * real quoted amount on the portal.
 *
 * ⚠️ `lastPriceQuoted` is DEMO-only and `originalContractPrice` is SALE-only
 * (web `result-lead-modal.js`: `formData.result === 'Demo' ? … : ''`). The other
 * one is blanked, not carried over from the modal's state.
 */

export interface SubmitDocumentPayload {
  name: string;
  file: string;
  type?: string;
}

export interface JobSubmitPayload {
  leadData: Record<string, any>;
  isDynamic: boolean;
  configId: string | null;
  configSnapshotId: string;
  jobState: any;
  agreements: SubmitDocumentPayload[];
  orderSheets: SubmitDocumentPayload[];
  paperWork: SubmitDocumentPayload[];
  downPaymentReceipt: SubmitDocumentPayload[];
}

/** Numbers/nulls → the reference payload's string form; nothing entered → `''`. */
export function toPayloadAmount(value: any): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = String(value).trim();
  return text;
}

/** Free-text fields: never `undefined`/`null` in the payload. */
export function toPayloadText(value: any): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

/**
 * The calculator document out of a `GET /lfcalculators/{id}` response body.
 *
 * ⚠️ The wrapper shape varies by deployment — the repo already reads it four
 * ways (`DynamicDealEditScreen`: `body?.data?.calculator ?? body?.data ??
 * body?.calculator ?? body`). A wrapper sent as the calculator is exactly what
 * "LFCalculator is not appended" looks like from the outside, so the unwrap is
 * shared and verified rather than re-guessed per call site: anything without an
 * `_id` is treated as UNRESOLVED so the caller falls back to the local tab.
 */
export function extractCalculatorDocument(responseBody: any): any | null {
  const candidates = [
    responseBody?.data?.calculator,
    responseBody?.data,
    responseBody?.calculator,
    responseBody,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && candidate._id) {
      return candidate;
    }
  }
  return null;
}

/**
 * The calculator document `leadData.LFCalculator` carries.
 *
 * ⚠️ The SERVER copy is authoritative — it is the only source with `_id`,
 * `createdBy`, `appointmentId`, `createdAt`/`updatedAt` and the full 40-entry
 * `entries` array the reference payload shows. Mobile used to attach its
 * in-memory `CalcTab`, which has none of those (its `entries` is a MAP keyed by
 * field id, not an array), and then dropped the whole key whenever the tab
 * lacked `createdBy`/`appointmentId` — so in practice the submit went out with
 * no calculator at all.
 *
 * The local tab is a FALLBACK only, for when the read-back fails; every field
 * the server would have supplied is filled from what the tab knows so the shape
 * is never partial.
 */
export function buildCalculatorDocument(
  serverDocument: any,
  tab: any,
  ctx: { calculatorId?: string | null; appointmentId?: string | null; leadId?: string | null; enteredBy?: string | null } = {}
): Record<string, any> | null {
  const doc = serverDocument && typeof serverDocument === 'object' ? serverDocument : null;
  const local = tab && typeof tab === 'object' ? tab : null;
  if (!doc && !local) return null;

  // A saved calculator stores `entries` as an ARRAY; the in-memory tab keys them
  // by field id, so a fallback has to flatten the map back out.
  const entriesOf = (source: any): any[] => {
    const raw = source?.entries;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return Object.values(raw);
    return [];
  };

  const entries = doc && entriesOf(doc).length ? entriesOf(doc) : entriesOf(local);
  const pick = (key: string, fallback: any = undefined) => {
    const fromDoc = doc?.[key];
    if (fromDoc !== undefined && fromDoc !== null) return fromDoc;
    const fromLocal = local?.[key];
    if (fromLocal !== undefined && fromLocal !== null) return fromLocal;
    return fallback;
  };

  return {
    _id: pick('_id', ctx.calculatorId || local?.id || null),
    title: pick('title', ''),
    appointmentId: pick('appointmentId', ctx.appointmentId || null),
    createdBy: pick('createdBy', ctx.enteredBy || null),
    paymentMethod: pick('paymentMethod', ''),
    isRolloutConfirmed: Boolean(pick('isRolloutConfirmed', false)),
    rolloutConfirmedAt: pick('rolloutConfirmedAt', null),
    pricemarkup: pick('pricemarkup', ''),
    position: pick('position', 0),
    defaultPaymentMethod: pick('defaultPaymentMethod', ''),
    activeVertical: pick('activeVertical', ''),
    deletedAt: doc?.deletedAt ?? null,
    entries,
    totals: pick('totals', { cost: 0, par: 0, retail: 0 }),
    schemaSnapshotId: pick('schemaSnapshotId', null),
    enteredAt: pick('enteredAt', null),
    enteredBy: pick('enteredBy', ctx.enteredBy || null),
    dropPrice: pick('dropPrice', []) || [],
    createdAt: pick('createdAt', null),
    updatedAt: pick('updatedAt', null),
    discountPercentage: pick('discountPercentage', 0),
    leadId: pick('leadId', ctx.leadId || null),
    price: pick('price', 0),
    descriptions: pick('descriptions', []) || [],
    appointmentTitle: pick('appointmentTitle', ''),
  };
}

/**
 * `leadData`, assembled to web's `cleanLeadData`
 * (`sections/job/components/result-lead-modal.js`) key for key.
 *
 * ⚠️ Everything the result modal ALSO carries (`versatile`, `pineapple`,
 * `resultType`, `demoReason`, …) is deliberately NOT spread in: the contract has
 * a fixed key set, and those fields still reach the backend through the
 * lead-scoped outcome mirror that runs right after this POST.
 *
 * ⚠️ The calculator goes out ONLY as `LFCalculator` — web's spelling, and what
 * web normalizes a stored `lfCalculator` back to on read (`result-lead-modal.js`).
 * A lowercase alias carrying the same object shipped briefly and was removed on
 * request: two copies of one document in one payload is a duplicate, not a
 * safety net. If the backend ever turns out to read the lowercase key, RENAME
 * this one — do not add the second.
 *
 * ⚠️ It is NEVER null. Web's last line before saving is *"ensure LFCalculator is
 * at least an empty object for backend validation"* — an absent/null calculator
 * is what the validator rejects.
 *
 * ⚠️ `selectedAppointmentId` prefers the CALCULATOR's own `appointmentId`
 * (web: `targetCalc?.appointmentId || formData.selectedAppointmentId`) — the
 * calculator is the record that actually knows which appointment it belongs to.
 */
export function buildSubmitLeadData({
  resultData = {},
  result,
  calculatorDocument,
  selectedCalculatorId,
  selectedAppointmentId,
  jobBuilder,
}: {
  resultData?: any;
  result: 'Sale' | 'Demo';
  calculatorDocument?: Record<string, any> | null;
  selectedCalculatorId?: string | null;
  selectedAppointmentId?: string | null;
  jobBuilder?: any;
}): Record<string, any> {
  const isSale = result === 'Sale';
  const rd = resultData || {};

  return {
    oneLeg: toPayloadText(rd.oneLeg ?? 'No'),
    result,
    reason: toPayloadText(isSale ? '' : rd.demoReason ?? rd.reason),
    explain: toPayloadText(isSale ? '' : rd.reasonExplanation ?? rd.explain),
    lastPriceQuoted: isSale ? '' : toPayloadAmount(rd.lastPriceQuoted ?? rd.contractPrice),
    originalContractPrice: isSale
      ? toPayloadAmount(rd.contractPrice ?? rd.originalContractPrice)
      : '',
    downPayment: toPayloadAmount(rd.downPayment),
    paymentMethod: toPayloadText(rd.downPaymentMethod ?? rd.paymentMethod),
    balancePaymentMethod: toPayloadText(rd.balancePaymentMethod),
    balance: toPayloadAmount(rd.balance),
    LFCalculator: calculatorDocument || {},
    selectedCalculatorId: selectedCalculatorId || null,
    selectedAppointmentId:
      (calculatorDocument as any)?.appointmentId || selectedAppointmentId || null,
    jobBuilder,
  };
}

/**
 * The whole request body. `agreements` / `orderSheets` / `paperWork` /
 * `downPaymentReceipt` are ALWAYS present, empty arrays included — the backend
 * contract lists all four groups, and an absent key is not the same as an empty
 * one for a partial-update handler.
 */
export function buildJobSubmitPayload({
  leadData,
  jobState,
  configId,
  agreements = [],
  orderSheets = [],
  paperWork = [],
  downPaymentReceipt = [],
}: {
  leadData: Record<string, any>;
  jobState: any;
  configId: string | null;
  agreements?: SubmitDocumentPayload[];
  orderSheets?: SubmitDocumentPayload[];
  paperWork?: SubmitDocumentPayload[];
  downPaymentReceipt?: SubmitDocumentPayload[];
}): JobSubmitPayload {
  return {
    leadData,
    isDynamic: true,
    configId: configId || null,
    configSnapshotId: configId || 'dynamic',
    jobState,
    agreements,
    orderSheets,
    paperWork,
    downPaymentReceipt,
  };
}
