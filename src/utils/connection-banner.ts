/**
 * What the strip across the top of the app says about the connection.
 *
 * Three states, not five. The rep can take exactly three actions - carry on, expect waits, or
 * work from the device - and a bucket that maps to no action is a bucket that teaches them to
 * ignore the strip.
 *
 * ⚠️ UNSTABLE IS A REAL STATE, not a worse kind of online. It is the "one bar" case: the phone
 * is attached to a tower, requests open sockets, and nothing fails - it just crawls. Saying
 * nothing here is what left a rep staring at a spinner with no idea the app had noticed.
 */
import type { NetworkStatus } from './network-status';

export type BannerTone = 'none' | 'unstable' | 'offline';

export interface BannerCopy {
  tone: BannerTone;
  icon: string;
  title: string;
  /** Second line. Omitted when the title says enough on its own. */
  detail?: string;
}

/**
 * ⚠️ Offline keeps the ORIGINAL amber. A slate-grey bar was tried and reads as disabled
 * chrome rather than a notice - the rep's eye slides off it. Amber is the app's established
 * "read this" colour and offline is the state that most needs reading.
 */
export const OFFLINE_BG = '#FFF1C6';
export const OFFLINE_FG = '#7A4100';

/**
 * Weak is a LIGHTER amber of the same family, not a different hue: it is the same kind of
 * message, one step less urgent, and the rep should not have to learn a second colour.
 */
export const UNSTABLE_BG = '#FFF8E4';
export const UNSTABLE_FG = '#7A4100';

export const bannerFor = (status: NetworkStatus): BannerCopy => {
  switch (status) {
    case 'offline':
      return {
        tone: 'offline',
        icon: 'cloud-off-outline',
        title: 'Offline — showing saved data',
        detail: 'Changes sync when you reconnect.',
      };
    case 'degraded':
      // ⚠️ Never the word "offline" here. The rep CAN still work; saying offline would send
      // them hunting for signal when they should carry on and let it catch up.
      return {
        tone: 'unstable',
        icon: 'signal-cellular-outline',
        title: 'Weak connection',
        detail: 'Things may be slow — your work is still saved.',
      };
    default:
      return { tone: 'none', icon: '', title: '' };
  }
};

/**
 * How long a state must hold before the strip changes, so it never flickers.
 *
 * ⚠️ Asymmetric on purpose. Warning the rep is cheap and useful, so a worsening state shows
 * almost at once. Clearing the warning while the line is still flapping is what makes a strip
 * untrustworthy, so recovery has to prove itself for several seconds.
 */
export const BANNER_WORSEN_MS = 600;
export const BANNER_RECOVER_MS = 2_000;

const severity = (tone: BannerTone): number =>
  tone === 'offline' ? 2 : tone === 'unstable' ? 1 : 0;

/**
 * Should the strip move from `shown` to `next` yet?
 *
 * Pure so the hysteresis is testable without timers; the caller owns the clock.
 */
export const shouldSwitchBanner = (
  shown: BannerTone,
  next: BannerTone,
  heldForMs: number
): boolean => {
  if (shown === next) return false;
  const worsening = severity(next) > severity(shown);
  return heldForMs >= (worsening ? BANNER_WORSEN_MS : BANNER_RECOVER_MS);
};
