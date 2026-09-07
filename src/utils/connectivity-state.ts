/**
 * connectivity-state.ts — the pure decision rules behind "are we online?".
 *
 * Split out of `services/connectivity.ts` for the reason `utils/addendum-drafts.ts` and
 * `utils/inspection-photos.ts` exist: the service imports the NetInfo native module and cannot be
 * loaded under jest here, while these three rules are exactly the kind of thing that fails
 * SILENTLY — an app that believes it is offline serves stale data forever and never syncs, and one
 * that believes it is online blocks the rep behind spinners. Neither throws.
 */

/** The subset of `NetInfoState` these rules read. */
export interface ConnectivitySnapshot {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}

/**
 * ⚠️ `isConnected` is NOT `isInternetReachable`, and conflating them is the classic bug here.
 * A rep on a hotel captive portal, or a truck with one bar that cannot complete a request, has a
 * network INTERFACE and no internet — `isConnected: true`, `isInternetReachable: false`.
 *
 * `isInternetReachable` is `null` while the probe has not finished, which is the normal state for
 * the first moment after launch. That is read as ONLINE, deliberately:
 *
 *   - a false "offline" flash on every cold start is visible and wrong;
 *   - being optimistic costs nothing, because a request that goes out on a dead link fails and
 *     `isNetworkError` catches it — the app already degrades correctly from a failed request;
 *   - being pessimistic is NOT free: it would suppress the launch refetch and leave a rep on cached
 *     data while they actually have signal.
 *
 * So: online unless something positively says otherwise.
 */
export const resolveOnline = (state: ConnectivitySnapshot | null | undefined): boolean => {
  if (!state) return true; // nothing reported yet — stay optimistic, see above
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
};

/**
 * How long a reported drop must persist before the app acts on it.
 *
 * Connectivity flaps constantly in the field — a rep walking behind a house, a handover between
 * cell towers, a lift. Reacting to every blip makes the banner strobe and, far worse, would
 * repeatedly tear down and restart the outbox drain mid-flight.
 */
export const OFFLINE_DEBOUNCE_MS = 1500;

/**
 * ⚠️ Asymmetric by design: going OFFLINE waits out the debounce, coming back ONLINE is immediate.
 *
 * The costs are not symmetric. Announcing offline early is a visible lie and interrupts work;
 * announcing online early costs one failed request that we already handle. And a rep who has just
 * walked back into signal should have their queued work start syncing on that step, not 1.5 s later.
 */
export const transitionDelayMs = (nextOnline: boolean): number =>
  nextOnline ? 0 : OFFLINE_DEBOUNCE_MS;
