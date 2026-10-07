export const BACKGROUND_POLL_MS = 2_000;

export const IOS_MIN_REMAINING_S = 6;

export const WAIT_FOR_NETWORK_MS = 15 * 60_000;

export const MAX_STALLED_PASSES = 4;

export type BackgroundDecision = 'done' | 'drain' | 'wait' | 'give-up';

export interface BackgroundState {
  pending: number;
  online: boolean;
  remainingSeconds: number;
  stalledPasses: number;
  offlineForMs: number;
}

export const decideBackgroundStep = (s: BackgroundState): BackgroundDecision => {
  if (s.pending <= 0) return 'done';
  if (s.remainingSeconds < IOS_MIN_REMAINING_S) return 'give-up';
  if (!s.online) return s.offlineForMs >= WAIT_FOR_NETWORK_MS ? 'give-up' : 'wait';
  if (s.stalledPasses >= MAX_STALLED_PASSES) return 'give-up';
  return 'drain';
};

export const isStalledPass = (
  before: number,
  after: number,
  stayedOnline: boolean
): boolean => stayedOnline && before > 0 && after >= before;

export const shouldStartBackgroundWork = (pending: number, hasSession: boolean): boolean =>
  hasSession && pending > 0;

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
