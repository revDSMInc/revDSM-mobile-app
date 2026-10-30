export interface ConnectivitySnapshot {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}

export const resolveOnline = (state: ConnectivitySnapshot | null | undefined): boolean => {
  if (!state) return true; // nothing reported yet — stay optimistic, see above
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
};

export const OFFLINE_DEBOUNCE_MS = 1500;

export const transitionDelayMs = (nextOnline: boolean): number =>
  nextOnline ? 0 : OFFLINE_DEBOUNCE_MS;
