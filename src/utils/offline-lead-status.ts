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
