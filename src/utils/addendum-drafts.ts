/**
 * Status predicates for a lead's addendum drafts (`GET lead/v1/{id}/job-builder-drafts`).
 *
 * Pure and RN-free on purpose: the three surfaces that read a draft's status —
 * `AddendumsCard` (the list), `DealBanners` (the cancelled bar) and `JobDocsSection`
 * (which drives the Contract Details header) — all pull in React Native and are
 * untestable under jest here, so the rules that can be got wrong live in this file.
 * Keeping them in ONE place is also what stops "pending" meaning two different things
 * on two surfaces of the same screen.
 */

/**
 * An addendum only has a signed PDF once the customer approved it — that is when the
 * signature is captured. Accepts every spelling the status chip treats as approved.
 */
export const isDraftApproved = (draft: any): boolean => {
  const s = String(draft?.status || '').toLowerCase();
  return s === 'accepted' || s === 'signed' || s === 'approved';
};

/** Awaiting the customer's signature. */
export const isPendingDraft = (draft: any): boolean =>
  String(draft?.status || '').toLowerCase() === 'pending';

/** How many of the lead's addendums are still awaiting a signature. */
export const countPendingDrafts = (drafts: any[] | null | undefined): number =>
  (drafts || []).filter(isPendingDraft).length;

/** True when ANY addendum is awaiting a signature — drives the amber contract header. */
export const hasPendingDraft = (drafts: any[] | null | undefined): boolean =>
  countPendingDrafts(drafts) > 0;
