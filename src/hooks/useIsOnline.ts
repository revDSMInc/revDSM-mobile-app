import { useEffect, useState } from 'react';
import {
  getNetworkStatus,
  isEffectivelyOffline,
  subscribeConnectivity,
  subscribeNetworkStatus,
} from '../services/connectivity';
import type { NetworkStatus } from '../utils/network-status';

export const useIsOnline = (): boolean => {
  const [online, setOnline] = useState<boolean>(() => !isEffectivelyOffline());

  useEffect(() => {
    const sync = () => setOnline(!isEffectivelyOffline());
    sync();
    const offStatus = subscribeNetworkStatus(sync);
    const offConn = subscribeConnectivity(sync);
    return () => {
      offStatus();
      offConn();
    };
  }, []);

  return online;
};

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
