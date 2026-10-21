/**
 * Storing an annotated ORDER SHEET on the server (REVUIUX-569) - and undoing it.
 *
 * Contract (backend `feature/ticket-569`):
 *   PATCH /lead/v1/outcome/document/:id/annotation        multipart `file` + `annotationData`  -> replaces the sheet IN PLACE
 *   POST  /lead/v1/outcome/document/:id/annotation/reset                                       -> restores the pristine original
 * Either collection's id is accepted (`JobBuilderDocument` or `LeadOutcomeDocument`) - the id on a Job-docs row is usually the
 * job-builder one - so the row's `serverId` is sent as it is, never translated.
 *
 * ⚠️ THE ROUTES MAY NOT BE DEPLOYED YET (the hand-over says the contract is designed, not built). Until they are, a bare
 * 404 / 405 / 501 with no JSON envelope (`isRouteMissing`) falls back to the flow that already worked end to end:
 * file the annotated PDF as a new order sheet, THEN delete the old one (`submitJobBuilder` only ADDS), and keep the pristine
 * ORIGINAL on this phone for "Reset". That fallback is deliberately the only place the old behaviour lives. A real
 * `404 { code, message }` ("document not found") is NOT a missing route and is thrown.
 *
 * ⚠️ NEVER route this through the offline DOCUMENT queue (`offline-lead-work` / `offlineLeadStore`): it is append-only, dedupes
 * on NAME and has no "replaces server doc X" concept - it would file a SECOND order sheet on the next flush.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import { storage } from '../utils/storage';
import { LeadService } from './api/leads';
import { queryClient } from './api/queryClient';
import { forgetWarmedUri } from '../utils/imageFileCache';
import { getSessionOwner } from './sessionScope';
import { base64ByteLength, convertJpegToPdf } from '../utils/jpeg-to-pdf';
import { extractEmbeddedJpeg } from '../utils/pdf-extract-jpeg';
import { annotatedPdfName, isRouteMissing, serverWarningText } from '../utils/order-sheet-annotation';
import { FlashMessage } from '../config/message';
import { emitOrderSheetChanged } from '../utils/order-sheet-events';
import { logOrderSheetAnnotated, logOrderSheetReset } from '../utils/activity-log/job-builder-logs';

const INDEX_KEY = 'order_sheet_originals';
const DIR = 'order_sheet_originals';
const DEFAULT_MEDIA_BOX = { width: 595, height: 842 };

const toPath = (uri: string) => decodeURIComponent(String(uri || '').replace(/^file:\/\//i, ''));
const keyOf = (leadId: string, bytes: number) => `${leadId}:${bytes}`;

// --- the pristine original, kept on THIS phone (fallback reset only) --------------------------------------------------------
type OriginalIndex = Record<string, string>;

const readIndex = (): OriginalIndex => {
  try {
    const raw = storage.getString(INDEX_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};
const writeIndex = (idx: OriginalIndex) => {
  try {
    storage.set(INDEX_KEY, JSON.stringify(idx));
  } catch (e) {
    console.warn('[OrderSheet] could not save the originals index', e);
  }
};

/** A remembered original for this lead + one of these PDF byte sizes, if its file is still there. */
export const findLocalOriginal = async (leadId: string, sizes: number[]): Promise<string | null> => {
  const idx = readIndex();
  const hit = sizes.map((n) => keyOf(leadId, n)).find((k) => idx[k]);
  if (!hit) return null;
  const path = idx[hit];
  return (await ReactNativeBlobUtil.fs.exists(toPath(path)).catch(() => false)) ? path : null;
};

/** Copies the JPEG being annotated into app storage (it IS the original the first time a sheet is annotated). */
export const saveLocalOriginalCopy = async (leadId: string, jpegFileUri: string): Promise<string | null> => {
  try {
    const fs = ReactNativeBlobUtil.fs;
    const dir = `${fs.dirs.DocumentDir}/${DIR}`;
    if (!(await fs.exists(dir))) await fs.mkdir(dir);
    const dest = `${dir}/${leadId}_${Date.now()}.jpg`;
    await fs.cp(toPath(jpegFileUri), dest);
    return dest;
  } catch (e) {
    console.warn('[OrderSheet] could not keep a copy of the original', e);
    return null;
  }
};

const rememberOriginal = (leadId: string, sizes: number[], path: string) => {
  const idx = readIndex();
  sizes.forEach((n) => {
    idx[keyOf(leadId, n)] = path;
  });
  writeIndex(idx);
};

const forgetOriginal = (leadId: string, sizes: number[]) => {
  const idx = readIndex();
  sizes.forEach((n) => delete idx[keyOf(leadId, n)]);
  writeIndex(idx);
};

