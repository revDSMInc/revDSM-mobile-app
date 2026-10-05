/**
 * sessionScope.ts — who this device's stored data belongs to, and the wipe that ends a session.
 *
 * The rules are in `utils/session-scope.ts` (pure, tested). This is the device half: the MMKV
 * record of the current owner, a reset registry the in-memory stores hook into, and the two
 * entry points a session boundary calls.
 *
 * ⚠️ Deliberately depends on NOTHING but storage. Every offline store imports this to stamp and
 * filter its records, so an import of a store from here would close a cycle — which is why the
 * wipe reaches their in-memory copies through a registry rather than by calling them.
 */

import { Storage, storage } from '../utils/storage';
import {
  normalizeOwnerId,
  sessionKeysToClear,
} from '../utils/session-scope';

const OWNER_KEY = 'session:ownerId';

/**
 * ⚠️ Memoised, because this is read on every store read — the leads list filters its offline rows
 * through it on each render, and the photo queue on every pass. `null` means "not yet read".
 */
let cachedOwner: string | null = null;

/** The rep this device's stored work belongs to right now, or `''` between sessions. */
export const getSessionOwner = (): string => {
  if (cachedOwner === null) cachedOwner = normalizeOwnerId(Storage.getItem(OWNER_KEY));
  return cachedOwner;
};

const writeOwner = (owner: string): void => {
  cachedOwner = owner;
  try {
    if (owner) Storage.setItem(OWNER_KEY, owner);
    else Storage.removeItem(OWNER_KEY);
  } catch (e) {
    console.warn('[session] could not record the session owner', e);
  }
};

// ─── The reset registry ───────────────────────────────────────────────────────

type ResetHook = () => void;
const resetHooks = new Set<ResetHook>();

/**
 * Register a store's in-memory reset, run whenever the session ends.
 *
 * ⚠️ Wiping the MMKV key is not enough on its own. `offlineLeadStore` and `uploadQueueManager`
 * both hold the parsed array in a module-level variable and write it back on their next change —
 * so a store that was not told to forget re-persists the data the wipe just removed, and the next
 * rep has it again.
 */
export const registerSessionResetHook = (hook: ResetHook): (() => void) => {
  resetHooks.add(hook);
  return () => {
    resetHooks.delete(hook);
  };
};

const runResetHooks = (): void => {
  resetHooks.forEach((hook) => {
    try {
      hook();
    } catch (e) {
      // One store failing to reset must not leave the others holding the last rep's data.
      console.warn('[session] a store failed to reset', e);
    }
  });
};

// ─── The two session boundaries ───────────────────────────────────────────────

/**
 * End the session: drop every stored thing that belongs to a rep.
 *
 * Called from BOTH ways a session can end — the Log Out button and the 401 interceptor. That pair
 * is the point: before this, only the button did any cleanup at all, so a session that EXPIRED
 * left the whole of the previous rep's cached data in place for whoever signed in next.
 *
 * ⚠️ What survives is listed in `SESSION_KEEP_KEYS` — device settings, and the rep's own UNSYNCED
 * work, which is kept because ownership already hides it from anyone else and destroying it would
 * throw away a morning's work on a session that expired while they were stood on a driveway.
 */
export const resetSessionStorage = (nextOwner?: string | null): void => {
  // ⚠️ Hooks run BEFORE the wipe, not after. A store that has to tidy something OUTSIDE MMKV —
  // the map manager deletes the tile packs its registry names — can only read that registry while
  // it still exists; afterwards it would leave the downloads orphaned on disk with nothing
  // pointing at them. Nothing can interleave in between: this is all synchronous.
  runResetHooks();

  try {
    sessionKeysToClear(storage.getAllKeys()).forEach((key) => {
      try {
        storage.remove(key);
      } catch (e) {
        console.warn(`[session] could not clear ${key}`, e);
      }
    });
  } catch (e) {
    console.warn('[session] could not enumerate storage', e);
  }

  writeOwner(normalizeOwnerId(nextOwner));
};

/**
 * Begin a session: name the owner, and wipe first if it is a DIFFERENT person.
 *
 * ⚠️ This is the belt to the sign-out braces, and it is what covers the case no sign-out can: the
 * app killed mid-session, a crash, a build installed over one that never had this file. Whatever
 * happened, the rep signing in now is either the one whose data is on disk or they are not — and
 * if they are not, none of it may be visible to them.
 *
 * Signing back in as the SAME rep changes nothing, so their queued leads and photos are still
 * there. Returns true when a wipe happened, so a caller can drop its own in-memory caches too.
 */
export const adoptSessionOwner = (userId: unknown): boolean => {
  const next = normalizeOwnerId(userId);
  if (!next) return false;

  const current = getSessionOwner();
  if (current === next) return false;

  resetSessionStorage(next);
  return true;
};
