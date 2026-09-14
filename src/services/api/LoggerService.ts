import axios from 'axios';
import { ENV } from '../../config/env';
import { Storage } from '../../utils/storage';
import Geolocation from 'react-native-geolocation-service';
import { isOnline } from '../connectivity';
import { queueActivityLog, setActivityLogSender } from '../offlineActivityLog';
import { isQueueableLog, stampOfflineLog } from '../../utils/offline-activity-log';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * Modules that are not scoped to a single lead/job, so the active `leadId` in
 * storage must NOT be auto-attached to their logs (it would link an auth event or
 * a dashboard view to whichever lead the user happened to open last).
 */
const ExcludedModuleTypes = [
  'leads_list',
  'system',
  'lms',
  'self_gen_lead',
  'installer_dashboard',
];

// ---------------------------------------------------------------------------
// Location cache
// ---------------------------------------------------------------------------
// Previously every logEvent awaited a FRESH high-accuracy GPS fix
// (`getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 })`) before POSTing.
// That fix takes a DIFFERENT amount of time on every call (tens of ms up to the 5s
// timeout). Because the client sends NO timestamp, the backend stamps `createdAt` on
// RECEIPT, and the portal timeline renders logs in arrival order (it does not sort by
// `stepNumber`). So a burst of logs fired together — install-step events, photo-match
// batches, calculator field entries, rollout events — arrived in a scrambled order and
// rendered out of sequence on the portal.
//
// Fix: fetch a low-accuracy fix ONCE and reuse it for a short window, so the pre-POST
// delay is ~0 and uniform (mirrors the web logger, which uses a fast cached browser
// fix). Combined with the serialized queue below, logs now arrive in the order they
// were fired.
let cachedLocation: { lat: number; long: number; at: number } | null = null;
const LOCATION_TTL_MS = 60_000;

const getCachedLocation = (): Promise<{ lat: number; long: number } | null> =>
  new Promise((resolve) => {
    if (cachedLocation && Date.now() - cachedLocation.at < LOCATION_TTL_MS) {
      resolve({ lat: cachedLocation.lat, long: cachedLocation.long });
      return;
    }
    Geolocation.getCurrentPosition(
      (pos) => {
        cachedLocation = {
          lat: pos.coords.latitude,
          long: pos.coords.longitude,
          at: Date.now(),
        };
        resolve({ lat: cachedLocation.lat, long: cachedLocation.long });
      },
      (err) => {
        console.warn('[Logger] Could not get user location:', err);
        // Fall back to the last known fix (if any) rather than blocking.
        resolve(
          cachedLocation ? { lat: cachedLocation.lat, long: cachedLocation.long } : null
        );
      },
      // Low-accuracy + generous maximumAge → the OS returns a cached fix immediately
      // instead of powering up GPS for a fresh reading on each call.
      { enableHighAccuracy: false, timeout: 5000, maximumAge: LOCATION_TTL_MS }
    );
  });

// ---------------------------------------------------------------------------
// Serialized POST queue
// ---------------------------------------------------------------------------
// The portal orders timeline entries purely by server receipt time with no tiebreak,
// so concurrent POSTs (a `Promise.all` burst of auto-populated logs, an un-awaited
// step view, etc.) could still arrive out of order even with a fast location fix.
// Chaining every log POST guarantees monotonic arrival order = fire order. The chain is
// extended SYNCHRONOUSLY at the top of logEvent (before any await) so its FIFO order is
// the call order; errors are swallowed so one failed POST never breaks the chain.
let logChain: Promise<unknown> = Promise.resolve();

