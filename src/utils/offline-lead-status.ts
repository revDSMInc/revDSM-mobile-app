/**
 * offline-lead-status.ts — the lead-card state a rep produced at a door with no signal.
 *
 * Starting an appointment is a WRITE (`POST .../work`), and offline the Leads screen skips it
 * entirely — so the card still read **Start Appointment** on a lead the rep had already checked in
 * to and was standing in front of. Online that same tap flips `workflowState` to `resume` and the
 * card follows.
 *
 * Pure and RN-free so the overlay can be tested: the screens that read it cannot be loaded under
 * jest here, and an overlay that leaks onto the wrong lead is invisible until a rep opens it.
 */

/** What this device saw the rep do to a lead, with no connection to record it. */
export interface OfflineLeadWorkflow {
  /** The state the online `work` call would have left the lead in. */
  workflowState: 'resume';
  /** ISO, so a stale mark can be aged out. */
  at: string;
}

export type OfflineWorkflowMap = Record<string, OfflineLeadWorkflow>;

/**
 * How long an offline check-in keeps colouring the card.
 *
 * ⚠️ Bounded on purpose. The mark is never uploaded — see the note on `markOfflineCheckIn` — so
 * nothing on the server will ever contradict it, and an unbounded one would show `Resume
 * Appointment` on a lead the rep visited last week. A day covers the shift it belongs to.
 */
export const OFFLINE_WORKFLOW_TTL_MS = 24 * 60 * 60 * 1000;

const freshAt = (entry: OfflineLeadWorkflow | undefined, now: number): boolean => {
  if (!entry) return false;
  const at = Date.parse(String(entry.at || ''));
  return !Number.isNaN(at) && now - at < OFFLINE_WORKFLOW_TTL_MS;
};

/** Record that the rep checked in / resumed this lead with no signal. */
export const markOfflineCheckIn = (
  map: OfflineWorkflowMap | null | undefined,
  leadId: unknown,
  at: string = new Date().toISOString()
): OfflineWorkflowMap => {
  const id = String(leadId ?? '').trim();
  if (!id) return map || {};
  return { ...(map || {}), [id]: { workflowState: 'resume', at } };
};

/**
 * Paint the offline mark onto a lead row.
 *
 * ⚠️ Returns the SAME reference when there is nothing to apply. Every consumer of the Leads list
 * sits in a dependency array, and a fresh object per row per render would re-run the photo
 * resolution and the card's own memo on every tick.
 *
 * ⚠️ The SERVER always wins when it already says `resume`. The mark is a stand-in for a call that
 * could not be made, not a correction to one that was.
 */
export const applyOfflineWorkflow = <T extends Record<string, any>>(
  lead: T,
  map: OfflineWorkflowMap | null | undefined,
  now: number = Date.now()
): T => {
  const id = String(lead?._id || lead?.id || '').trim();
  if (!id) return lead;
  if (lead.workflowState === 'resume') return lead;
  const entry = map?.[id];
  if (!freshAt(entry, now)) return lead;
  return { ...lead, workflowState: entry!.workflowState };
};

/**
 * Re-address a mark from the id this device minted to the one the server issued.
 *
 * ⚠️ Without this the mark is ORPHANED the moment the lead uploads, and the card visibly
 * regresses: the rep checks in at a door offline, the row reads **Resume Appointment**, the create
 * lands — and the server row arrives under a real `_id` that this map has no entry for, so the card
 * goes back to **Start Appointment** on a lead they already worked. Exactly the trap the photo
 * queue needed `rekeyLead` for, and for the same reason: the two are keyed by different ids.
 *
 * The old key is DROPPED rather than kept alongside. Nothing addresses a filed lead by its client
 * id any more — `offlineWorkToLead` stops projecting it — so a duplicate would only be a mark that
 * can never be read and never ages out of anything that looks at it.
 */
export const rekeyOfflineWorkflow = (
  map: OfflineWorkflowMap | null | undefined,
  fromId: unknown,
  toId: unknown
): OfflineWorkflowMap => {
  const from = String(fromId ?? '').trim();
  const to = String(toId ?? '').trim();
  const current = map || {};
  if (!from || !to || from === to || !current[from]) return current;
  const next = { ...current, [to]: current[from] };
  delete next[from];
  return next;
};

/** Drop marks that have aged out, so the store cannot grow across a rep's whole tenure. */
export const pruneOfflineWorkflow = (
  map: OfflineWorkflowMap | null | undefined,
  now: number = Date.now()
): OfflineWorkflowMap => {
  const out: OfflineWorkflowMap = {};
  Object.entries(map || {}).forEach(([id, entry]) => {
    if (freshAt(entry, now)) out[id] = entry;
  });
  return out;
};
