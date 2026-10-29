/**
 * Re-editing an annotated photo (REVUIUX-558).
 *
 * The backend stores one opaque `annotationData` JSON per annotated copy (web writes Konva JSON). Mobile writes
 * its OWN vector model (normalised strokes / texts / shapes) under a `format` marker, so a doc can be told apart:
 * a mobile doc restores editable marks over the clean original; anything else (web's Konva JSON, no doc) falls
 * back to drawing on top of the already-flattened annotated image.
 */

export const MOBILE_ANNOTATION_FORMAT = 'revdsm-mobile-annotation';
// v2 adds the undo / redo stacks (`history`, `redo`). A v1 doc has none and restores with empty stacks; an older app build reads
// only strokes / texts / shapes and ignores the rest, so the bump breaks nothing.
export const MOBILE_ANNOTATION_VERSION = 2;

/** Most undo (and redo) steps kept in a saved doc - older ones are dropped so the JSON stays small. */
export const MAX_PERSISTED_HISTORY = 50;

export interface AnnotationMarks {
  strokes: any[];
  texts: any[];
  shapes: any[];
}

/** Undo / redo stacks as the editor keeps them (last entry = the next step). */
export interface AnnotationStacks {
  history: any[];
  redo: any[];
}

/** Marks plus the (already validated) stacks, as the editor is seeded on a re-edit. */
export interface RestoredMarks extends AnnotationMarks, AnnotationStacks {}

export interface MobileAnnotationData extends AnnotationMarks, Partial<AnnotationStacks> {
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
  /** Editable marks (and undo / redo stacks), only when the doc was written by mobile. */
  marks: RestoredMarks | null;
}

export const countMarks = (m?: Partial<AnnotationMarks> | null): number =>
  (m?.strokes?.length || 0) + (m?.texts?.length || 0) + (m?.shapes?.length || 0);

const cleanStroke = (s: any) => ({
  id: s.id,
  isEraser: !!s.isEraser,
  color: s.color,
  width: s.width,
  // Pen transparency (REVUIUX-590); absent on strokes saved before it = fully opaque.
  opacity: s.opacity,
  points: s.points,
});

const cleanText = (t: any) => ({
  id: t.id,
  text: t.text,
  color: t.color,
  fontSize: t.fontSize,
  fontStyle: t.fontStyle,
  fontFamily: t.fontFamily,
  opacity: t.opacity,
  px: t.px,
  py: t.py,
});

const cleanShape = (sh: any) => ({
  id: sh.id,
  kind: sh.kind,
  color: sh.color,
  width: sh.width,
  p1: sh.p1,
  p2: sh.p2,
});

const cleanShapeOrNull = (sh: any) => (sh && typeof sh === 'object' ? cleanShape(sh) : null);

/**
 * The stacks as they are saved. Undo entries for a stroke / text carry only `{ id, type }` - the mark itself is already in
 * `strokes` / `texts` (hydrated back on restore), so the points are not stored twice. Redo entries hold the mark itself (it is no
 * longer on the canvas). Shape entries are small and keep `before` / `after`. Only the newest MAX_PERSISTED_HISTORY steps go.
 */
export const compactStacks = (stacks?: Partial<AnnotationStacks> | null): AnnotationStacks => {
  // `removed` = the general eraser deleted the mark (REVUIUX-588). The mark is carried by whichever stack holds it while it is OFF the canvas:
  // an add keeps it in redo, a removal keeps it in history - so `withData` flips for a removal.
  const entry = (a: any, isRedo: boolean): any | null => {
    if (!a || a.id === undefined || a.id === null) return null;
    if (a.type === 'shape') return { id: a.id, type: 'shape', before: cleanShapeOrNull(a.before), after: cleanShapeOrNull(a.after) };
    if (a.type === 'stroke' || a.type === 'text') {
      const removed = a.removed === true;
      const flag = removed ? { removed: true } : {};
      if (isRedo === removed) return { id: a.id, type: a.type, ...flag };
      if (!a.data || typeof a.data !== 'object') return null;
      return { id: a.id, type: a.type, ...flag, data: a.type === 'stroke' ? cleanStroke(a.data) : cleanText(a.data) };
    }
    return null;
  };
  const pack = (list: any[] | undefined, isRedo: boolean) =>
    (Array.isArray(list) ? list : [])
      .map((a) => entry(a, isRedo))
      .filter(Boolean)
      .slice(-MAX_PERSISTED_HISTORY);
  return { history: pack(stacks?.history, false), redo: pack(stacks?.redo, true) };
};

