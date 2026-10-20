/**
 * Opening the annotation editor on an ORDER SHEET (REVUIUX-569) - from the Deal screen's Job docs AND the deal-edit Summary.
 *
 * This file only gets the sheet READY and navigates; saving is a durable background job (`annotationSaveService`, mode
 * `orderSheet`) that ends in `services/orderSheetSync.ts` (PATCH in place, with a fallback while the backend routes are not
 * deployed), so an annotation made with no signal is not lost.
 *
 * ⚠️ Order sheets are PDFs and the annotator cannot open one: `Image.getSize` on a PDF lands on its `{4, 3}` fallback, which
 * corrupts `canvasLayout` and therefore EVERY normalised mark coordinate saved afterwards. So a raster is produced HERE,
 * before `navigation.navigate` (`utils/pdf-extract-jpeg.ts` lifts the embedded JPEG out of the PDF - no dependency).
 *   image/*                    -> annotated directly, no conversion
 *   app-produced PDF           -> extractEmbeddedJpeg -> annotate -> re-wrapped as a PDF
 *   multi-page / anything else -> REFUSED with a clear message (never annotate page 1 and drop the rest)
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import { LeadService } from './api/leads';
import { FlashMessage } from '../config/message';
import { getSessionOwner } from './sessionScope';
import { warmToLocalCache } from '../utils/imageFileCache';
import { base64ByteLength, stripDataUriPrefix } from '../utils/jpeg-to-pdf';
import { countPdfPages, extractEmbeddedJpeg } from '../utils/pdf-extract-jpeg';
import { multiPageMessage, shouldRasterize } from '../utils/order-sheet-annotation';
import { MOBILE_ANNOTATION_FORMAT } from '../utils/annotation-restore';
import { logOrderSheetAnnotated } from '../utils/activity-log/job-builder-logs';
import { findLocalOriginal, saveLocalOriginalCopy } from './orderSheetSync';

const toPath = (uri: string) => decodeURIComponent(String(uri || '').replace(/^file:\/\//i, ''));

/** What a Job-docs row / summary tile hands in. Only `serverId` and a readable `uri` are required. */
export interface OrderSheetDoc {
  serverId: string | number;
  uri: string;
  name?: string;
  size?: number | null;
  filePath?: string;
  bucketName?: string;
  contentType?: string;
  annotation?: any;
}

/** The bytes as base64: a warmed local copy when there is one, else a download; a `file://` or `data:` uri is read directly. */
export const loadDocumentBase64 = async (src: string): Promise<string> => {
  if (/^data:/i.test(src)) return stripDataUriPrefix(src);
  const fs = ReactNativeBlobUtil.fs;
  if (/^https?:/i.test(src)) {
    const cached = await warmToLocalCache(src).catch(() => null);
    if (cached) {
      try {
        return await fs.readFile(toPath(cached), 'base64');
      } catch {
        /* fall through to a fresh download */
      }
    }
    const res = await ReactNativeBlobUtil.config({ fileCache: true }).fetch('GET', src);
    try {
      return await fs.readFile(res.path(), 'base64');
    } finally {
      fs.unlink(res.path()).catch(() => {});
    }
  }
  return fs.readFile(toPath(src), 'base64');
};

const writeCacheJpeg = async (jpegBase64: string): Promise<string> => {
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/order_sheet_${Date.now()}.jpg`;
  await ReactNativeBlobUtil.fs.writeFile(path, jpegBase64, 'base64');
  return `file://${path}`;
};

/** The marks the server stored with the last annotation, when they are OURS (the web app writes a different format). */
const savedMarks = (annotation: any): { strokes: any[]; texts: any[]; shapes: any[] } | null => {
  const data = annotation?.data;
  if (!data || typeof data !== 'object' || data.format !== MOBILE_ANNOTATION_FORMAT || !Array.isArray(data.strokes)) return null;
  return { strokes: data.strokes || [], texts: data.texts || [], shapes: data.shapes || [] };
};

/**
 * The CLEAN picture a re-edit should draw its restored marks over. Needs the server to say where the pristine original is
 * (`annotation.original.{filePath,bucketName}`) - not in the agreed contract yet, so without it a re-edit opens on the
 * annotated picture with no restored marks (drawing on top of what is baked in).
 */
