/**
 * background-upload-policy.ts — the rules for draining the offline queues while the app is NOT on
 * screen.
 *
 * The app already drains its queues on a reconnect edge, on foregrounding and on a 60 s sweep, but
 * every one of those is a JS timer or listener — and the OS stops running JS shortly after the app
 * leaves the screen. This module decides what a background drain does, given what the platform
 * allows; `services/background/*` is the device half that acts on the decision.
 *
 * ⚠️ The two platforms grant very different budgets, and the policy is what keeps them honest:
 *   - iOS gives a FINITE grace period after backgrounding (`beginBackgroundTask`, about 30 s). The
 *     OS terminates the app if it overruns, so a pass must STOP STARTING new work when little is
 *     left rather than run until it is cut off mid-request.
 *   - Android can hold a foreground service for as long as work remains, but a service that waits
 *     forever on a phone with no coverage is a permanent notification and a battery cost, so it
 *     gives up after `WAIT_FOR_NETWORK_MS` and leaves the queue to the next reconnect / foreground.
 *
 * Pure and RN-free so the rules are testable under jest.
 */

/** Pause between passes. Passes return at once when a queue is already mid-drain elsewhere. */
export const BACKGROUND_POLL_MS = 2_000;

/**
 * Stop starting a new pass with this little of the iOS grace period left. A photo upload that
 * begins with 3 s remaining cannot finish, and being killed mid-request is worse than not starting.
 */
export const IOS_MIN_REMAINING_S = 6;

/**
 * How long a background service waits for signal to return before it releases the process.
 * Long enough to cover a tunnel or a basement; short enough that a rep who is genuinely offline all
 * day does not carry a notification and a held process for it.
 */
export const WAIT_FOR_NETWORK_MS = 15 * 60_000;

/**
 * Consecutive passes that sent nothing while online before we conclude the queue is stuck.
 * Whatever is left is retried by the foreground hook and the 60 s sweep; spinning here would only
 * burn the grace period / the notification.
 */
export const MAX_STALLED_PASSES = 4;

export type BackgroundDecision = 'done' | 'drain' | 'wait' | 'give-up';

export interface BackgroundState {
  /** Items across every queue that are ready to send (not waiting on a client-id rekey). */
  pending: number;
  online: boolean;
  /** iOS: seconds of grace left. `Infinity` where the platform has no such budget. */
  remainingSeconds: number;
  /** Consecutive passes, while online, after which `pending` had not gone down. */
  stalledPasses: number;
  /** How long we have been continuously offline while holding work, in ms. 0 when online. */
  offlineForMs: number;
}

/**
 * What the background loop does next.
 *
 *   done     nothing left — end the task / stop the service.
 *   drain    online with work and budget — run a pass.
 *   wait     offline (or just reconnected) — hold, and re-check shortly.
 *   give-up  budget gone, queue stuck, or offline too long — release the process.
 */
export const decideBackgroundStep = (s: BackgroundState): BackgroundDecision => {
  if (s.pending <= 0) return 'done';
  if (s.remainingSeconds < IOS_MIN_REMAINING_S) return 'give-up';
  if (!s.online) return s.offlineForMs >= WAIT_FOR_NETWORK_MS ? 'give-up' : 'wait';
  if (s.stalledPasses >= MAX_STALLED_PASSES) return 'give-up';
  return 'drain';
};

/**
 * Whether a stalled pass should be counted as one. A pass "stalled" if it started with work, the
 * device stayed online throughout, and the count did not fall. A pass during which signal dropped
 * is NOT a stall — the work simply could not move — and counting it would give up the very moment
 * the rep drives out of coverage.
 */
export const isStalledPass = (
  before: number,
  after: number,
  stayedOnline: boolean
): boolean => stayedOnline && before > 0 && after >= before;

/** Whether leaving the foreground with this much queued is worth asking the OS for time. */
export const shouldStartBackgroundWork = (pending: number, hasSession: boolean): boolean =>
  hasSession && pending > 0;

/** Text for the Android foreground-service notification. */
export const uploadNotificationText = (
  pending: number,
  online: boolean
): { title: string; body: string } => {
  const noun = pending === 1 ? 'item' : 'items';
  if (!online) {
    return {
      title: 'Waiting for connection',
      body: `${pending} ${noun} will upload when you are back online.`,
    };
  }
  return {
    title: 'Uploading your work',
    body: `${pending} ${noun} left to upload.`,
  };
};
