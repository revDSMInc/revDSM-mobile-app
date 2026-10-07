import { useEffect, useRef } from 'react';
import Geolocation from 'react-native-geolocation-service';
import SocketManager from '../services/SocketManager';
import { calculateDistance, GEOFENCE_RADIUS_MILES } from '../utils/location-util';

const BROADCAST_INTERVAL_MS = 60_000;

export function useLocationBroadcaster(lead: any, enabled: boolean = true) {
  const leadRef = useRef<any>(lead);
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
      console.warn('[LocationBroadcaster] position error:', err?.message ?? err);
    };

    const sendLocation = () => {
      Geolocation.getCurrentPosition(
        broadcast,
        () =>
          Geolocation.getCurrentPosition(broadcast, onFailure, {
            enableHighAccuracy: false,
            maximumAge: 300000,
            timeout: 15000,
          }),
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
