import RNFS from 'react-native-fs';
import { LeadService } from '../../../services/api/leads';
import { convertJpegToPdfAsync } from '../../../utils/jpeg-to-pdf-native';

/**
 * Build the top-level `agreements` / `orderSheets` arrays the job-builder submit
 * expects — a faithful port of web's finalize block in
 * `sections/deal-center/components/TabbedCalculator.js` (the `action === 'complete'`
 * branch).
 *
 * Web reads the document groups off `jobState.agreements` / `jobState.orderSheets`,
 * converts every file to a base64 PDF (`toBase64` → `generatePdfFromImages`) and
 * sends `{ name: '', file, type }` entries alongside the serialized `jobState`. On a
 * non-Sale result it files the agreements AS ORDER SHEETS. All of that is mirrored
 * here; the only difference is how the bytes are obtained, since React Native has no
 * Blob/canvas: a data-URI is used as-is, an on-disk `file://` is read with RNFS, and
 * a server-backed row's base64 comes from `downloadOutcomeDocuments` — the same
 * pre-fetch web performs for its `isNew: false` files.
 */

export interface DocumentPayload {
  name: string;
  file: string;
  type: 'agreement' | 'orderSheet';
}

export interface DocumentPayloads {
  agreements: DocumentPayload[];
  orderSheets: DocumentPayload[];
}

/** `[{ files: [...] }]` groups (web shape) or an already-flat list → flat list. */
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

/**
 * The readable path for a LOCAL document, or null when the uri is remote / inline.
 *
 * WARNING It is not enough to test for `file://`. On Android the ML Kit document
 * scanner can return a `content://` uri (older Play services builds do, which is
 * what an Android 11 device tends to carry), and this function used to be an
 * inline `startsWith('file://')` test - so a scanned order sheet was DROPPED from
 * the submitted job with no error anywhere. RNFS reads both: a bare path as a
 * file, a `content://` uri through the ContentResolver.
 *
 * `DocumentScannerModal` now copies every scanned page into the app's own cache,
 * so new scans arrive as `file://` regardless; this stays as the safety net for
 * a draft saved BEFORE that fix, whose stored uri is still a content one.
 */
const localFilePath = (uri: any): string | null => {
  if (typeof uri !== 'string' || !uri) return null;
  if (/^(https?|data):/i.test(uri)) return null;
  return uri.startsWith('file://') ? uri.replace('file://', '') : uri;
};

const serverIdOf = (f: any): string | null => {
  const id = f?.serverId ?? f?._id ?? f?.id;
  return id ? String(id) : null;
};

/**
 * Web `toBase64`: resolve one file entry to `{ base64, isPdf }`, or null when the
 * bytes cannot be reached (that entry is then dropped, exactly like web filters out
 * `file === null`).
 */
async function readFileBytes(
  file: any,
  serverBase64ById: Map<string, { base64: string; contentType: string }>
): Promise<{ base64: string; isPdf: boolean } | null> {
  // 1. Already inlined (a draft persisted by web carries base64 data URIs).
  const inline = dataUriOf(file);
  if (inline) {
    return {
      base64: inline.replace(/^data:[^;]*;base64,/, ''),
      isPdf: inline.startsWith('data:application/pdf'),
    };
  }

  // 2. Server-backed row — use the pre-fetched base64 (web's `preFetchedDocs`).
  const serverId = serverIdOf(file);
  if (serverId && serverBase64ById.has(serverId)) {
    const hit = serverBase64ById.get(serverId)!;
    return {
      base64: String(hit.base64).replace(/^data:[^;]*;base64,/, ''),
      isPdf: hit.contentType.includes('pdf') || isPdfFile(file),
    };
  }

  // 3. On-disk capture / generated PDF.
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

/**
 * Pre-fetch the lead's STORED documents, with their bytes (web's `preFetchedDocs`).
 * Doubles as the authoritative fallback list — see `buildDocumentPayloads`.
 */
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
    // Non-fatal, exactly like web: entries that cannot be resolved are dropped.
    console.warn('[document-payloads] could not pre-fetch stored documents:', e);
  }
  return stored;
}