// --- shared plumbing -------------------------------------------------------------------------------------------------------
/**
 * ⚠️ The PDF viewer rejects anything that does not start with `%PDF` or is under 8 KB ("The document appears to be corrupted"),
 * and an empty canvas export once got UPLOADED as the sheet. Refuse to send a PDF that is not a real one-image scan.
 */
export const assertUsablePdf = (pdfBase64: string): void => {
  const ok = pdfBase64.startsWith('JVBERi') && base64ByteLength(pdfBase64) > 8192 && !!extractEmbeddedJpeg(pdfBase64);
  if (!ok) throw new Error('The order sheet could not be built. Nothing was changed - please try again.');
};

/**
 * ⚠️ MANDATORY after every in-place replace / reset. The server mints a new `filePath` each time, but the warmed-file cache is
 * keyed before the query string, and `JobDocsSection.resolveDocs` re-resolves ONLY when `['lead', leadId]` refreshes - skip
 * that invalidation and a correct save looks broken (the old thumbnail stays).
 */
export const bustOrderSheetCaches = async (leadId: string, staleUris: Array<string | null | undefined> = []): Promise<void> => {
  try {
    await Promise.all(staleUris.filter(Boolean).map((u) => forgetWarmedUri(u as string)));
  } catch {
    /* best effort */
  }
  try {
    queryClient.invalidateQueries({ queryKey: ['secureUrls'] });
    queryClient.invalidateQueries({ queryKey: ['leads'] });
    queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
    queryClient.invalidateQueries({ queryKey: ['leadOutcomeDocs', leadId] });
    queryClient.invalidateQueries({ queryKey: ['editOutcomeDocs', leadId] });
    await queryClient.refetchQueries({ queryKey: ['lead', leadId] });
  } catch (e) {
    console.warn('[OrderSheet] could not refresh the lead after the replace', e);
  }
  // The Lead Center holds its own copy of the lead - tell it to re-read (see utils/order-sheet-events.ts).
  emitOrderSheetChanged(leadId);
};

const writeCacheFile = async (base64: string, ext: 'pdf' | 'jpg'): Promise<string> => {
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/order_sheet_${Date.now()}.${ext}`;
  await ReactNativeBlobUtil.fs.writeFile(path, base64, 'base64');
  return `file://${path}`;
};

const removeQuiet = (uri: string) => {
  ReactNativeBlobUtil.fs.unlink(toPath(uri)).catch(() => {});
};

/** Fallback: file the PDF as a NEW order sheet, then delete the one it replaces (`submitJobBuilder` only ever adds). */
const replaceViaAddThenDelete = async (leadId: string, oldDocumentId: string, pdfBase64: string, name: string) => {
  await LeadService.submitJobBuilder(leadId, {
    leadData: {},
    jobState: {},
    orderSheets: [{ name, file: `data:application/pdf;base64,${pdfBase64}`, type: 'orderSheet' }],
  });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await LeadService.deleteOutcomeDocument(String(oldDocumentId));
      return;
    } catch (e: any) {
      if (e?.response?.status === 404) return; // already gone: the outcome we wanted
      if (attempt === 2) throw new Error('The annotated copy was saved, but the previous order sheet could not be removed.');
      await new Promise<void>((r) => setTimeout(r, 800));
    }
  }
};

// --- save ------------------------------------------------------------------------------------------------------------------
export interface SaveAnnotatedOrderSheetArgs {
  leadId: string;
  /** The row's `serverId`, from EITHER collection. */
  documentId: string;
  /** The flattened result, raw base64 JPEG. */
  flattenedJpegBase64: string;
  contentKind: 'pdf' | 'image';
  mediaBox?: { width: number; height: number } | null;
  baseName?: string | null;
  annotationData: any;
  /** Signed urls whose cached bytes are stale afterwards. */
  staleUris?: string[];
  /** Fallback only: the pristine original copy and the PDF sizes this sheet is known by. */
  originalPath?: string | null;
  knownSizes?: number[];
}

export interface SaveAnnotatedOrderSheetResult {
  via: 'server' | 'fallback';
  annotation?: any;
}

