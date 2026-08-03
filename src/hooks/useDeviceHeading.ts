import { useEffect, useRef, useState } from 'react';

/**
 * useDeviceHeading — the device COMPASS heading in degrees (0 = north, clockwise),
 * updated continuously as the phone physically rotates, even while standing still.
 *
 * Why this exists: the live-location watch's `position.coords.heading` is GPS
 * course-over-ground — it only changes while you are MOVING and reflects your
 * direction of travel, not which way the phone is pointing. Standing still and
 * turning to face the street never updated it (the "facing the water, it's not
 * moving" bug). The magnetometer/compass is the correct source for facing.
 *
 * Source: `react-native-compass-heading`, which reads the platform compass and is
 * tilt-compensated natively on BOTH iOS and Android (Mapbox's own `coords.heading`
 * is a true compass on iOS but only the travel course on Android, so it can't be
 * used cross-platform — see rnmapbox LocationEvent.kt).
 *
 * Degrades safely: if the native module isn't linked yet — e.g. this JS shipped
 * before the app was rebuilt with the new pod/gradle dependency — the require is
 * caught and the hook simply stays `null`, so callers fall back to the GPS heading
 * and nothing crashes.
 */

// Optional native dep: resolve lazily so a not-yet-rebuilt binary doesn't throw.
let CompassHeading: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  CompassHeading = require('react-native-compass-heading').default;
} catch {
  CompassHeading = null;
}

/** Whether a usable compass module is linked into this binary. */
export const hasDeviceCompass = (): boolean => typeof CompassHeading?.start === 'function';

/**
 * @param enabled start/stop the compass with the caller's lifecycle (e.g. only while
 *   the map is visible and not drawing) to save battery.
 * @param updateRateDeg emit only when the heading changes by at least this many
 *   degrees — smooths sensor jitter and limits re-renders. Default 3°.
 */
export function useDeviceHeading(enabled: boolean, updateRateDeg = 3): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!enabled || !hasDeviceCompass()) return;

    let mounted = true;
    try {
      // Newer versions pass `{ heading, accuracy }`; older ones pass a bare number.
      const started = CompassHeading.start(updateRateDeg, (data: any) => {
        if (!mounted) return;
        const raw = typeof data === 'number' ? data : data?.heading;
        if (typeof raw === 'number' && !Number.isNaN(raw)) {
          setHeading(((raw % 360) + 360) % 360); // normalize to [0, 360)
        }
      });
      // v1.5.0's start/stop are async — swallow rejections so a sensor hiccup (or a
      // module that's present in JS but not fully linked) can't surface as an
      // unhandled promise rejection.
      if (started && typeof started.catch === 'function') started.catch(() => {});
      activeRef.current = true;
    } catch {
      activeRef.current = false;
    }

    return () => {
      mounted = false;
      if (activeRef.current) {
        try {
          const stopped = CompassHeading.stop();
          if (stopped && typeof stopped.catch === 'function') stopped.catch(() => {});
        } catch {
          /* no-op */
        }
        activeRef.current = false;
      }
    };
  }, [enabled, updateRateDeg]);

  return enabled ? heading : null;
}
