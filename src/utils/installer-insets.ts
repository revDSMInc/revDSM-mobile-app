/**
 * Edge padding for the installer's full-screen sub-flows.
 *
 * Every one of them is a `Modal`, and that is the whole reason this file exists. A Modal
 * renders into its own host view, outside the `SafeAreaProvider`'s native hierarchy, so
 * `useSafeAreaInsets()` inside one returns the ROOT window's insets rather than the
 * modal window's. Those two agree most of the time and then stop agreeing exactly when
 * something re-declares the status bar — mounting and dismissing the camera over a step
 * is enough — and the raw inset alone is not a layout that survives that.
 *
 * Both helpers below therefore treat the inset as a MINIMUM to clear, never as the whole
 * measurement.
 */

import { Platform, StatusBar } from 'react-native';

/**
 * The status bar's real height, measured by the platform.
 *
 * These sub-flows declare `statusBarTranslucent`, so on Android their window starts at
 * the very top of the screen and the status bar is painted OVER the first ~24–30 dp of
 * it. `insets.top` is supposed to describe exactly that overlap, and inside a Modal it
 * comes back **0** — so every padding derived from it was measured from the top of the
 * screen rather than from the bottom of the bar, and the first 30 dp of it was simply
 * hidden underneath the clock.
 *
 * That is what a fixed floor could not fix, and why raising it twice barely moved the
 * header: at 40 dp of padding under a 30 dp bar, only 10 dp was ever visible.
 * `StatusBar.currentHeight` is the number the inset was failing to report.
 */
const ANDROID_STATUS_BAR =
  // The `?? 24` is for the window that hasn't measured yet — the platform default,
  // never 0, because 0 is the value that caused this bug.
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 0;

/** Visible space between the bottom of the status bar and the header, in dp. */
export const HEADER_TOP_GAP = 20;

/**
 * Top padding for a sub-screen shell: clear of the status bar, plus a real gap below it.
 *
 * iOS is untouched — a notch inset (59) is bigger than the whole Android term, so the
 * `Math.max` keeps it, and it already positions content below the notch on its own.
 */
export const headerTopPadding = (insetTop: number) =>
  Math.max(insetTop, ANDROID_STATUS_BAR + HEADER_TOP_GAP);

/**
 * Breathing room under a footer row (Retake / Use Photo, the shutter), in dp —
 * **added to the safe-area inset, not maxed against it**.
 *
 * The inset alone only guarantees the buttons are not *covered* by the system bar; it
 * puts them flush against its edge, which is what made them read as stuck to the bottom
 * of the screen. On these screens the inset is the full nav-bar height (48 dp with
 * Android's 3-button bar), so a `Math.max(insets.bottom, n)` floor was dead code for any
 * n below that — the padding was already 48 and the buttons still touched the bar. Only
 * adding on top of the inset produces a visible gap on every device.
 *
 * The inner `Math.max` covers a window that reports no inset at all: 16 alone would be
 * tighter there than what these screens had before.
 */
export const FOOTER_BOTTOM_GAP = 16;

/** Padding under a footer row: clear of the system bar, plus room to breathe. */
export const footerBottomPadding = (insetBottom: number) =>
  Math.max(insetBottom, FOOTER_BOTTOM_GAP) + FOOTER_BOTTOM_GAP;
