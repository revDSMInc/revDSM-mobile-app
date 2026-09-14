/**
 * Whether the Pitch Book's fullscreen gesture tutorial should open.
 *
 * Pure and RN-free, for the reason `utils/addendum-drafts.ts` and
 * `utils/inspection-photos.ts` exist: the screen that consumes this pulls in React Native
 * and is untestable under jest here, and a rule that gets this wrong either nags a rep
 * who asked to be left alone or never shows the tutorial at all — neither leaves a trace.
 */

/** MMKV key. Versioned, so a future revision of the cards can re-introduce itself. */
export const PRESENTATION_TUTORIAL_SEEN_KEY = 'pitchbook-gesture-tutorial-v1';

/**
 * The two buttons are NOT the same action, and that is the whole rule:
 *
 *   "Got It, Dismiss"      → closes for now; it opens again next presentation.
 *   "Don't show me again"  → closes and is remembered, forever.
 *
 * ⚠️ Only the second one writes. A rep who taps the primary button has said "not now",
 * not "never" — treating the two alike would make the quieter button pointless and is
 * the easy mistake here.
 */
export const shouldShowPresentationTutorial = (storedFlag: string | null | undefined): boolean =>
  String(storedFlag ?? '') !== '1';

/** What "Don't show me again" writes. */
export const PRESENTATION_TUTORIAL_SEEN_VALUE = '1';

/**
 * Did this pan count as a slide-changing swipe, and in which direction?
 *
 * ⚠️ Requires a real horizontal intent — `MIN_SWIPE_DISTANCE` of travel and more
 * horizontal than vertical movement. Without the second test a rep scrolling the
 * category tabs or dragging slightly while tapping an arrow would change slide mid
 * sentence, in front of a customer.
 *
 * ⚠️ **There is no longer an edge BAND, and `presentationZone` / `EDGE_BAND_FRACTION`
 * were deleted with it — do not reintroduce them.** The swipe first shipped as two
 * 18 %-wide strips laid over the slide, on the reasoning that the middle belonged to
 * pinch. A sibling `GestureDetector` swallows the touch whether or not its gesture
 * activates, so those strips ate every tap on the prev/next arrows, which sit at exactly
 * those edges. The swipe now lives inside `ZoomableImage`'s own composition, enabled as
 * the complement of its pan (`!zoomed`), so it arbitrates with pinch properly and works
 * across the whole slide.
 */
export const MIN_SWIPE_DISTANCE = 40;

export function swipeDirection(dx: number, dy: number): 'next' | 'prev' | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < MIN_SWIPE_DISTANCE) return null;
  if (Math.abs(dx) <= Math.abs(dy)) return null;
  // Swiping LEFT (negative dx) advances, matching every pager the rep already uses.
  return dx < 0 ? 'next' : 'prev';
}

/**
 * How long the fullscreen chrome stays up after a tap.
 *
 * ⚠️ Three seconds is the ticket's number, and it is short: the whole point is that a
 * customer sees the SLIDE, not the app. The countdown is re-armed by every interaction
 * rather than run once, so a rep working the controls never loses them mid-reach.
 */
export const CHROME_AUTO_HIDE_MS = 3000;