const loadCleanOriginalJpeg = async (annotation: any, fallbackBucket?: string): Promise<string | null> => {
  const original = annotation?.original;
  if (!original?.filePath) return null;
  try {
    const res = await LeadService.getSecureUrls([{ bucketName: original.bucketName || fallbackBucket || '', filePath: original.filePath }]);
    const rows = res?.data?.data || res?.data || [];
    const url = (Array.isArray(rows) ? rows[0] : null)?.secureUrl || (Array.isArray(rows) ? rows[0] : null)?.url;
    if (!url) return null;
    const b64 = await loadDocumentBase64(url);
    return extractEmbeddedJpeg(b64)?.jpegBase64 ?? null;
  } catch (e) {
    console.warn('[OrderSheet] could not load the pristine original', e);
    return null;
  }
};

export interface OpenOrderSheetEditorArgs {
  navigation: any;
  lead: any;
  leadId: string;
  doc: OrderSheetDoc;
}

/** Opens the annotation editor on an order sheet. Resolves once the editor is on screen (or an explanation has been shown). */
export async function openOrderSheetEditor({ navigation, lead, leadId, doc }: OpenOrderSheetEditorArgs): Promise<void> {
  const documentId = String(doc?.serverId ?? '');
  if (!documentId || !doc?.uri) {
    FlashMessage.warning('Cannot annotate this order sheet', 'It has not finished uploading yet.');
    return;
  }
  const owner = getSessionOwner();
  if (owner) logOrderSheetAnnotated(owner, leadId, 'opened', { documentId, revision: doc.annotation?.revision ?? 0 }).catch(() => {});

  try {
    const rasterize = shouldRasterize(doc.contentType, doc.filePath || doc.uri);
    const currentBase64 = await loadDocumentBase64(doc.uri);
    const currentBytes = base64ByteLength(currentBase64);
    const knownSizes = [currentBytes, ...(typeof doc.size === 'number' && doc.size > 0 ? [doc.size] : [])];

    let imageUri: string;
    let mediaBox: { width: number; height: number } | null = null;
    let currentJpeg: string | null = null;

    if (rasterize) {
      const extracted = extractEmbeddedJpeg(currentBase64);
      if (!extracted) {
        FlashMessage.warning('Cannot annotate this order sheet', multiPageMessage(countPdfPages(currentBase64)));
        return;
      }
      currentJpeg = extracted.jpegBase64;
      mediaBox = extracted.mediaBox;
      imageUri = await writeCacheJpeg(extracted.jpegBase64);
    } else {
      currentJpeg = currentBase64;
      imageUri = await writeCacheJpeg(currentBase64);
    }

    // Re-edit: restore the saved marks over the CLEAN original when the server tells us where it is; otherwise the sheet opens
    // as it is now (marks baked in) with nothing restored.
    let initialMarks = savedMarks(doc.annotation);
    if (initialMarks) {
      const clean = await loadCleanOriginalJpeg(doc.annotation, doc.bucketName);
      if (clean) imageUri = await writeCacheJpeg(clean);
      else initialMarks = null;
    }

    // Fallback reset needs the pristine original on THIS phone: what is being viewed IS the original only before the first
    // annotation. Never keep an already-annotated picture as "the original".
    let originalPath = await findLocalOriginal(leadId, knownSizes);
    if (!originalPath && !(Number(doc.annotation?.revision ?? 0) > 0) && currentJpeg) {
      originalPath = await saveLocalOriginalCopy(leadId, await writeCacheJpeg(currentJpeg));
    }

    navigation.navigate('ImageAnnotation', {
      selectedPhotos: [
        {
          uri: imageUri,
          index: 0,
          id: `order-sheet-${documentId}`,
          subcategory: 'Order Sheet',
          categoryName: 'Order Sheet',
          // The discriminator: a document id is a different id space from `lead.salesPhotos` ids, so it must never ride in
          // `existingAnnotationId` / `salesPhotoId` (it would PATCH the photo route and 404 - or hit an unrelated photo).
          docKind: 'orderSheet',
          orderSheetDocumentId: documentId,
          orderSheetBaseName: doc.name || 'Order_Sheet',
          orderSheetMeta: {
            contentKind: rasterize ? 'pdf' : 'image',
            mediaBox,
            originalPath,
            knownSizes,
          },
          initialMarks,
          staleUris: doc.uri ? [doc.uri] : [],
        },
      ],
      lead,
    });
  } catch (e: any) {
    console.warn('[OrderSheet] could not open the editor', e);
    FlashMessage.error('Could not open the order sheet', 'Check your connection and try again.');
  }
}
