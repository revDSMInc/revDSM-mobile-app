import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import Geolocation from 'react-native-geolocation-service';
import { ensureLocationPermission } from '../utils/installer-geofence';
import type { GeoCoordinates } from '../config/types/installer';

const DISTANCE_FILTER_METERS = 5;

export interface InstallerProximity {
  coords: GeoCoordinates | null;
  accuracy: number | null;
  permitted: boolean;
}

export function useInstallerProximity(enabled: boolean = true): InstallerProximity {
  const [coords, setCoords] = useState<GeoCoordinates | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [permitted, setPermitted] = useState(true);

  const activeRef = useRef(false);

  const apply = useCallback((position: any) => {
    if (!activeRef.current) return;
    const { latitude, longitude, accuracy: acc } = position?.coords ?? {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    setCoords({ latitude, longitude });
    setAccuracy(Number.isFinite(acc) ? acc : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;

      activeRef.current = true;
      let watchId: number | null = null;

      (async () => {
        const allowed = await ensureLocationPermission().catch(() => false);
        if (!activeRef.current) return;

        setPermitted(allowed);
        if (!allowed) {
          setCoords(null);
          return;
        }

        Geolocation.getCurrentPosition(
          apply,
          (err) =>
            console.warn('[InstallerProximity] Seed fix failed:', err?.code, err?.message),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );

        if (!activeRef.current) return;
        watchId = Geolocation.watchPosition(
          apply,
          (err) =>
            console.warn('[InstallerProximity] Watch failed:', err?.code, err?.message),
          {
            enableHighAccuracy: true,
            distanceFilter: DISTANCE_FILTER_METERS,
            interval: 10000,
            fastestInterval: 5000,
          }
        );
      })();

      return () => {
        activeRef.current = false;
        if (watchId !== null) Geolocation.clearWatch(watchId);
      };
    }, [enabled, apply])
  );

  useEffect(() => {
    if (!enabled) {
      setCoords(null);
      setAccuracy(null);
    }
  }, [enabled]);

  return { coords, accuracy, permitted };
}