/** One queued POST. Split out so a buffered log replays through the same path. */
const sendLog = (
  eventType: string,
  payload: any,
  meta: any,
  attachLocation: boolean,
  token: string | null,
  /**
   * Reject instead of swallowing. Only the offline REPLAY passes this: a live log is
   * fire-and-forget by design (the comment in the catch below), but a held one has to know
   * whether it landed or the queue would drop rows that never reached the portal.
   */
  rethrow = false
) => {
  // Enqueue synchronously so the queue order == the order logEvent was called in.
  const run = logChain.then(async () => {
    try {
      if (attachLocation) {
        const loc = await getCachedLocation();
        if (loc) {
          meta.lat = loc.lat;
          meta.long = loc.long;
        }
      }
      const baseUrl = ENV.API_URL.endsWith('/') ? ENV.API_URL.slice(0, -1) : ENV.API_URL;
      const headers: any = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      // Cap the request so a single stuck POST can't freeze the whole log queue.
      await axios.post(`${baseUrl}/user-activity-log/v1/create`, payload, {
        headers,
        timeout: 15000,
      });
      if (isDev) console.log(`[Logger] ✓ ${eventType}`);
    } catch (err: any) {
      // console.warn, NOT console.error: LogBox turns a console.error into a
      // full-screen red "Console Error" overlay, so a single 502 from the logging
      // service used to cover the screen the installer was working on. A dropped
      // analytics event is a diagnostic, never something the user must act on.
      //
      // The event name and status are named because a silently missing log row is
      // otherwise indistinguishable from one that was never fired.
      console.warn(
        `[Logger] ✗ ${eventType} — ${err?.response?.status ?? 'no response'}:`,
        err?.response?.data ?? err?.message ?? err
      );
      if (rethrow) throw err;
    }
  });

  // Keep the chain alive regardless of this log's outcome; callers that await get this
  // log's own completion (which already waits for its predecessors, preserving order).
  logChain = run.catch(() => {});
  return run;
};

// ---------------------------------------------------------------------------
// Offline replay
// ---------------------------------------------------------------------------
// A held log goes out through the SAME chained POST a live one does, so a replay cannot
// overtake a log the rep is firing right now.
//
// ⚠️ `attachLocation: false`, always. The held row already carries the fix from where the rep
// actually stood (stamped at queue time, below); asking the device again at replay time would
// pin a 9am doorstep to wherever the truck is when signal returns — a plausible-looking lie on
// the one field the office uses to prove attendance.
setActivityLogSender((entry) => {
  const token = Storage.getItem('accessToken');
  if (!token) throw new Error('no session to replay an activity log with');
  return sendLog(entry.eventType, entry.payload, entry.payload?.meta ?? entry.meta, false, token, true);
});

// ---------------------------------------------------------------------------
// Pre-auth buffer
// ---------------------------------------------------------------------------
// `user-activity-log/v1/create` REJECTS an unauthenticated body — it answers
// `{"error":"Failed to create activity log"}`. That is a problem for the sign-in events
// (`login_attempt`, `login_failed`, `login_2fa_required`, `login_2fa_failed`), which by
// definition fire before a token exists: every one of them went up bare, failed, and
// left a red line in the network log before the user had even signed in.
//
// So a log with no token is HELD rather than sent, and replayed by `flushPendingLogs`
// the moment a session exists. The sign-in history still reaches the portal — one
// request later, and authenticated, which is the only way this endpoint accepts it.
//
// In memory only, deliberately: these carry the typed email, and an attempt that never
// led to a session is not worth writing to disk to survive an app restart.
interface PendingLog {
  eventType: string;
  payload: any;
  meta: any;
  attachLocation: boolean;
}

/** A stuck login screen must not grow this without bound; oldest is dropped first. */
const MAX_PENDING_LOGS = 20;
const pendingLogs: PendingLog[] = [];

/**
 * Replays everything buffered while signed out, now that there is a token.
 *
 * Call it as soon as the session is established and BEFORE logging the sign-in itself,
 * so the portal shows attempt → 2FA → login in the order they happened (the backend
 * stamps `createdAt` on receipt, so arrival order is the only order there is).
 *
 * Events buffered with no `user_id` — every pre-auth one, since there was no user yet —
 * are attributed to whoever just signed in, but ONLY when `meta.email` says the event
 * was about them. One device can see several accounts: a rep mistypes an address, fails,
 * and a colleague signs in on the same phone. Stamping that colleague's id onto the
 * first rep's failed attempt would file it under the wrong person, so an event naming a
 * different email is dropped instead. It was never sendable — the endpoint refuses rows
 * with no user — and a missing log beats a misattributed one.
 */