/** A stored row (base64 already in hand) → the submit payload entry. */
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
  /**
   * Include a system-generated (signed) agreement in the payload. Web parity:
   * web's `action === 'complete'` converts EVERY agreement file — including the
   * signed one — to base64 and submits it to BOTH `POST /job-builder` and the
   * lead-scoped `PUT /outcome` (`updateJobBuilder`), which is what populates
   * `jobBuilderDocuments` (the ContractDetails source). The backend upserts by
   * file, so re-sending the already-filed agreement does not duplicate on the
   * current backend. Default false preserves any other caller's behaviour.
   */
  includeSystemGenerated?: boolean;
}): Promise<DocumentPayloads> {
  // A system-generated agreement was already filed by the sign endpoint
  // (`pdf-reports/v1/agreement/{leadId}/sign`). When `includeSystemGenerated` is
  // false it is skipped (legacy behaviour); the finalize flow now passes true so
  // it is submitted like web does — read back from its local `file://` copy.
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

  // THE STORED DOCUMENTS ARE THE SOURCE OF TRUTH — this is where mobile has to
  // diverge from web, and why the submit used to go out with an empty array.
  //
  // Web can build this payload purely from `jobState`, because on web a document
  // exists NOWHERE ELSE until finalize. Mobile uploads (or the sign endpoint files)
  // the document the moment it is added, so by submit time it is already on the lead
  // — and the draft copy is only a mirror. Any hiccup in recording that mirror (a
  // failed read-back, a reopened builder whose draft predates the upload, a document
  // added against a different calculator) left `jobState.agreements` empty and the
  // submit silently shipped `agreements: []` even though the PDF was sitting on the
  // server. So: fetch what is actually stored, and use it whenever the local mirror
  // has nothing for a category.
  //
  // The fallback is skipped when the local mirror DID hold documents for a category
  // and they were all system-generated: we then already know a stored copy exists and
  // that re-sending it is precisely what duplicates it.
  const needStoredAgreements = !agreementFiles.length && !allAgreements.length;
  const needStoredOrderSheets = !orderSheetFiles.length && !allOrderSheets.length;
  const localNeedsServerBytes = [...agreementFiles, ...orderSheetFiles].some(
    (f) => !dataUriOf(f) && !localFilePath(f?.uri) && serverIdOf(f)
  );
  const stored =
    localNeedsServerBytes || needStoredAgreements || needStoredOrderSheets
      ? await fetchStoredDocuments(leadId)
      : { byId: new Map(), agreements: [], orderSheets: [] };

  // Sequential, not Promise.all: these are multi-MB strings and holding every
  // decoded document at once is what previously spiked the JS heap.
  const convert = async (files: any[], type: 'agreement' | 'orderSheet') => {
    const payloads: DocumentPayload[] = [];
    for (const file of files) {
      const bytes = await readFileBytes(file, stored.byId);
      if (!bytes) continue;
      try {
        // Filesystem-backed: see `utils/jpeg-to-pdf-native.ts`. Same bytes as the
        // in-memory builder, without holding the decoded scan in the JS heap.
        const pdfBase64 = bytes.isPdf ? bytes.base64 : await convertJpegToPdfAsync(bytes.base64);
        // Web sends `name: ''` and lets the backend name the stored document.
        payloads.push({ name: '', file: `data:application/pdf;base64,${pdfBase64}`, type });
      } catch (e) {
        console.warn('[document-payloads] could not build PDF for a document:', e);
      }
    }
    return payloads;
  };

  // Sequential for the same reason `convert` above is: these are multi-MB strings
  // and decoding them all at once is what spiked the JS heap.
  const fromStored = async (rows: any[], type: 'agreement' | 'orderSheet') => {
    const payloads: DocumentPayload[] = [];
    for (const row of rows) {
      const payload = await storedRowToPayload(row, type);
      if (payload) payloads.push(payload);
    }
    return payloads;
  };

  // Web: on a non-Sale result the agreements are submitted as ORDER SHEETS.
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
