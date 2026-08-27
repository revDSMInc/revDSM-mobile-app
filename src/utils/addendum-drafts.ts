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

/**
 * Cancelled on the PORTAL after it was raised. Terminal: unlike a pending addendum this
 * will never gain a PDF, so the surfaces that offer one have to say so differently.
 *
 * ⚠️ Both spellings are accepted. The lead's own result status is `cancelled`
 * (`DealBanners`), but the funding backend already sends the single-l `canceled` for its
 * own terminal states, so a draft arriving either way must not silently read as pending.
 */
export const isDraftCancelled = (draft: any): boolean => {
  const s = String(draft?.status || '').toLowerCase();
  return s === 'cancelled' || s === 'canceled';
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
