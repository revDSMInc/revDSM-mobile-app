import {
  isDefinitelyDisconnected,
  resolveOnline,
} from '../../src/utils/connectivity-state';
import {
  applyOsDisconnected,
  applyProbeResult,
  initialNetworkState,
  isEffectivelyOffline,
  shouldAttemptSync,
} from '../../src/utils/network-status';
import { BANNER_MAX_CHARS, bannerFor } from '../../src/utils/connection-banner';

/**
 * The client's second screenshot: "Offline - showing saved data" on a phone showing two bars of
 * LTE, with the API reachable. Reproduced with Network Link Conditioner at 12 kbps / 35% loss /
 * 3000 ms, which makes NetInfo's own /health GET miss its 8 s `reachabilityRequestTimeout`.
 */
describe('a weak line must not be reported as offline', () => {
  /**
   * ⚠️ THE DISTINCTION THE FIX RESTS ON. NetInfo has no "slow" verdict: when its reachability
   * GET times out it can only say `isInternetReachable: false`, which looks identical to a dead
   * link. Only `isConnected === false` is the OS reporting no interface at all.
   */
  it('separates "no radio" from "the reachability GET timed out"', () => {
    expect(isDefinitelyDisconnected({ isConnected: false, isInternetReachable: false })).toBe(true);
    expect(isDefinitelyDisconnected({ isConnected: true, isInternetReachable: false })).toBe(false);
  });

  it('still treats a slow link as not-online, so nothing assumes a live server', () => {
    expect(resolveOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
  });

  it('is conservative when the OS has told us nothing', () => {
    expect(isDefinitelyDisconnected(null)).toBe(false);
    expect(isDefinitelyDisconnected(undefined)).toBe(false);
    expect(isDefinitelyDisconnected({})).toBe(false);
  });
});

describe('what the rep is told', () => {
  const now = 1_000_000;

  /** ⚠️ The regression itself: this path used to produce the amber "Offline" bar. */
  it('a timed-out reachability probe shows "Weak connection", never "Offline"', () => {
    const state = applyProbeResult(initialNetworkState(now), 'slow', now);
    expect(state.status).toBe('degraded');
    expect(bannerFor(state.status).tone).toBe('unstable');
    expect(bannerFor(state.status).title).toMatch(/^Weak connection/);
    expect(bannerFor(state.status).title).not.toMatch(/offline/i);
  });

  /** A real disconnection must still say offline - the fix must not hide the true case. */
  it('a radio that is actually down still shows "Offline"', () => {
    const state = applyOsDisconnected(initialNetworkState(now), now);
    expect(state.status).toBe('offline');
    expect(bannerFor(state.status).tone).toBe('offline');
    expect(bannerFor(state.status).title).toMatch(/offline/i);
  });

  it('a healthy link shows no bar at all', () => {
    expect(bannerFor('online').tone).toBe('none');
  });
});

describe('what degraded still costs', () => {
  const now = 2_000_000;

  /**
   * ⚠️ `degraded` is not a free win. It gates the features that need a live server exactly as
   * offline does, which is correct on a crawling line.
   */
  it('still gates server-dependent features', () => {
    expect(isEffectivelyOffline('degraded')).toBe(true);
  });

  /**
   * ⚠️ But it KEEPS SYNCING, and that is the real gain over the old behaviour. Settling to
   * `offline` stopped the queues on a line that was slow but working; `degraded` lets them keep
   * draining, which is what the rep actually needs on two bars.
   */
  it('keeps draining the queues, which offline does not', () => {
    expect(shouldAttemptSync('degraded')).toBe(true);
    expect(shouldAttemptSync('offline')).toBe(false);
  });

  it('a probe can never promote straight to online - only a real 2xx proves we are served', () => {
    const state = applyProbeResult(initialNetworkState(now), true, now);
    expect(state.status).not.toBe('online');
  });
});


/**
 * Client: *"in some phone bar is going in 2nd line ... i want to keep it in only one line in any
 * phone"*. A strip that changes height makes the screen under it jump every time the link flaps.
 */
describe('the strip fits one line on every phone', () => {
  const lines = (['offline', 'degraded'] as const).map((s) => {
    const c = bannerFor(s);
    return c.detail ? `${c.title}. ${c.detail}` : c.title;
  });

  it('is one clause, not a title plus a sentence', () => {
    (['offline', 'degraded'] as const).forEach((s) => {
      expect(bannerFor(s).detail).toBeUndefined();
    });
  });

  it('stays within the width a 320pt phone can show', () => {
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(BANNER_MAX_CHARS));
  });

  it('still names the state and what happens to the work', () => {
    expect(bannerFor('offline').title).toMatch(/offline/i);
    // ⚠️ The reassurance, not just the state: the rep must learn the work goes up by itself.
    expect(bannerFor('offline').title).toMatch(/sync|saved|device/i);
    expect(bannerFor('degraded').title).toMatch(/weak/i);
  });

  /** ⚠️ Still never the word "offline" on a line that is merely slow. */
  it('never calls a weak line offline', () => {
    expect(bannerFor('degraded').title).not.toMatch(/offline/i);
  });
});
