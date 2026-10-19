/**
 * Annotated photos that are saved on the device but not yet on the server (REVUIUX-558 follow-up: "show the annotated
 * photos the moment I tap Save").
 *
 * Two stages, never both for one photo:
 *   1. JOB   - Save wrote it, the background renderer has not produced the JPEG yet. Only the ORIGINAL + the marks
 *              exist, so the card draws the marks over the original (`coverBox` gives the geometry).
 *   2. QUEUE - the flattened JPEG exists locally and is waiting to upload; the card just shows that file.
 * When the upload lands the server photo replaces it (and the local file is adopted into the image cache, so that swap
 * does not show a loader).
 */
import { stripAnnotatedSuffix } from './annotation-restore';

export interface PendingAnnotationJobView {
  originalUri: string;
  layoutWidth: number;
  layoutHeight: number;
  strokes: any[];
  texts: any[];
  shapes: any[];
}

export interface PendingAnnotation {
  key: string;
  mode: 'new' | 'reedit';
  categoryName: string;
  baseSubcategory: string;
  existingAnnotationId: string | null;
  /** Set in stage 2: the queue item id (delete / status) and its local JPEG. */
  queueId?: string;
  previewUri?: string;
  /** Set in stage 1 only. */
  job?: PendingAnnotationJobView;
  timestamp?: string;
  /** Uploaded, but the server copy has not replaced the card yet: kept on screen so the handover has no gap. */
  ghost?: boolean;
}

/** One annotated photo per base photo, so category + base IS its identity - the same across every stage. */
export const annotationIdentity = (categoryName: string, baseSubcategory: string): string =>
  `${String(categoryName || '').trim().toLowerCase()}::${String(baseSubcategory || '').trim().toLowerCase()}`;

interface JobLike extends PendingAnnotationJobView {
  id: string;
  leadId: string;
  categoryName: string;
  subcategory: string;
  createdAt?: string;
  annotation: { mode: 'new' | 'reedit'; existingAnnotationId?: string | null };
}

interface QueueLike {
  id: string;
  leadId: string;
  categoryName: string;
  subcategory: string;
  uri: string;
  timestamp?: string;
  annotation?: { mode: 'new' | 'reedit'; existingAnnotationId?: string | null };
}

export const buildPendingAnnotations = (
  jobs: JobLike[] | null | undefined,
  queue: QueueLike[] | null | undefined,
  leadId: string | null | undefined,
): PendingAnnotation[] => {
  if (!leadId) return [];
  const out: PendingAnnotation[] = [];
  (queue || []).forEach((q) => {
    if (!q?.annotation || q.leadId !== leadId || !q.uri) return;
    out.push({
      key: `q-${q.id}`,
      mode: q.annotation.mode,
      categoryName: q.categoryName,
      baseSubcategory: stripAnnotatedSuffix(q.subcategory),
      existingAnnotationId: q.annotation.existingAnnotationId || null,
      queueId: q.id,
      previewUri: q.uri,
      timestamp: q.timestamp,
    });
  });
  (jobs || []).forEach((j) => {
    if (!j || j.leadId !== leadId) return;
    out.push({
      key: `j-${j.id}`,
      mode: j.annotation.mode,
      categoryName: j.categoryName,
      baseSubcategory: stripAnnotatedSuffix(j.subcategory),
      existingAnnotationId: j.annotation.existingAnnotationId || null,
      job: j,
      timestamp: j.createdAt,
    });
  });
  return out;
};

/**
 * Where the photo sits inside a `boxW x boxH` card that crops it with resizeMode "cover", given the marks were drawn on
 * a `layoutW x layoutH` canvas that is the photo's exact aspect. `scale` converts layout px (stroke width, font size)
 * to card px.
 */
export const coverBox = (boxW: number, boxH: number, layoutW: number, layoutH: number) => {
  const ar = layoutW > 0 && layoutH > 0 ? layoutW / layoutH : boxW / boxH;
  let w: number;
  let h: number;
  if (ar > boxW / boxH) {
    h = boxH;
    w = boxH * ar;
  } else {
    w = boxW;
    h = boxW / ar;
  }
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h, scale: layoutW > 0 ? w / layoutW : 1 };
};
