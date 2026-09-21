/**
 * The maths behind pinch-to-zoom, kept apart from the component that runs it.
 *
 * WHY ITS OWN FILE: `widgets/common/ZoomableImage` is a react-native + reanimated
 * component and cannot be loaded under jest here, and these five expressions are the
 * whole of what can be silently wrong — an anchor that drifts, or a bound that lets a
 * zoomed slide be flung off screen, both look like "the zoom feels broken" and neither
 * throws. Same reasoning as `utils/addendum-drafts.ts` and `utils/inspection-photos.ts`.
 *
 * ⚠️ Every export carries the `'worklet'` directive so the gesture callbacks can call it
 * on the UI thread. They remain ordinary functions on the JS thread, which is what keeps
 * them testable.
 *
 * COORDINATE SYSTEM: offsets are measured in SCREEN pixels from the CENTRE of the image
 * box, which is how react-native's `transform: [translateX, translateY, scale]` composes —
 * the content is scaled about its own centre first, then translated in parent units. A
 * point sitting `origin` from the centre of the unscaled image therefore lands at
 * `origin * scale + translate`.
 */

/** Never below 1x — zooming out past fit has no meaning for a slide that already fits. */
export const clampZoomScale = (next: number, maxScale: number): number => {
  'worklet';
  return Math.min(Math.max(next, 1), maxScale);
};

/**
 * How far the image may be dragged from centre before its own edge would come inside the
 * box. Zero at 1x, which is what re-centres the image when the rep pinches all the way out.
 */
export const panBound = (boxSize: number, scale: number): number => {
  'worklet';
  return (boxSize * (Math.max(scale, 1) - 1)) / 2;
};

/**
 * The point of the IMAGE that currently sits under `focal`, in unscaled image units.
 * Captured once when a pinch starts; holding it still is what makes the gesture feel
 * anchored to the fingers rather than to the centre of the slide.
 */
export const zoomOrigin = (focal: number, translate: number, scale: number): number => {
  'worklet';
  return (focal - translate) / (scale || 1);
};

/**
 * Where to translate so `origin` stays under `focal` at the new scale, clamped into the
 * box. Solves `origin * scale + translate = focal`.
 */
export const anchoredTranslate = (
  focal: number,
  origin: number,
  scale: number,
  boxSize: number,
): number => {
  'worklet';
  const bound = panBound(boxSize, scale);
  return Math.min(Math.max(focal - origin * scale, -bound), bound);
};

/**
 * Translation for a double-tap zoom toward the tapped point. At 1x the image-space origin
 * IS the tap offset, so this is `anchoredTranslate` with `origin === focal`.
 */
export const doubleTapTranslate = (focal: number, scale: number, boxSize: number): number => {
  'worklet';
  return anchoredTranslate(focal, focal, scale, boxSize);
};

/** Drag while zoomed: follow the finger, but never past the image's own edge. */
export const clampPan = (
  savedTranslate: number,
  delta: number,
  scale: number,
  boxSize: number,
): number => {
  'worklet';
  const bound = panBound(boxSize, scale);
  return Math.min(Math.max(savedTranslate + delta, -bound), bound);
};

/**
 * How far a finger may travel, in points, and still count as a TAP.
 *
 * ⚠️ RNGH's `Gesture.Tap()` has NO movement limit unless one is set, on either platform
 * (`_maxDistSq = NAN` in `RNTapHandler.m`, `MAX_VALUE_IGNORE` in `TapGestureHandler.kt`).
 * `ZoomableImage` composes its taps `Simultaneous` with the paging swipe, so the swipe
 * activating does NOT cancel them — a quick swipe lifted inside the tap's 500 ms window
 * also ENDED AS A SUCCESSFUL SINGLE TAP. The pitch book's single tap toggles the
 * presentation chrome, so every swipe brought the dock back.
 *
 * Must stay BELOW `SWIPE_ACTIVATE_DISTANCE`, so one touch can never be both a tap and a
 * swipe: up to 10 pt it is a tap, past 15 pt a swipe, and in between it is neither.
 *
 * Plain numbers rather than worklets: they are read once, when the gestures are built.
 */
export const TAP_MAX_DISTANCE = 10;

/** Horizontal travel, in points, before the paging swipe activates (its `activeOffsetX`). */
export const SWIPE_ACTIVATE_DISTANCE = 15;