/** Only the persisted fields - ids, selection and other transient state never go to the server. */
export const buildMobileAnnotationData = (
  marks: AnnotationMarks,
  originalId?: string | null,
  stacks?: Partial<AnnotationStacks> | null,
): MobileAnnotationData => ({
  format: MOBILE_ANNOTATION_FORMAT,
  version: MOBILE_ANNOTATION_VERSION,
  originalId: originalId || null,
  strokes: (marks.strokes || []).map(cleanStroke),
  texts: (marks.texts || []).map(cleanText),
  shapes: (marks.shapes || []).map(cleanShape),
  // Validated against the marks being saved, so a stack that drifted (a step pointing at a mark that is gone) can never be stored.
  ...(stacks ? compactStacks(restoreStacks(stacks, marks)) : {}),
});

const isMobileData = (d: any): d is MobileAnnotationData =>
  !!d && typeof d === 'object' && d.format === MOBILE_ANNOTATION_FORMAT && Array.isArray(d.strokes);

const idOf = (kind: string, id: any) => `${kind}:${String(id)}`;

/**
 * Validates saved stacks against the marks that were saved with them, so a stack can never point at something that is not
 * there (which would make Undo / Redo do nothing, or add a duplicate). Walks from the NEXT step outwards, simulating which
 * marks exist; at the first step that cannot apply, it and everything older is dropped. Anything malformed is just dropped -
 * a bad saved history must never stop the photo from opening.
 */
export const restoreStacks = (raw: any, marks: AnnotationMarks): AnnotationStacks => {
  const empty: AnnotationStacks = { history: [], redo: [] };
  try {
    const present = new Set<string>();
    marks.strokes.forEach((m) => present.add(idOf('stroke', m?.id)));
    marks.texts.forEach((m) => present.add(idOf('text', m?.id)));
    marks.shapes.forEach((m) => present.add(idOf('shape', m?.id)));
    const strokeById = new Map(marks.strokes.map((m) => [idOf('stroke', m?.id), m]));
    const textById = new Map(marks.texts.map((m) => [idOf('text', m?.id), m]));

    // One walk for both stacks: `undo` = history (applies `before`), otherwise redo (applies `after`).
    const walk = (list: any, undo: boolean): any[] => {
      if (!Array.isArray(list)) return [];
      const exists = new Map<string, boolean>();
      const has = (key: string) => (exists.has(key) ? exists.get(key)! : present.has(key));
      const kept: any[] = [];
      for (let i = list.length - 1; i >= 0; i--) {
        const a = list[i];
        if (!a || a.id === undefined || a.id === null) break;
        const key = idOf(a.type, a.id);
        let ok = false;
        let entry: any = null;
        let after: boolean;
        if (a.type === 'shape') {
          const before = cleanShapeOrNull(a.before);
          const aft = cleanShapeOrNull(a.after);
          // History is undone (needs the "after" state to be live); redo is applied (needs the "before" state).
          ok = has(key) === (undo ? !!aft : !!before);
          after = undo ? !!before : !!aft;
          entry = { id: a.id, type: 'shape', before, after: aft };
        } else if (a.type === 'stroke' || a.type === 'text') {
          // An add is undone while present and redone while absent; a removal (general eraser) is the mirror image.
          const removed = a.removed === true;
          const presentBefore = undo !== removed;
          const source = presentBefore ? (a.type === 'stroke' ? strokeById : textById).get(key) : a.data;
          ok = has(key) === presentBefore && !!source && typeof source === 'object' && source.id === a.id;
          after = !presentBefore;
          if (ok) {
            entry = { id: a.id, type: a.type, ...(removed ? { removed: true } : {}), data: a.type === 'stroke' ? cleanStroke(source) : cleanText(source) };
          }
        } else {
          break;
        }
        if (!ok) break;
        exists.set(key, after);
        kept.push(entry);
      }
      return kept.reverse().slice(-MAX_PERSISTED_HISTORY);
    };

    return { history: walk(raw?.history, true), redo: walk(raw?.redo, false) };
  } catch {
    return empty;
  }
};

/** Editable marks + validated stacks from a saved mobile `annotationData` object; null for anything else (web's Konva JSON, none). */
export const marksFromData = (data: any): RestoredMarks | null => {
  if (!isMobileData(data)) return null;
  const marks: AnnotationMarks = { strokes: data.strokes || [], texts: data.texts || [], shapes: data.shapes || [] };
  return { ...marks, ...restoreStacks(data, marks) };
};

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
    marks: marksFromData(data),
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

/**
 * What the undo stack looks like, as one string. The editor compares it with the value it opened with to tell "the rep changed
 * something" from "the stack just contains last week's steps" - the stack is no longer empty on a re-edit.
 */
export const historySignature = (history?: any[] | null): string =>
  (history || []).map((a) => `${a?.type}:${a?.id}`).join(',');
