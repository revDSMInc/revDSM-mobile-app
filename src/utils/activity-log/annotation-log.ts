/**
 * Activity-log events for the annotation editor's CLICKS (REVUIUX-571): undo, redo, reset and discard.
 *
 * Pure builders, so the exact event + meta is unit-tested; `logAnnotationClick` is the thin sender. `logEvent` stamps `occurredAt`
 * itself and holds the log when the phone is offline, so nothing here deals with time or connectivity beyond reporting it.
 *
 * Photos use the SAME module as the editor's existing `open` / `save` logs (`annotated_photos`). An order sheet is a Job-docs
 * document, so it uses `job_builder` + `fieldName: 'orderSheet'` like `logOrderSheetAnnotated` (the portal groups it with the sheet).
 */
import { logEvent } from '../../services/api/LoggerService';

export type AnnotationClickAction = 'undo' | 'redo' | 'reset' | 'discard';
export type AnnotationEditMode = 'new' | 'reedit' | 'orderSheet';

export interface AnnotationClickInput {
  userId: string;
  leadId?: string | null;
  action: AnnotationClickAction;
  mode: AnnotationEditMode;
  category?: string | null;
  subcategory?: string | null;
  /** The photo being edited (the annotated copy's id on a re-edit, else the editor's own id). */
  photoId?: string | null;
  /** Undo / redo: what kind of step it was. */
  stepType?: 'stroke' | 'text' | 'shape' | null;
  /** Undo / redo: how many steps remain after the click. */
  undoLeft?: number;
  redoLeft?: number;
  /** Reset / discard: how many marks were on the canvas, and whether any of them were saved earlier. */
  marksRemoved?: number;
  includedSavedMarks?: boolean;
  offline?: boolean;
}

const EVENT_ACTION: Record<AnnotationClickAction, string> = {
  undo: 'annotation_undo',
  redo: 'annotation_redo',
  reset: 'annotation_reset',
  discard: 'annotation_changes_discarded',
};

const LABEL: Record<AnnotationClickAction, string> = {
  undo: 'Annotation Undo',
  redo: 'Annotation Redo',
  reset: 'Annotation Reset',
  discard: 'Annotation Changes Discarded',
};

const stripAnnotated = (s?: string | null) => String(s || '').replace(/\s*\(Annotated\)\s*$/i, '').trim();

export const buildAnnotationClickLog = (i: AnnotationClickInput): { eventType: 'click'; details: any } => {
  const orderSheet = i.mode === 'orderSheet';
  const meta: Record<string, any> = {
    leadId: i.leadId ?? null,
    action: EVENT_ACTION[i.action],
    mode: i.mode,
    photoId: i.photoId ?? null,
    connection: i.offline ? 'offline' : 'online',
  };
  if (!orderSheet) {
    meta.category = i.category ?? null;
    meta.subcategory = stripAnnotated(i.subcategory) || null;
  } else {
    meta.draft = true;
    meta.fieldName = 'orderSheet';
    meta.fieldLabel = `Order Sheet ${LABEL[i.action]}`;
  }
  if (i.action === 'undo' || i.action === 'redo') {
    meta.stepType = i.stepType ?? null;
    meta.undoLeft = i.undoLeft ?? 0;
    meta.redoLeft = i.redoLeft ?? 0;
  } else {
    meta.marksRemoved = i.marksRemoved ?? 0;
    meta.includedSavedMarks = !!i.includedSavedMarks;
  }
  return {
    eventType: 'click',
    details: {
      user_id: i.userId,
      created_by: i.userId,
      module_type: orderSheet ? 'job_builder' : 'annotated_photos',
      meta,
    },
  };
};

/** Fire-and-forget: a log must never slow or break an editor click. */
export const logAnnotationClick = (input: AnnotationClickInput): void => {
  if (!input.userId) return;
  try {
    const { eventType, details } = buildAnnotationClickLog(input);
    Promise.resolve(logEvent(eventType, details)).catch(() => {});
  } catch {
    // never block the editor
  }
};
