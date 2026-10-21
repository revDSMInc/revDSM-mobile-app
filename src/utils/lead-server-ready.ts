import { isOnline } from '../services/connectivity';
import { isSyncedLeadId } from './lead-sync-state';

/**
 * Can the server be told about THIS lead right now? Shape AND signal.
 *
 * This is the single predicate every funding gate must use (P1). A gate that asks only
 * `isOnline()` sends a client id the moment signal returns before the lead has uploaded.
 *
 * Fails SAFE (P3): a missing or stale client id answers `false`, i.e. "save it on the
 * device". The saga re-keys on drain and the `funding` step is idempotent, so queuing a
 * lead that has just synced costs nothing; sending one that has not is the bug.
 *
 * ⚠️ Kept OUT of `lead-sync-state.ts` on purpose — importing connectivity there would make
 * the pure module unloadable under jest and drag connectivity into `FundingService`.
 */
export const leadReachableOnServer = (leadId?: string | null): boolean =>
  isSyncedLeadId(leadId) && isOnline();