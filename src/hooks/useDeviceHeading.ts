import { useEffect, useRef, useState } from 'react';

let CompassHeading: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  CompassHeading = require('react-native-compass-heading').default;
} catch {
  CompassHeading = null;
}

export const hasDeviceCompass = (): boolean => typeof CompassHeading?.start === 'function';

export function useDeviceHeading(enabled: boolean, updateRateDeg = 3): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!enabled || !hasDeviceCompass()) return;

    let mounted = true;
    try {
      const started = CompassHeading.start(updateRateDeg, (data: any) => {
        if (!mounted) return;
        const raw = typeof data === 'number' ? data : data?.heading;
        if (typeof raw === 'number' && !Number.isNaN(raw)) {
          setHeading(((raw % 360) + 360) % 360); // normalize to [0, 360)
        }
      });
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
        }
        activeRef.current = false;
      }
    };
  }, [enabled, updateRateDeg]);

  return enabled ? heading : null;
}
