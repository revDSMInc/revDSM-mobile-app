/**
 * Live device position for the installer schedule.
 *
 * The job card's action button has to reflect where the installer is RIGHT NOW: standing
 * at the address (or at a company office) it offers to start the visit, anywhere else it
 * can only offer a preview. That is a running question, not a one-off one — a crew pulls
 * up, parks, walks to the door — so this watches the position rather than sampling it
 * once, and the labels flip on their own as they arrive.
 *
 * Three deliberate choices:
 *  - **Watch, don't poll.** `distanceFilter` means the OS only wakes us when the phone
 *    has actually moved, which is far cheaper than a timer that re-fixes while the van
 *    sits still.
 *  - **Only while the screen is focused.** The watch is torn down on blur, so a GPS
 *    stream is never left running behind the job detail screen or in the background.
 *  - **A seed fix first.** `watchPosition` alone can stay silent until the device moves
 *    `distanceFilter` metres, which would leave every card unresolved for an installer
 *    who opened the app already parked at the job. One `getCurrentPosition` fills that in.
 *
 * `coords` stays null until a fix lands. Callers must treat null as UNKNOWN, never as
 * "out of range" — see `InstallerDashboard.isOffSite`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import Geolocation from 'react-native-geolocation-service';
import { ensureLocationPermission } from '../utils/installer-geofence';
import type { GeoCoordinates } from '../config/types/installer';

/**
 * How far the phone must move before the OS reports again, in metres.
 *
 * Well under `CHECK_IN_RADIUS_METERS` (20 m) on purpose: a filter at or above the radius
 * could let someone cross the boundary without a single update, and the button would
 * still read "Preview Appointment" while they stand on the driveway.
 */
const DISTANCE_FILTER_METERS = 5;

export interface InstallerProximity {
  /** Latest device fix, or null while none has landed (permission refused, no signal). */
  coords: GeoCoordinates | null;
  /** Reported horizontal accuracy of that fix in metres, when the platform gives one. */
  accuracy: number | null;
  /** False once a fix has been asked for and refused — location is off or denied. */
  permitted: boolean;
}

export function useInstallerProximity(enabled: boolean = true): InstallerProximity {
  const [coords, setCoords] = useState<GeoCoordinates | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [permitted, setPermitted] = useState(true);

  // Guards a late async callback from writing state after the screen has blurred or
  // unmounted — the permission request and the seed fix both outlive a quick back-tap.
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
          // Nothing to compare against. Cards keep whatever their workflow state says
          // rather than all flipping to preview over a permission the crew may still
          // grant at the tap, where the gate asks again and explains itself.
          setCoords(null);
          return;
        }

        // Seed — see the header note on why the watch alone is not enough.
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

  // A disabled hook must not keep reporting the last place it saw — a stale fix would
  // keep a card saying "Start Appointment" for a van that has since driven off.
  useEffect(() => {
    if (!enabled) {
      setCoords(null);
      setAccuracy(null);
    }
  }, [enabled]);

  return { coords, accuracy, permitted };
}