export const flushPendingLogs = (user?: any) => {
  if (!pendingLogs.length) return;

  const token = Storage.getItem('accessToken');
  if (!token) return;

  const queued = pendingLogs.splice(0, pendingLogs.length);
  const userId = user?._id || user?.id;
  const email = String(user?.email ?? '').trim().toLowerCase();

  if (isDev) console.log(`[Logger] flushing ${queued.length} pre-auth log(s)`);

  queued.forEach(({ eventType, payload, meta, attachLocation }) => {
    if (!payload.user_id) {
      const about = String(meta?.email ?? '').trim().toLowerCase();
      if (about && email && about !== email) {
        if (isDev) console.log(`[Logger] dropping held ${eventType} — different account`);
        return;
      }
      if (!userId) return;
      payload.user_id = userId;
      payload.created_by = payload.created_by || userId;
    }
    sendLog(eventType, payload, meta, attachLocation, token);
  });
};

/** Drops anything held from a session that never happened. */
export const clearPendingLogs = () => {
  pendingLogs.length = 0;
};

export const logEvent = async (eventType: string, details: any = {}) => {
  const userId = details.user_id;
  const isPublic = details.isPublic || false;
  if (!userId && !isPublic) return;

  const meta = { ...(details.meta || {}) };
  if (details.action && meta.action == null) {
    meta.action = details.action;
  }

  // Sync with web app: automatically attach leadId if missing and available in storage
  if (!meta.leadId && !ExcludedModuleTypes.includes(details.module_type)) {
    const storedLeadId = Storage.getItem('leadId');
    if (storedLeadId) {
      meta.leadId = storedLeadId;
    }
  }

  // Check current time in EST for location logging (9am to 7pm)
  const currentTime = new Date();
  const estTime = new Date(
    currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' })
  );
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  // Between 9am (540 min) and 7pm (1260 min)
  const attachLocation = timeInMinutes >= 540 && timeInMinutes <= 1260;

  const payload: any = {
    user_id: userId,
    action_type: eventType,
    module_type: details.module_type,
    created_by: details.created_by || userId,
    meta,
  };

  /**
   * Captured NOW, not inside the queued task below.
   *
   * The task runs a tick or more later — after everything ahead of it in the chain —
   * and a log fired around a session change would then read the wrong thing. Logout is
   * the case that actually broke: it logs while signing out, and by the time its POST
   * ran, `clearSession()` had already removed the token, so the request went up
   * unauthenticated and the event was lost.
   */
  const token = Storage.getItem('accessToken');

  if (isDev) {
    console.log(
      `[Logger] → ${eventType} (${details.module_type ?? 'no module'})` +
        `${userId ? '' : ' · public'}${token ? '' : ' · HELD (no session)'}`
    );
  }

  // No session yet — hold it. The endpoint refuses unauthenticated rows, so sending it
  // now would only produce an error; `flushPendingLogs` replays it after sign-in.
  if (!token) {
    if (pendingLogs.length >= MAX_PENDING_LOGS) pendingLogs.shift();
    pendingLogs.push({ eventType, payload, meta, attachLocation });
    return;
  }

  // No CONNECTION — hold the few events the office actually reads, on disk, and replay them on
  // reconnect. Everything else stays fire-and-forget: see `QUEUEABLE_LOG_MODULES` for why this is
  // an allow-list rather than "queue everything".
  if (!isOnline() && isQueueableLog(details.module_type)) {
    const occurredAt = new Date().toISOString();
    // ⚠️ The location is taken NOW, from the fix this session already has, rather than at replay
    // time — these events are the record of where the rep was standing. A stale-or-missing fix is
    // the honest answer; the wrong one is not.
    if (attachLocation && cachedLocation && Date.now() - cachedLocation.at < LOCATION_TTL_MS) {
      meta.lat = cachedLocation.lat;
      meta.long = cachedLocation.long;
    }
    const heldMeta = stampOfflineLog(meta, occurredAt);
    queueActivityLog({
      eventType,
      payload: { ...payload, meta: heldMeta },
      meta: heldMeta,
      attachLocation: false,
      occurredAt,
    });
    if (isDev) console.log(`[Logger] ⤓ ${eventType} held offline (${details.module_type})`);
    return;
  }

  return sendLog(eventType, payload, meta, attachLocation, token);
};
