export interface OfflineLeadWorkflow {
  workflowState: 'resume';
  at: string;
}

export type OfflineWorkflowMap = Record<string, OfflineLeadWorkflow>;

export const OFFLINE_WORKFLOW_TTL_MS = 24 * 60 * 60 * 1000;

const freshAt = (entry: OfflineLeadWorkflow | undefined, now: number): boolean => {
  if (!entry) return false;
  const at = Date.parse(String(entry.at || ''));
  return !Number.isNaN(at) && now - at < OFFLINE_WORKFLOW_TTL_MS;
};

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
 * ⚠️ The overlay is a STAND-IN for a check-in the server has not heard about yet - never a
 * second opinion about one it has.
 *
 * Reported: a rep checked in on phone A while offline. Phone A kept showing "Resume
 * Appointment"; a manager on phone B saw "Start Appointment". The lead's check-in had never
 * reached the server, and phone A could not tell, because it was reading its own overlay and
 * the overlay had no way to retire itself.
 *
 * `pending` is what makes that impossible now: once the queued `work` step has drained there is
 * nothing outstanding, so the overlay must stop speaking and let the server answer - even if it
 * says something we do not like. A local guess that outlives the fact it was guessing about is
 * worse than no guess, because it hides the disagreement.
 */
export const applyOfflineWorkflow = <T extends Record<string, any>>(
  lead: T,
  map: OfflineWorkflowMap | null | undefined,
  now: number = Date.now(),
  pending: ((leadId: string) => boolean) | null = null
): T => {
  const id = String(lead?._id || lead?.id || '').trim();
  if (!id) return lead;
  if (lead.workflowState === 'resume') return lead;
  const entry = map?.[id];
  if (!freshAt(entry, now)) return lead;
  // ⚠️ No `pending` predicate = the old behaviour, for callers that cannot see the queue.
  if (pending && !pending(id)) return lead;
  return { ...lead, workflowState: entry!.workflowState };
};

/**
 * Drop the overlay for a lead whose check-in has reached the server.
 *
 * ⚠️ Called when the `work` step drains, not when the lead itself does: a lead can sync long
 * before the check-in queued against it.
 */
export const clearOfflineCheckIn = (
  map: OfflineWorkflowMap | null | undefined,
  leadId: unknown
): OfflineWorkflowMap => {
  const id = String(leadId ?? '').trim();
  if (!id || !map || !(id in map)) return map || {};
  const next = { ...map };
  delete next[id];
  return next;
};

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
