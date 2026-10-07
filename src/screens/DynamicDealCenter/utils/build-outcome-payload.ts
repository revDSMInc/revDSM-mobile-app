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
  downPayments?: { method: string; amount: number; label?: string; type?: string }[];
  balancePayments?: { method: string; amount: number; label?: string; type?: string }[];
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

export function buildCalculatorOutcomePayload(args: {
  rd: ResultData;
  calcId: string;
  jobBuilder: any;
  fallbackAppointmentId?: string;
}): Record<string, any> {
  const { rd, calcId, jobBuilder, fallbackAppointmentId } = args;
  const result = normalizeResult(rd);
  const isDemo = result === 'Demo';

  const lastPriceQuoted = isDemo
    ? rd.lastPriceQuoted ?? rd.contractPrice
    : rd.lastPriceQuoted ?? rd.contractPrice;

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
    paymentMethod: rd.downPaymentMethod,
    balancePaymentMethod: rd.balancePaymentMethod,
    balance: rd.balance,
    ...(rd.downPayments ? { downPayments: rd.downPayments } : {}),
    ...(rd.balancePayments ? { balancePayments: rd.balancePayments } : {}),
    ...(hasLFCalculator && { LFCalculator: rd.LFCalculator }),
    selectedAppointmentId: rd.selectedAppointmentId || rd.LFCalculator?.appointmentId || fallbackAppointmentId,
    versatile: rd.versatile,
    pineapple: rd.pineapple,
    jobBuilder,
  };
}
