import { LeadService } from '../../../services/api/leads';

export interface OutcomeDocRows {
  agreements: any[];
  orderSheets: any[];
}

export interface LocalDocFile {
  id: string;
  serverId: string | null;
  name: string;
  url: string;
  uri: string;
  contentType: string;
  filePath: string | null;
  bucketName: string | null;
  documentType: 'agreement' | 'orderSheet';
  isNew: false;
  /** Byte size the server reports (REVUIUX-569: matches a remembered original when the route is not deployed). */
  size?: number | null;
  /** REVUIUX-569: the annotation state the server attaches to an order sheet (`revision`, `data`, `twin`...). */
  annotation?: any;
}

const isEmptyRows = (rows?: OutcomeDocRows | null) =>
  !rows || (!(rows.agreements || []).length && !(rows.orderSheets || []).length);

const unwrapOutcome = (body: any) =>
  body?.data?.outcome ?? body?.outcome ?? body?.data ?? body;

export function isMissingOutcome(e: any): boolean {
  return (e?.response?.status ?? e?.httpStatus) === 404;
}

export async function fetchOutcomeDocumentRows(
  leadId?: string,
  calculatorId?: string
): Promise<OutcomeDocRows | null> {
  if (!leadId || !calculatorId) return null;
  try {
    const res = await LeadService.getLeadOutcomeByCalculator(leadId, calculatorId);
    const outcome = unwrapOutcome(res?.data);
    const docs = outcome?.leadOutcomeDocuments;
    if (!docs) return null;
    return {
      agreements: docs.agreements || [],
      orderSheets: docs.orderSheets || [],
    };
  } catch (e) {
    if (!isMissingOutcome(e)) {
      console.warn('[outcome-documents] calculator-scoped document read failed:', e);
    }
    return null;
  }
}

export function dropUnnamedAgreements<T extends Record<string, any>>(rows: T[]): T[] {
  const list = rows || [];
  const named = list.filter((d) => String(d?.name || '').trim());
  return named.length ? named : list;
}

export function dropUnnamedAgreementRows<T extends Record<string, any>>(rows: T[]): T[] {
  const list = rows || [];
  const isAgreement = (d: any) => (d?.documentType || d?._group) === 'agreement';
  const kept = new Set(dropUnnamedAgreements(list.filter(isAgreement)));
  return list.filter((d) => !isAgreement(d) || kept.has(d));
}

export async function resolveOutcomeDocRows(
  rows?: OutcomeDocRows | null
): Promise<OutcomeDocRows> {
  const empty: OutcomeDocRows = { agreements: [], orderSheets: [] };
  if (isEmptyRows(rows)) return empty;

  const all = [
    ...((rows!.agreements || []) as any[]).map((d) => ({ ...d, _group: 'agreement' })),
    ...((rows!.orderSheets || []) as any[]).map((d) => ({ ...d, _group: 'orderSheet' })),
  ];
  const paths = all
    .map((d) => ({ filePath: d.filePath, bucketName: d.bucketName }))
    .filter((p) => p.filePath && p.bucketName);

  let urls: any[] = [];
  if (paths.length) {
    try {
      const urlRes = await LeadService.getSecureUrls(paths);
      urls = (urlRes.data?.data || urlRes.data || []) as any[];
    } catch (e) {
      console.warn('[outcome-documents] secure URL resolution failed:', e);
    }
  }

  const mapped: LocalDocFile[] = dropUnnamedAgreementRows(all).map((d, i) => {
    const u = urls.find((x) => x.filePath === d.filePath);
    const type = (d.documentType || d._group) as 'agreement' | 'orderSheet';
    const url = u?.secureUrl || u?.url || d.filePath || '';
    return {
      id: String(d._id || `s3-${i}`),
      serverId: d._id || null,
      name: d.name || (type === 'agreement' ? 'Agreement' : 'Order Sheet'),
      url,
      uri: url,
      contentType: d.fileData?.contentType || d.contentType || '',
      filePath: d.filePath || null,
      bucketName: d.bucketName || null,
      documentType: type,
      isNew: false,
      size: d.fileData?.size ?? null,
      annotation: d.annotation ?? null,
    };
  });

  return {
    agreements: mapped.filter((m) => m.documentType === 'agreement'),
    orderSheets: mapped.filter((m) => m.documentType === 'orderSheet'),
  };
}

export async function loadResolvedOutcomeDocuments(
  leadId?: string,
  calculatorId?: string
): Promise<OutcomeDocRows> {
  return resolveOutcomeDocRows(await fetchOutcomeDocumentRows(leadId, calculatorId));
}

export async function fetchLeadOutcomeDocumentRows(
  leadId?: string
): Promise<OutcomeDocRows | null> {
  if (!leadId) return null;
  try {
    const res = await LeadService.downloadOutcomeDocuments(leadId);
    const body: any = res?.data;
    const docs = body?.data ?? body;
    if (!docs) return null;
    return { agreements: docs.agreements || [], orderSheets: docs.orderSheets || [] };
  } catch (e) {
    console.warn('[outcome-documents] lead-scoped document read failed:', e);
    return null;
  }
}
