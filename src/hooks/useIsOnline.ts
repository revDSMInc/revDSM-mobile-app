import { useEffect, useState } from 'react';
import {
  getNetworkStatus,
  isEffectivelyOffline,
  subscribeConnectivity,
  subscribeNetworkStatus,
} from '../services/connectivity';
import type { NetworkStatus } from '../utils/network-status';

/**
 * React binding for `services/connectivity`.
 *
 * Reads the current value synchronously on mount (the monitor is started in
 * `useAppInitialization`, so it is already live by the time any screen renders) and re-renders on
 * change. Every screen that needs to know reads it from here — no screen subscribes to NetInfo
 * itself, or the debounce and the app-wide banner can disagree about the same fact.
 */
export const useIsOnline = (): boolean => {
  const [online, setOnline] = useState<boolean>(() => !isEffectivelyOffline());

  useEffect(() => {
    // ⚠️ Reads the THREE-state model, not the OS flag. A screen asking "am I online?" means
    // "can I expect the server to answer?", and on a degraded link the honest answer is no even
    // though NetInfo reports a connection. Every screen that already renders an offline state
    // therefore covers weak signal with no new prop.
    //
    // ⚠️ The SYNC QUEUES must not use this — they read `canAttemptSync()`, because a degraded
    // link has to keep being attempted; a real success is the only thing that restores `online`.
    const sync = () => setOnline(!isEffectivelyOffline());
    sync();
    const offStatus = subscribeNetworkStatus(sync);
    // The OS flag still moves independently (airplane mode), so stay subscribed to both.
    const offConn = subscribeConnectivity(sync);
    return () => {
      offStatus();
      offConn();
    };
  }, []);

  return online;
};

/**
 * The full three-state status, for a banner that distinguishes "no connection" from "poor
 * connection". Most screens want `useIsOnline` instead.
 */
export const useNetworkStatus = (): NetworkStatus => {
  const [status, setStatus] = useState<NetworkStatus>(getNetworkStatus);

  useEffect(() => {
    setStatus(getNetworkStatus());
    const offStatus = subscribeNetworkStatus(setStatus);
    const offConn = subscribeConnectivity(() => setStatus(getNetworkStatus()));
    return () => {
      offStatus();
      offConn();
    };
  }, []);

  return status;
};