export async function saveAnnotatedOrderSheet(args: SaveAnnotatedOrderSheetArgs): Promise<SaveAnnotatedOrderSheetResult> {
  const { leadId, documentId, flattenedJpegBase64, contentKind, annotationData, staleUris = [], originalPath, knownSizes = [] } = args;
  const mediaBox = args.mediaBox || DEFAULT_MEDIA_BOX;
  const owner = getSessionOwner();

  let pdfBase64: string | null = null;
  let fileUri: string;
  let fileName: string;
  let fileType: string;
  if (contentKind === 'pdf') {
    pdfBase64 = convertJpegToPdf(flattenedJpegBase64, mediaBox.width, mediaBox.height);
    assertUsablePdf(pdfBase64);
    fileUri = await writeCacheFile(pdfBase64, 'pdf');
    fileName = annotatedPdfName(args.baseName);
    fileType = 'application/pdf';
  } else {
    if (flattenedJpegBase64.length < 2000) throw new Error('The order sheet could not be built. Nothing was changed - please try again.');
    fileUri = await writeCacheFile(flattenedJpegBase64, 'jpg');
    fileName = annotatedPdfName(args.baseName).replace(/\.pdf$/i, '.jpg');
    fileType = 'image/jpeg';
  }

  try {
    const form = new FormData();
    form.append('file', { uri: fileUri, type: fileType, name: fileName } as any);
    form.append('annotationData', JSON.stringify(annotationData));

    let result: SaveAnnotatedOrderSheetResult;
    try {
      const res = await LeadService.annotateOrderSheet(documentId, form);
      result = { via: 'server', annotation: res?.data?.data?.annotation };
      // The server could not repoint the office copy: the row will show the dispatch warning. Log what it said, so the backend
      // can be given the exact document and response.
      if (result.annotation?.twin?.state === 'unresolved') {
        console.warn('[OrderSheet] twin UNRESOLVED for document', documentId, JSON.stringify(result.annotation));
      }
      // Anything the server says about this save (it still succeeded) is shown as it was sent - the app writes no text of its own.
      const warning = serverWarningText({ annotation: result.annotation }) || String(res?.data?.warning || '').trim();
      if (warning) FlashMessage.warning('Order sheet saved', warning);
    } catch (e: any) {
      if (!isRouteMissing(e)) throw e;
      console.warn('[OrderSheet] annotation route not deployed - falling back to add-then-delete');
      const pdf = pdfBase64 || convertJpegToPdf(flattenedJpegBase64, mediaBox.width, mediaBox.height);
      assertUsablePdf(pdf);
      await replaceViaAddThenDelete(leadId, documentId, pdf, annotatedPdfName(args.baseName));
      if (originalPath) {
        forgetOriginal(leadId, knownSizes);
        rememberOriginal(leadId, [base64ByteLength(pdf)], originalPath);
      }
      result = { via: 'fallback' };
    }

    // Server path: the pristine original lives on the server, so the local copy is not needed.
    if (result.via === 'server' && originalPath) {
      forgetOriginal(leadId, knownSizes);
      removeQuiet(originalPath);
    }
    await bustOrderSheetCaches(leadId, staleUris);
    if (owner) {
      logOrderSheetAnnotated(owner, leadId, 'stored', {
        documentId,
        revision: result.annotation?.revision ?? null,
        twinState: result.annotation?.twin?.state ?? null,
      }).catch(() => {});
    }
    return result;
  } finally {
    removeQuiet(fileUri);
  }
}

// --- reset -----------------------------------------------------------------------------------------------------------------
export type ResetOutcome = 'server' | 'fallback' | 'unavailable';

export async function resetAnnotatedOrderSheet(args: {
  leadId: string;
  documentId: string;
  /** The row's current signed url / size, for cache busting and finding a local original. */
  currentUri?: string | null;
  knownSizes?: number[];
  baseName?: string | null;
}): Promise<ResetOutcome> {
  const { leadId, documentId, currentUri, knownSizes = [] } = args;
  const owner = getSessionOwner();
  const logIt = () => {
    if (owner) logOrderSheetReset(owner, leadId, { documentId }).catch(() => {});
  };

  try {
    await LeadService.resetOrderSheetAnnotation(documentId);
    await bustOrderSheetCaches(leadId, [currentUri]);
    logIt();
    return 'server';
  } catch (e: any) {
    // Any real server answer (e.g. the 400 "never annotated") is thrown, so the caller shows the SERVER's own message.
    if (!isRouteMissing(e)) throw e;
  }

  // Fallback (route not deployed): put the remembered original back the way it was filed.
  const original = await findLocalOriginal(leadId, knownSizes);
  if (!original) return 'unavailable';
  const rawJpeg = await ReactNativeBlobUtil.fs.readFile(toPath(original), 'base64');
  const pdf = convertJpegToPdf(rawJpeg, DEFAULT_MEDIA_BOX.width, DEFAULT_MEDIA_BOX.height);
  assertUsablePdf(pdf);
  await replaceViaAddThenDelete(leadId, documentId, pdf, annotatedPdfName(args.baseName).replace(/_annotated(\.pdf)$/i, '$1'));
  forgetOriginal(leadId, knownSizes);
  removeQuiet(original);
  await bustOrderSheetCaches(leadId, [currentUri]);
  logIt();
  return 'fallback';
}
