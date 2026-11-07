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

/**
 * Is this snapshot a DEFINITE disconnection — no usable interface at all?
 *
 * ⚠️ The distinction this draws is the whole point. `isConnected === false` is the OS saying
 * there is no link: airplane mode, no signal, wifi dropped. That is a fact about the radio and
 * nothing else can second-guess it.
 *
 * `isInternetReachable === false` is a very different claim: it means NetInfo's own GET of
 * `/health` did not come back inside `reachabilityRequestTimeout` (8 s). On a weak-but-working
 * line that request is simply SLOW, and a slow /health is indistinguishable from an absent one
 * at that layer — NetInfo has no "slow" verdict to report, so it reports the only failure it
 * has. Treating that as a definite disconnection is what put "Offline — showing saved data" on
 * screen for a rep on two bars of LTE with a perfectly reachable API.
 *
 * So: only the radio may force the offline verdict. A failed reachability probe downgrades to
 * `degraded` ("Weak connection") and lets `health-probe.ts` — which CAN tell slow from dead,
 * and retries before it ever says offline — make the final call.
 */
export const isDefinitelyDisconnected = (
  state: ConnectivitySnapshot | null | undefined
): boolean => !!state && state.isConnected === false;

export const OFFLINE_DEBOUNCE_MS = 1500;

export const transitionDelayMs = (nextOnline: boolean): number =>
  nextOnline ? 0 : OFFLINE_DEBOUNCE_MS;
