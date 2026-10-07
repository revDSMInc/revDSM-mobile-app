import RNFS from 'react-native-fs';
import { LeadService } from '../../../services/api/leads';
import { convertJpegToPdfAsync } from '../../../utils/jpeg-to-pdf-native';

export interface DocumentPayload {
  name: string;
  file: string;
  type: 'agreement' | 'orderSheet';
}

export interface DocumentPayloads {
  agreements: DocumentPayload[];
  orderSheets: DocumentPayload[];
}

const toFlatFiles = (arr?: any[]): any[] =>
  (arr || []).flatMap((x) => (x && Array.isArray(x.files) ? x.files : [x])).filter(Boolean);

const isPdfFile = (f: any) =>
  String(f?.contentType || f?.mimeType || '').includes('pdf') ||
  String(f?.name || f?.uri || f?.url || '').toLowerCase().endsWith('.pdf');

const dataUriOf = (f: any): string | null => {
  const candidates = [f?.file, f?.blob, f?.displayUrl, f?.url, f?.uri];
  const inline = candidates.find((v) => typeof v === 'string' && v.startsWith('data:'));
  return (inline as string) || null;
};

const localFilePath = (uri: any): string | null => {
  if (typeof uri !== 'string' || !uri) return null;
  if (/^(https?|data):/i.test(uri)) return null;
  return uri.startsWith('file://') ? uri.replace('file://', '') : uri;
};

const serverIdOf = (f: any): string | null => {
  const id = f?.serverId ?? f?._id ?? f?.id;
  return id ? String(id) : null;
};

async function readFileBytes(
  file: any,
  serverBase64ById: Map<string, { base64: string; contentType: string }>
): Promise<{ base64: string; isPdf: boolean } | null> {
  const inline = dataUriOf(file);
  if (inline) {
    return {
      base64: inline.replace(/^data:[^;]*;base64,/, ''),
      isPdf: inline.startsWith('data:application/pdf'),
    };
  }

  const serverId = serverIdOf(file);
  if (serverId && serverBase64ById.has(serverId)) {
    const hit = serverBase64ById.get(serverId)!;
    return {
      base64: String(hit.base64).replace(/^data:[^;]*;base64,/, ''),
      isPdf: hit.contentType.includes('pdf') || isPdfFile(file),
    };
  }

  const localPath = localFilePath(file?.uri);
  if (localPath) {
    try {
      const base64 = await RNFS.readFile(localPath, 'base64');
      return { base64, isPdf: isPdfFile(file) };
    } catch (e) {
      console.warn('[document-payloads] could not read local document:', e);
    }
  }

  return null;
}

interface StoredDocuments {
  byId: Map<string, { base64: string; contentType: string }>;
  agreements: any[];
  orderSheets: any[];
}

async function fetchStoredDocuments(leadId?: string): Promise<StoredDocuments> {
  const stored: StoredDocuments = { byId: new Map(), agreements: [], orderSheets: [] };
  if (!leadId) return stored;
  try {
    const res = await LeadService.downloadOutcomeDocuments(leadId);
    const body: any = res?.data;
    const docs = body?.data ?? body ?? {};
    stored.agreements = docs.agreements || [];
    stored.orderSheets = docs.orderSheets || [];
    [...stored.agreements, ...stored.orderSheets].forEach((d: any) => {
      if (d?._id && d?.base64Data) {
        stored.byId.set(String(d._id), {
          base64: String(d.base64Data),
          contentType: d?.fileData?.contentType || '',
        });
      }
    });
  } catch (e) {
    console.warn('[document-payloads] could not pre-fetch stored documents:', e);
  }
  return stored;
}

async function storedRowToPayload(
  row: any,
  type: 'agreement' | 'orderSheet'
): Promise<DocumentPayload | null> {
  const raw = row?.base64Data;
  if (!raw) return null;
  const contentType = row?.fileData?.contentType || '';
  const base64 = String(raw).replace(/^data:[^;]*;base64,/, '');
  try {
    const pdfBase64 =
      contentType.includes('pdf') || isPdfFile(row) ? base64 : await convertJpegToPdfAsync(base64);
    return { name: '', file: `data:application/pdf;base64,${pdfBase64}`, type };
  } catch (e) {
    console.warn('[document-payloads] could not build PDF for a stored document:', e);
    return null;
  }
}

export async function buildDocumentPayloads({
  agreements,
  orderSheets,
  leadId,
  isSale,
  includeSystemGenerated = false,
}: {
  agreements?: any[];
  orderSheets?: any[];
  leadId?: string;
  isSale: boolean;
  includeSystemGenerated?: boolean;
}): Promise<DocumentPayloads> {
  const alreadyFiled = (f: any) => f?.isSystemGenerated === true;
  const allAgreements = toFlatFiles(agreements);
  const allOrderSheets = toFlatFiles(orderSheets);
  const agreementFiles = includeSystemGenerated
    ? allAgreements
    : allAgreements.filter((f) => !alreadyFiled(f));
  const orderSheetFiles = includeSystemGenerated
    ? allOrderSheets
    : allOrderSheets.filter((f) => !alreadyFiled(f));
  const out: DocumentPayloads = { agreements: [], orderSheets: [] };

  const needStoredAgreements = !agreementFiles.length && !allAgreements.length;
  const needStoredOrderSheets = !orderSheetFiles.length && !allOrderSheets.length;
  const localNeedsServerBytes = [...agreementFiles, ...orderSheetFiles].some(
    (f) => !dataUriOf(f) && !localFilePath(f?.uri) && serverIdOf(f)
  );
  const stored =
    localNeedsServerBytes || needStoredAgreements || needStoredOrderSheets
      ? await fetchStoredDocuments(leadId)
      : { byId: new Map(), agreements: [], orderSheets: [] };

  const convert = async (files: any[], type: 'agreement' | 'orderSheet') => {
    const payloads: DocumentPayload[] = [];
    for (const file of files) {
      const bytes = await readFileBytes(file, stored.byId);
      if (!bytes) continue;
      try {
        const pdfBase64 = bytes.isPdf ? bytes.base64 : await convertJpegToPdfAsync(bytes.base64);
        payloads.push({ name: '', file: `data:application/pdf;base64,${pdfBase64}`, type });
      } catch (e) {
        console.warn('[document-payloads] could not build PDF for a document:', e);
      }
    }
    return payloads;
  };

  const fromStored = async (rows: any[], type: 'agreement' | 'orderSheet') => {
    const payloads: DocumentPayload[] = [];
    for (const row of rows) {
      const payload = await storedRowToPayload(row, type);
      if (payload) payloads.push(payload);
    }
    return payloads;
  };

  const agreementType: 'agreement' | 'orderSheet' = isSale ? 'agreement' : 'orderSheet';
  const agreementPayloads = agreementFiles.length
    ? await convert(agreementFiles, agreementType)
    : needStoredAgreements
      ? await fromStored(stored.agreements, agreementType)
      : [];
  if (isSale) out.agreements.push(...agreementPayloads);
  else out.orderSheets.push(...agreementPayloads);

  out.orderSheets.push(
    ...(orderSheetFiles.length
      ? await convert(orderSheetFiles, 'orderSheet')
      : needStoredOrderSheets
        ? await fromStored(stored.orderSheets, 'orderSheet')
        : [])
  );

  if (needStoredAgreements && out.agreements.length) {
    console.log('[document-payloads] job state held no agreement — used the stored document(s)');
  }
  if (allAgreements.length && !agreementFiles.length) {
    console.log('[document-payloads] agreement already filed by the sign endpoint — not re-sent');
  }
  return out;
}
