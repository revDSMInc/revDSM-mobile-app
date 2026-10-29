/**
 * Which on-device photo files belong to which lead, and when a lead's files are no longer worth keeping.
 *
 * The photo cache (`imageFileCache`) exists so a lead worked OFFLINE keeps its pictures. It used to fill
 * with every lead opened online as well - photos that are already on S3 and come back from the server
 * whenever the rep is online - and uploaded photos were kept after their upload. This index lets the
 * cache be limited to leads that still have offline work, and emptied once that work is delivered.
 */
export interface LeadPhotoEntry {
  paths: string[];
  touchedAt: number;
}
export type LeadPhotoIndex = Record<string, LeadPhotoEntry>;

// A lead whose work just finished is left alone this long, so the card the rep is still looking at
// does not blank and reload the instant its last upload lands.
export const PRUNE_GRACE_MS = 10 * 60_000;

export const trackPaths = (
  index: LeadPhotoIndex,
  leadId: string,
  paths: string[],
  now: number = Date.now()
): LeadPhotoIndex => {
  const id = String(leadId || '').trim();
  const add = (paths || []).filter(Boolean);
  if (!id || !add.length) return index;
  const known = index[id]?.paths || [];
  return { ...index, [id]: { paths: Array.from(new Set([...known, ...add])), touchedAt: now } };
};

export const selectLeadsToPrune = (
  index: LeadPhotoIndex,
  hasOfflineWork: (leadId: string) => boolean,
  now: number = Date.now(),
  graceMs: number = PRUNE_GRACE_MS
): string[] =>
  Object.keys(index).filter(
    (leadId) => !hasOfflineWork(leadId) && now - (index[leadId]?.touchedAt || 0) >= graceMs
  );

// Moving a lead's files from a device id to its server id must not orphan them.
export const rekeyLead = (index: LeadPhotoIndex, from: string, to: string): LeadPhotoIndex => {
  if (!from || !to || from === to || !index[from]) return index;
  const { [from]: moved, ...rest } = index;
  return trackPaths(rest, to, moved.paths, moved.touchedAt);
};
