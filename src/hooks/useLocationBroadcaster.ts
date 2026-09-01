import { useEffect, useRef } from 'react';
import Geolocation from 'react-native-geolocation-service';
import SocketManager from '../services/SocketManager';
import { calculateDistance, GEOFENCE_RADIUS_MILES } from '../utils/location-util';

/**
 * Mobile port of web `src/components/location-broadcaster.js`.
 *
 * While a lead is open the rep's position is pushed to the lead's watch room once a
 * minute, so the ops side can see where they are and whether they are actually on site.
 * The payload is web's verbatim — `{ leadId, latitude, longitude, distance, withinRange }`
 * — with `distance` in MILES rounded to 2dp and `withinRange` true inside one mile.
 *
 * Web mounts this app-wide and keys it on the `workLeadId` its lead context holds from
 * check-in until the rep backs out. Mobile has no such global, but the window is exactly
 * the life of the Lead Center screen, so the hook is scoped to it instead. The paired
 * room join/leave (`join-lead-onsite-watch` / `leave-lead-onsite-watch`) still happens
 * where web does it — on check-in/resume and on the session pause.
 */
const BROADCAST_INTERVAL_MS = 60_000;

export function useLocationBroadcaster(lead: any, enabled: boolean = true) {
  const leadRef = useRef<any>(lead);
  // The room we last emitted for. Kept in a ref (web: `prevLeadIdRef`) so switching
  // leads without unmounting still leaves the old room exactly once.
  const broadcastingIdRef = useRef<string | null>(null);

  useEffect(() => {
    leadRef.current = lead;
  }, [lead]);

  const leadId: string | null = (lead?._id || lead?.id || null) as string | null;

  useEffect(() => {
    const previousId = broadcastingIdRef.current;
    if (previousId && previousId !== leadId) {
      SocketManager.emit('leave-rep-location', { leadId: previousId });
      broadcastingIdRef.current = null;
    }

    if (!enabled || !leadId) return undefined;

    let cancelled = false;

    const broadcast = (position: any) => {
      if (cancelled) return;
      const { latitude, longitude } = position.coords;

      // The lead's own coordinates are [lng, lat] (GeoJSON), same as web.
      const coords = leadRef.current?.location?.coordinates;
      let distance: number | null = null;
      let withinRange = false;
      if (Array.isArray(coords) && coords.length >= 2) {
        distance =
          Math.round(calculateDistance(latitude, longitude, coords[1], coords[0]) * 100) / 100;
        withinRange = distance <= GEOFENCE_RADIUS_MILES;
      }

      SocketManager.emit('update-rep-location', {
        leadId,
        latitude,
        longitude,
        distance,
        withinRange,
      });
      broadcastingIdRef.current = leadId;
    };

    const onFailure = (err: any) => {
      // A denied permission or a failed fix must never surface to the rep — this is
      // background telemetry for the ops side, not something they asked for.
      console.warn('[LocationBroadcaster] position error:', err?.message ?? err);
    };

    const sendLocation = () => {
      Geolocation.getCurrentPosition(
        broadcast,
        // ⚠️ A failed fix used to end the tick, so NOTHING went out for that minute —
        // and on a simulator, indoors, or with the radio busy that is every minute, which
        // leaves the ops board with a rep who joined the room and then never reported.
        // The retry accepts a much older fix rather than giving up: a five-minute-old
        // position still answers "is the rep at the house", and a stale answer beats
        // silence. It is a SECOND call, not a widened first one — the fresh reading is
        // still preferred whenever the device can produce one.
        () =>
          Geolocation.getCurrentPosition(broadcast, onFailure, {
            enableHighAccuracy: false,
            maximumAge: 300000,
            timeout: 15000,
          }),
        // Web's options verbatim: a cached, low-accuracy fix is enough to answer
        // "is the rep at the house", and it keeps the GPS radio off.
        { enableHighAccuracy: false, maximumAge: 30000, timeout: 5000 }
      );
    };

    sendLocation();
    const intervalId = setInterval(sendLocation, BROADCAST_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (broadcastingIdRef.current === leadId) {
        SocketManager.emit('leave-rep-location', { leadId });
        broadcastingIdRef.current = null;
      }
    };
  }, [leadId, enabled]);
}

export default useLocationBroadcaster;
