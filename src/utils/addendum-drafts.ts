export const isDraftApproved = (draft: any): boolean => {
  const s = String(draft?.status || '').toLowerCase();
  return s === 'accepted' || s === 'signed' || s === 'approved';
};

export const isDraftCancelled = (draft: any): boolean => {
  const s = String(draft?.status || '').toLowerCase();
  return s === 'cancelled' || s === 'canceled';
};

export const isPendingDraft = (draft: any): boolean =>
  String(draft?.status || '').toLowerCase() === 'pending';

export const countPendingDrafts = (drafts: any[] | null | undefined): number =>
  (drafts || []).filter(isPendingDraft).length;

export const hasPendingDraft = (drafts: any[] | null | undefined): boolean =>
  countPendingDrafts(drafts) > 0;
