/**
 * session-scope.ts — which of this device's stored data belongs to the signed-in REP, and how a
 * stored record says who it belongs to.
 *
 * Pure, so it can be tested without MMKV. The binding lives in `services/sessionScope.ts`.
 *
 * ## Why this exists
 *
 * Field crews share handsets, and every offline store this app has grown — the queued leads, the
 * photo outbox, the cached leads list, the Deal Center configs — was written to ONE MMKV instance
 * with no notion of an owner. Rep A created a lead at a door with no signal; rep B signed in on the
 * same phone and it was sitting in their Leads list, in their pending banner, and (worse) queued to
 * upload under their token onto their company's data.
 *
 * Two independent mechanisms answer that, and both are needed:
 *
 *   1. OWNERSHIP  — a record names its owner and is invisible, and un-uploadable, to anyone else.
 *      This holds even when no cleanup ever runs: a crash, a force-quit, an OS kill, a 401 handled
 *      by a code path nobody remembered to update. It is the guarantee.
 *   2. THE PURGE  — signing out (or a session expiring) drops everything that is a server mirror.
 *      This is hygiene, and it is what stops one rep's cached customer list sitting on disk under
 *      the next rep's session.
 *
 * ⚠️ The purge is a DENY-list, and that direction is deliberate. An allow-list ("wipe these keys")
 * fails by FORGETTING a store added later, which is silent and is exactly the bug being fixed here.
 * A deny-list ("keep these, wipe the rest") fails by over-cleaning — at worst a cache is re-fetched.
 * When adding a store, you have to opt it OUT of the wipe, not into it.
 */

/** Everything MMKV holds that is NOT one rep's data. Anything absent from here is wiped. */
export const SESSION_KEEP_KEYS: ReadonlySet<string> = new Set([
  // ── Device-level, survives every session ────────────────────────────────────
  /** The app language the person holding the phone chose. Not a rep's data. */
  'app:language',
  /**
   * The APNs/FCM token, which belongs to the INSTALL, not the user. The user↔token BINDING is
   * `pushBoundUserId`, and that is wiped — `PushNotificationService.unbind()` releases it server
   * side on the way out, and a fresh bind runs at the next sign-in.
   */
  'pushDeviceToken',
  /** The one-time AsyncStorage → MMKV migration flag. Re-running it would be pointless work. */
  'mmkv_migration_v1_done',
  /** Written by the reset itself; `resetSessionStorage` sets it deliberately, after the wipe. */
  'session:ownerId',
  /**
   * ⚠️ The session token, and it must be here.
   *
   * It is owned by `setSessionHeader` / `clearSession`, which both ends of a sign-out already
   * call — so the wipe does not need to remove it. And it MUST not: `adoptSessionOwner` runs at
   * sign-in AFTER the token has been stored, so on a first sign-in (no previous owner recorded,
   * therefore a wipe) this key would be deleted out from under the session that just began. The
   * app would work until the next launch and then present a login screen, which is a far more
   * confusing bug than the one being fixed.
   */
  'accessToken',

  // ── The rep's own UNSYNCED WORK ─────────────────────────────────────────────
  // ⚠️ Deliberately KEPT, and this is the one judgement call in this file.
  //
  // These are not caches. They hold work a rep did at a door that the server has never seen — a
  // lead created with no signal, the photos of a house. Wiping them on sign-out destroys it, and
  // a session that EXPIRES is not the rep's choice at all: a token can lapse while they are stood
  // on a driveway, and they would come back to find the morning gone.
  //
  // They are safe to keep because ownership (above) already makes them invisible and
  // un-uploadable to anyone else, which is the actual reported failure. They wait for their owner
  // to sign back in, and clear themselves the moment they upload.
  'offline_lead_work',
  'upload_photo_queue',
]);

/** Prefixes kept for the same reasons, for stores whose keys are generated. */
export const SESSION_KEEP_PREFIXES: readonly string[] = [
  /**
   * redux-persist's own root. It is the mechanism that persists the auth slice, and the sign-out
   * action already nulls the user through it — wiping the key from underneath redux-persist would
   * race its own rehydrate rather than achieve anything.
   */
  'persist:',
];

/** True when this key holds data belonging to the signed-in rep, and must not outlive the session. */
export const isSessionScopedKey = (key: string): boolean => {
  if (typeof key !== 'string' || !key) return false;
  if (SESSION_KEEP_KEYS.has(key)) return false;
  return !SESSION_KEEP_PREFIXES.some((p) => key.startsWith(p));
};

/** The keys a sign-out should remove, out of everything MMKV currently holds. */
export const sessionKeysToClear = (allKeys: readonly string[] | null | undefined): string[] =>
  (allKeys || []).filter(isSessionScopedKey);

// ─── Ownership ────────────────────────────────────────────────────────────────

/**
 * The canonical string form of a user id.
 *
 * ⚠️ Compared as STRINGS, and trimmed. The id reaches this from three places — the login response,
 * `getMe`, and a record written weeks ago — and a raw `===` between a string and anything else
 * reports "not the owner", which HIDES a rep's own work. Blank means "no owner", never "any owner".
 */
export const normalizeOwnerId = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && isFinite(value)) return String(value);
  return '';
};

/**
 * May the session owned by `owner` read, show and upload a record stamped `recordOwner`?
 *
 * ⚠️ An UNSTAMPED record (`''`) belongs to nobody and is answered `false` — for both halves of the
 * question. It is never shown, and it is never uploaded, because there is no honest way to say
 * whose it is: adopting it to whoever happens to be signed in is precisely the leak.
 *
 * Records like that exist only on builds that predate this file. They are not deleted here —
 * throwing away something that might be a rep's work is not a decision a predicate should make —
 * so they sit inert until the next sign-out clears them.
 *
 * ⚠️ With NO session (`owner` blank) nothing is owned. A drain that fires between sign-out and the
 * next sign-in must upload nothing rather than everything.
 */
export const isOwnedBy = (recordOwner: unknown, owner: unknown): boolean => {
  const me = normalizeOwnerId(owner);
  if (!me) return false;
  return normalizeOwnerId(recordOwner) === me;
};
