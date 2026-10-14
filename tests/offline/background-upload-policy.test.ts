import {
  decideBackgroundStep,
  isStalledPass,
  shouldStartBackgroundWork,
  uploadNotificationText,
  IOS_MIN_REMAINING_S,
  MAX_STALLED_PASSES,
  WAIT_FOR_NETWORK_MS,
  type BackgroundState,
} from '../../src/utils/background-upload-policy';

const base: BackgroundState = {
  pending: 3,
  online: true,
  remainingSeconds: Infinity,
  stalledPasses: 0,
  offlineForMs: 0,
};
const at = (over: Partial<BackgroundState>) => decideBackgroundStep({ ...base, ...over });

describe('decideBackgroundStep', () => {
  it('is done when nothing is queued, even offline or out of budget', () => {
    expect(at({ pending: 0 })).toBe('done');
    expect(at({ pending: 0, online: false, remainingSeconds: 0 })).toBe('done');
  });

  it('drains when online with work and budget', () => {
    expect(at({})).toBe('drain');
  });

  it('waits while offline, then gives up after the network deadline', () => {
    expect(at({ online: false })).toBe('wait');
    expect(at({ online: false, offlineForMs: WAIT_FOR_NETWORK_MS - 1 })).toBe('wait');
    expect(at({ online: false, offlineForMs: WAIT_FOR_NETWORK_MS })).toBe('give-up');
  });

  it('stops starting work when the iOS grace period is nearly spent', () => {
    expect(at({ remainingSeconds: IOS_MIN_REMAINING_S })).toBe('drain');
    expect(at({ remainingSeconds: IOS_MIN_REMAINING_S - 0.1 })).toBe('give-up');
    expect(at({ remainingSeconds: 2, online: false })).toBe('give-up');
  });

  it('gives up on a stuck queue only while online', () => {
    expect(at({ stalledPasses: MAX_STALLED_PASSES - 1 })).toBe('drain');
    expect(at({ stalledPasses: MAX_STALLED_PASSES })).toBe('give-up');
    expect(at({ stalledPasses: MAX_STALLED_PASSES, online: false })).toBe('wait');
  });
});

describe('isStalledPass', () => {
  it('counts a pass that made no progress while online', () => {
    expect(isStalledPass(3, 3, true)).toBe(true);
    expect(isStalledPass(3, 4, true)).toBe(true);
  });
  it('does not count progress, an empty queue, or a pass that lost signal', () => {
    expect(isStalledPass(3, 2, true)).toBe(false);
    expect(isStalledPass(0, 0, true)).toBe(false);
    expect(isStalledPass(3, 3, false)).toBe(false);
  });
});

describe('shouldStartBackgroundWork', () => {
  it('needs both a session and queued work', () => {
    expect(shouldStartBackgroundWork(2, true)).toBe(true);
    expect(shouldStartBackgroundWork(0, true)).toBe(false);
    expect(shouldStartBackgroundWork(2, false)).toBe(false);
  });
});

describe('uploadNotificationText', () => {
  it('pluralises and distinguishes waiting from uploading', () => {
    expect(uploadNotificationText(1, true).body).toBe('1 item left to upload.');
    expect(uploadNotificationText(4, true).title).toBe('Uploading your work');
    expect(uploadNotificationText(4, false).title).toBe('Waiting for connection');
    expect(uploadNotificationText(4, false).body).toContain('4 items');
  });
});
