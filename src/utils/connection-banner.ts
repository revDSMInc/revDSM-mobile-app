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
 * ⚠️ ONE LINE, ON EVERY PHONE. The strip used to carry a title AND a detail sentence
 * ("Offline - showing saved data." + "Changes sync when you reconnect."), ~62 characters, which
 * wrapped to two lines on a 320pt iPhone SE and pushed the screen down. A status strip that
 * changes height is worse than a terse one: the content under it jumps as the link flaps.
 *
 * The copy is therefore ONE clause, and `OfflineBanner` renders it with `numberOfLines={1}` plus
 * `adjustsFontSizeToFit`, so the longest string shrinks rather than wraps on the narrowest
 * device. Keep new copy under ~40 characters or it will shrink far enough to look faint.
 *
 * ⚠️ Says what happens to THEIR WORK, and says it in full. A first attempt shortened offline to
 * "changes save to this device", which fits but is vague - it does not tell the rep the work
 * will go up by itself, which is the whole reassurance. "changes sync when you reconnect" is the
 * original wording and measures ~234pt of the ~275pt a 320pt phone has, so the clarity cost
 * nothing. Brevity is only worth it down to the point the sentence still answers the question.
 */
export const BANNER_MAX_CHARS = 44;

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
        title: 'Offline — changes sync when you reconnect',
        detail: undefined,
      };
    case 'degraded':
      // ⚠️ Never the word "offline" here. The rep CAN still work; saying offline would send
      // them hunting for signal when they should carry on and let it catch up.
      return {
        tone: 'unstable',
        icon: 'signal-cellular-outline',
        title: 'Weak connection — things may be slow',
        detail: undefined,
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
