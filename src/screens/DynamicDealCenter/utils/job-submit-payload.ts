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

export function toPayloadAmount(value: any): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = String(value).trim();
  return text;
}

export function toPayloadText(value: any): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

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

export function buildCalculatorDocument(
  serverDocument: any,
  tab: any,
  ctx: { calculatorId?: string | null; appointmentId?: string | null; leadId?: string | null; enteredBy?: string | null } = {}
): Record<string, any> | null {
  const doc = serverDocument && typeof serverDocument === 'object' ? serverDocument : null;
  const local = tab && typeof tab === 'object' ? tab : null;
  if (!doc && !local) return null;

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
