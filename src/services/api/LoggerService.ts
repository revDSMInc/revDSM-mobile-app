import axios from 'axios';
import { ENV } from '../../config/env';
import { Storage } from '../../utils/storage';
import Geolocation from 'react-native-geolocation-service';

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
      const token = Storage.getItem('accessToken');
      const headers: any = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      // Cap the request so a single stuck POST can't freeze the whole log queue.
      await axios.post(`${baseUrl}/user-activity-log/v1/create`, payload, {
        headers,
        timeout: 15000,
      });
    } catch (err) {
      console.error('[Logger] Failed to send log:', err);
    }
  });

  // Keep the chain alive regardless of this log's outcome; callers that await get this
  // log's own completion (which already waits for its predecessors, preserving order).
  logChain = run.catch(() => {});
  return run;
};
