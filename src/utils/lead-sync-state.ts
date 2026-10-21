import { isClientId } from './offline-lead-work';

/**
 * Lead-id sync state — the shape half of "can the server be told about this lead?".
 *
 * ⚠️ `isOnline()` is NOT the question. A lead created at a door carries a client id
 * (`lead-…`/`appt-…`/`calc-…`/`work-…`) until its `lead` saga step lands, and every
 * lead-scoped endpoint 400s on a non-ObjectId. Signal returning is a different event
 * from the lead existing server-side; conflating them is the counterfeit-id trap
 * recorded in `docs/claude/offline.md`.
 *
 * This module is deliberately PURE (no connectivity, no RN) so the service layer can
 * guard without pulling in connectivity, and so it is loadable under jest.
 */

/** Machine code on the rejection raised when a client id reaches the network layer. */
export const LEAD_NOT_SYNCED = 'LEAD_NOT_SYNCED';

/** Rep-facing copy. Must never match `NETWORK_MESSAGE_RE` in `utils/network-error.ts`. */
export const LEAD_NOT_SYNCED_MESSAGE =
  "This lead hasn't finished uploading yet, so this was saved on your device. It will send itself once the lead syncs.";

/** Does this id name a lead the server already knows about? */
export const isSyncedLeadId = (leadId?: string | null): boolean =>
  !!leadId && !isClientId(String(leadId));

export interface LeadNotSyncedRejection {
  code: typeof LEAD_NOT_SYNCED;
  message: string;
  leadId: string;
}

/**
 * Matches this app's rejection convention: a PLAIN OBJECT, and **no `httpStatus`** — no HTTP
 * call happened. See the note on `normalizeApiError` in `utils/network-error.ts`.
 */
export const leadNotSyncedError = (leadId: string): LeadNotSyncedRejection => ({
  code: LEAD_NOT_SYNCED,
  message: LEAD_NOT_SYNCED_MESSAGE,
  leadId: String(leadId),
});

export const isLeadNotSyncedError = (err: unknown): boolean =>
  !!err && typeof err === 'object' && (err as { code?: string }).code === LEAD_NOT_SYNCED;

/**
 * Does any PATH SEGMENT of this URL carry a client id?
 *
 * Path only — a query string or body is out of scope. Reuses `isClientId`, so the detector
 * can never drift from the id minter. Used by the optional app-wide guard in §8.
 */
export const findClientIdInUrl = (url?: string | null): string | null => {
  if (!url) return null;
  const hit = String(url)
    .split('?')[0]
    .split('/')
    .find((segment) => {
      try {
        return isClientId(decodeURIComponent(segment));
      } catch {
        return isClientId(segment);
      }
    });
  return hit ? decodeURIComponent(hit) : null;
};

export const urlHasClientId = (url?: string | null): boolean => findClientIdInUrl(url) !== null;