import axios from 'axios';
import { ENV } from '../../config/env';
import { Storage } from '../../utils/storage';
import Geolocation from 'react-native-geolocation-service';
import { isOnline } from '../connectivity';
import { hasQueuedActivityLogs, queueActivityLog, setActivityLogSender } from '../offlineActivityLog';
import {
  isQueueableLog,
  newActivityLogId,
  shouldQueueFailedLog,
  stampActionTime,
  stampOfflineLog,
} from '../../utils/offline-activity-log';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

const ExcludedModuleTypes = [
  'leads_list',
  'system',
  'lms',
  'self_gen_lead',
  'installer_dashboard',
];

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
        resolve(
          cachedLocation ? { lat: cachedLocation.lat, long: cachedLocation.long } : null
        );
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: LOCATION_TTL_MS }
    );
  });

let logChain: Promise<unknown> = Promise.resolve();

const sendLog = (
  eventType: string,
  payload: any,
  meta: any,
  attachLocation: boolean,
  token: string | null,
  rethrow = false
) => {
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
      const res = await axios.post(`${baseUrl}/user-activity-log/v1/create`, payload, {
        headers,
        timeout: 15000,
      });
      if (isDev) console.log(`[Logger] ✓ ${eventType}`);
      // Handed back so the offline replay can print what the server answered.
      return { status: res.status, data: res.data };
    } catch (err: any) {
      const status = err?.response?.status;
      console.warn(
        `[Logger] ✗ ${eventType} — ${status ?? 'no response'}:`,
        err?.response?.data ?? err?.message ?? err
      );

      /**
       * ⚠️ A FAILED LOG USED TO BE GONE FOR GOOD (ticket 1310). The catch printed a warning
       * and stopped there. `logEvent` only queues when `isOnline()` is false - but on mobile data
       * the app IS online, so the log went out over a flaky radio and a single timeout erased it.
       * That is how the Forever Record showed "CONFIRMED ROLLOUTS" with no price above it: two
       * separate requests, one delivered and one lost, making a rep look as though they confirmed
       * a rollout without ever entering a price.
       *
       * Queue it with the ORIGINAL `occurredAt` the payload already carries, so the replayed
       * entry lands in the right place in the timeline rather than at the time it got through.
       */
      if (!rethrow && isQueueableLog(payload?.module_type) && shouldQueueFailedLog(status)) {
        try {
          const heldMeta = stampOfflineLog(meta, meta?.occurredAt);
          queueActivityLog({
            eventType,
            payload: { ...payload, meta: heldMeta },
            meta: heldMeta,
            // Location was already resolved above if it was wanted. Re-resolving on replay would
            // attach where the rep is at RETRY time, which is somewhere else entirely.
            attachLocation: false,
            occurredAt: heldMeta.occurredAt,
          });
          if (isDev) console.log(`[Logger] ⤓ ${eventType} queued after send failure`);
        } catch (queueErr) {
          console.warn('[Logger] could not queue a failed log:', queueErr);
        }
      }

      if (rethrow) throw err;
    }
  });

  logChain = run.catch(() => {});
  return run;
};

setActivityLogSender((entry) => {
  const token = Storage.getItem('accessToken');
  if (!token) throw new Error('no session to replay an activity log with');
  return sendLog(entry.eventType, entry.payload, entry.payload?.meta ?? entry.meta, false, token, true);
});

interface PendingLog {
  eventType: string;
  payload: any;
  meta: any;
  attachLocation: boolean;
}

const MAX_PENDING_LOGS = 20;
const pendingLogs: PendingLog[] = [];

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

export const clearPendingLogs = () => {
  pendingLogs.length = 0;
};

export const logEvent = async (eventType: string, details: any = {}) => {
  const userId = details.user_id;
  const isPublic = details.isPublic || false;
  if (!userId && !isPublic) return;

  // The moment of the ACTION, taken before anything can wait (a held log, a slow location lookup, a
  // dead connection). It is the same `meta.occurredAt` on every path, so the backend never has to
  // guess between the action time and the time the request finally went out.
  const actionAt = new Date().toISOString();
  const meta: Record<string, any> = stampActionTime({ ...(details.meta || {}) }, actionAt);
  if (details.action && meta.action == null) {
    meta.action = details.action;
  }

  if (!meta.leadId && !ExcludedModuleTypes.includes(details.module_type)) {
    const storedLeadId = Storage.getItem('leadId');
    if (storedLeadId) {
      meta.leadId = storedLeadId;
    }
  }

  const currentTime = new Date();
  const estTime = new Date(
    currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' })
  );
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  const attachLocation = timeInMinutes >= 540 && timeInMinutes <= 1260;

  const payload: any = {
    // Stable for this log's whole life: held, retried and re-queued copies all carry it, so the
    // server can tell a repeat from a new action.
    user_activity_log_id: newActivityLogId(),
    user_id: userId,
    action_type: eventType,
    module_type: details.module_type,
    created_by: details.created_by || userId,
    meta,
  };

  const token = Storage.getItem('accessToken');

  if (isDev) {
    console.log(
      `[Logger] → ${eventType} (${details.module_type ?? 'no module'})` +
        `${userId ? '' : ' · public'}${token ? '' : ' · HELD (no session)'}`
    );
  }

  if (!token) {
    if (pendingLogs.length >= MAX_PENDING_LOGS) pendingLogs.shift();
    pendingLogs.push({ eventType, payload, meta, attachLocation });
    return;
  }

  // Held when offline, and ALSO while older held logs are still waiting: sending this one straight
  // away would put it ahead of actions the rep took earlier.
  if ((!isOnline() || hasQueuedActivityLogs()) && isQueueableLog(details.module_type)) {
    if (attachLocation && cachedLocation && Date.now() - cachedLocation.at < LOCATION_TTL_MS) {
      meta.lat = cachedLocation.lat;
      meta.long = cachedLocation.long;
    }
    const heldMeta = stampOfflineLog(meta, meta.occurredAt);
    queueActivityLog({
      eventType,
      payload: { ...payload, meta: heldMeta },
      meta: heldMeta,
      attachLocation: false,
      occurredAt: heldMeta.occurredAt,
    });
    if (isDev) console.log(`[Logger] ⤓ ${eventType} held offline (${details.module_type})`);
    return;
  }

  return sendLog(eventType, payload, meta, attachLocation, token);
};
