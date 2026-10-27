/**
 * The saved annotation docs of a lead (`GET leads/:id/annotations`) kept in MMKV, so a re-edit can restore the editable marks and
 * their undo steps with no signal or after the app restarted (REVUIUX-571). A cache only: it is session-scoped (cleared on sign-out,
 * not in SESSION_KEEP_KEYS) and the live query replaces it whenever it can reach the server.
 */
import { storage } from './storage';

const KEY = (leadId: string) => `lead_annotations:${leadId}`;

export const writeAnnotationDocsCache = (leadId: string | undefined, data: any): void => {
  if (!leadId || data == null) return;
  try {
    storage.set(KEY(leadId), JSON.stringify({ at: Date.now(), data }));
  } catch (e) {
    console.warn('[AnnotationDocsCache] could not store the annotation docs', e);
  }
};

export const readAnnotationDocsCache = (leadId: string | undefined): { at: number; data: any } | undefined => {
  if (!leadId) return undefined;
  try {
    const raw = storage.getString(KEY(leadId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.at === 'number' && parsed.data != null ? parsed : undefined;
  } catch {
    return undefined;
  }
};
