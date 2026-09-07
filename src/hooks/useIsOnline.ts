import { useEffect, useState } from 'react';
import { isOnline, subscribeConnectivity } from '../services/connectivity';

/**
 * React binding for `services/connectivity`.
 *
 * Reads the current value synchronously on mount (the monitor is started in
 * `useAppInitialization`, so it is already live by the time any screen renders) and re-renders on
 * change. Every screen that needs to know reads it from here — no screen subscribes to NetInfo
 * itself, or the debounce and the app-wide banner can disagree about the same fact.
 */
export const useIsOnline = (): boolean => {
  const [online, setOnline] = useState<boolean>(isOnline);

  useEffect(() => {
    // Re-sync on mount: a change could have landed between the initial state and this effect.
    setOnline(isOnline());
    return subscribeConnectivity(setOnline);
  }, []);

  return online;
};
