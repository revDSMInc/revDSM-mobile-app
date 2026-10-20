/**
 * Re-editing an annotated photo (REVUIUX-558).
 *
 * The backend stores one opaque `annotationData` JSON per annotated copy (web writes Konva JSON). Mobile writes
 * its OWN vector model (normalised strokes / texts / shapes) under a `format` marker, so a doc can be told apart:
 * a mobile doc restores editable marks over the clean original; anything else (web's Konva JSON, no doc) falls
 * back to drawing on top of the already-flattened annotated image.
 */

export const MOBILE_ANNOTATION_FORMAT = 'revdsm-mobile-annotation';
export const MOBILE_ANNOTATION_VERSION = 1;

export interface AnnotationMarks {
  strokes: any[];
  texts: any[];
  shapes: any[];
}

export interface MobileAnnotationData extends AnnotationMarks {
  format: typeof MOBILE_ANNOTATION_FORMAT;
  version: number;
  /** `_id` of the clean ORIGINAL salesPhoto, so a PATCH-written (flat) doc still knows its base photo. */
  originalId?: string | null;
}

export interface ParsedAnnotationDoc {
  /** `_id` of the annotated copy (the salesPhoto subdocument that was annotated). */
  annotatedId: string;
  /** `_id` of the clean original, when the doc recorded it. */
  originalId: string | null;
  /** Editable marks, only when the doc was written by mobile. */
  marks: AnnotationMarks | null;
}

export const countMarks = (m?: Partial<AnnotationMarks> | null): number =>
  (m?.strokes?.length || 0) + (m?.texts?.length || 0) + (m?.shapes?.length || 0);

/** Only the persisted fields - ids, selection and other transient state never go to the server. */
export const buildMobileAnnotationData = (
  marks: AnnotationMarks,
  originalId?: string | null,
): MobileAnnotationData => ({
  format: MOBILE_ANNOTATION_FORMAT,
  version: MOBILE_ANNOTATION_VERSION,
  originalId: originalId || null,
  strokes: (marks.strokes || []).map((s) => ({
    id: s.id,
    isEraser: !!s.isEraser,
    color: s.color,
    width: s.width,
    points: s.points,
  })),
  texts: (marks.texts || []).map((t) => ({
    id: t.id,
    text: t.text,
    color: t.color,
    fontSize: t.fontSize,
    fontStyle: t.fontStyle,
    fontFamily: t.fontFamily,
    opacity: t.opacity,
    px: t.px,
    py: t.py,
  })),
  shapes: (marks.shapes || []).map((sh) => ({
    id: sh.id,
    kind: sh.kind,
    color: sh.color,
    width: sh.width,
    p1: sh.p1,
    p2: sh.p2,
  })),
});

const isMobileData = (d: any): d is MobileAnnotationData =>
  !!d && typeof d === 'object' && d.format === MOBILE_ANNOTATION_FORMAT && Array.isArray(d.strokes);

/**
 * One doc from `GET leads/:id/annotations`. A PUT stores `{ salesPhotoId, annotationData }` NESTED inside
 * `annotationData`; a PATCH stores the payload flat. Both are accepted.
 */
export const parseAnnotationDoc = (doc: any): ParsedAnnotationDoc | null => {
  const annotatedId = doc?.salesPhotoId;
  const raw = doc?.annotationData;
  if (!annotatedId || !raw) return null;

  const nested = raw.salesPhotoId && raw.annotationData;
  const data = nested ? raw.annotationData : raw;
  const originalId: string | null =
    (nested ? raw.salesPhotoId : null) || (data && typeof data === 'object' ? data.originalId : null) || null;

  return {
    annotatedId: String(annotatedId),
    originalId: originalId ? String(originalId) : null,
    marks: isMobileData(data)
      ? {
          strokes: data.strokes || [],
          texts: data.texts || [],
          shapes: data.shapes || [],
        }
      : null,
  };
};

export const indexAnnotationDocs = (response: any): Map<string, ParsedAnnotationDoc> => {
  const list: any[] = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
  const out = new Map<string, ParsedAnnotationDoc>();
  list.forEach((d) => {
    const parsed = parseAnnotationDoc(d);
    if (parsed) out.set(parsed.annotatedId, parsed);
  });
  return out;
};

const ANNOTATED_SUFFIX = /\s*\(Annotated\)\s*$/i;

export const stripAnnotatedSuffix = (subcategory?: string | null): string =>
  String(subcategory || '').replace(ANNOTATED_SUFFIX, '').trim();

/**
 * The clean photo an annotated copy was drawn from: the id the doc recorded, otherwise the (single) non-annotated
 * photo in the same category with the same base subcategory. Returns null when it cannot be told apart.
 */
export const findOriginalPhoto = <P extends { _id?: string; category?: string; subcategory?: string }>(
  annotated: P,
  photos: P[],
  doc?: ParsedAnnotationDoc | null,
): P | null => {
  if (doc?.originalId) {
    const byId = photos.find((p) => p._id === doc.originalId);
    if (byId) return byId;
  }
  const base = stripAnnotatedSuffix(annotated.subcategory).toLowerCase();
  const matches = photos.filter(
    (p) =>
      p._id !== annotated._id &&
      !/\(annotated\)/i.test(String(p.subcategory || '')) &&
      String(p.category || '') === String(annotated.category || '') &&
      String(p.subcategory || '').trim().toLowerCase() === base,
  );
  return matches.length === 1 ? matches[0] : null;
};

/**
 * One annotated photo per base photo: when a base photo has more than one annotated copy (a re-annotation that
 * landed as a second row), only the LATEST is shown - newest `timestampTaken`, else the one listed last.
 * First-seen order of the surviving entries is kept.
 */
export const latestAnnotatedPerBase = <
  T extends { subcategory: string; photo: { category?: string; subcategory?: string; timestampTaken?: string } },
>(
  items: T[],
): T[] => {
  const best = new Map<string, { item: T; at: number; index: number }>();
  items.forEach((item, index) => {
    const key = `${String(item.photo?.category || '').toLowerCase()}::${stripAnnotatedSuffix(item.subcategory).toLowerCase()}`;
    const parsed = Date.parse(String(item.photo?.timestampTaken || ''));
    const at = Number.isNaN(parsed) ? -Infinity : parsed;
    const cur = best.get(key);
    // `>=`: on equal / unknown times the later row wins.
    if (!cur || at >= cur.at) best.set(key, { item, at, index });
  });
  return [...best.values()].sort((a, b) => a.index - b.index).map((b) => b.item);
};

/**
 * "Undo my changes" in the editor: back to what the screen OPENED with - the marks a re-edit restored - not to an empty canvas.
 * Resetting to empty on a re-edit threw away marks saved last week, and the save that followed stored an EMPTY annotation
 * (REVUIUX-569 section 5; it also fixes the photo flow).
 */
export const resetToBaseline = (
  seeded: { strokes?: Record<string, any[]>; texts?: Record<string, any[]>; shapes?: Record<string, any[]> } | null | undefined,
  photoId: string,
): AnnotationMarks => ({
  strokes: [...(seeded?.strokes?.[photoId] ?? [])],
  texts: [...(seeded?.texts?.[photoId] ?? [])],
  shapes: [...(seeded?.shapes?.[photoId] ?? [])],
});
