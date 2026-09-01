import { Platform } from 'react-native';

/**
 * Android-only typography nudge.
 *
 * The app ships ONE type family for both platforms (PublicSans, linked under
 * `android/app/src/main/assets/fonts`), and the declared `fontSize` is the same number
 * on both — so nothing here is a bug being fixed. Android simply lays the same face out
 * a touch tighter than iOS at a given size, and side by side the client reads the
 * Android build as the smaller of the two.
 *
 * `ANDROID_TEXT_SCALE` closes that optical gap. It is deliberately small: anything
 * larger starts wrapping the two-column Lead Center rows (phone beside email) on narrow
 * devices, which is a worse outcome than the size difference it was meant to fix.
 *
 * ⚠️ Apply this ONLY to text a client has actually compared across platforms — it is a
 * per-element correction, not a global scale, and the verdict genuinely differs by
 * surface. It was tried on the LEADS screen's search field and Today/Tomorrow tabs and
 * REJECTED there ("these tab in android looks a bit big as compare to ios"), so that
 * screen deliberately does not import this. Do not "finish the job" by applying it
 * app-wide; check each surface against a real side-by-side first.
 */
export const ANDROID_TEXT_SCALE = 1.06;

/**
 * A `fontSize` override for Android, or `null` on iOS.
 *
 * ⚠️ Use it as a style ARRAY entry — `style={[existing, androidTextStyle(16)]}` — never
 * as `style={{ fontSize: androidFontSize(16) }}`. A flattened `fontSize: undefined`
 * OVERRIDES the size the NativeWind class supplied, so the second form silently strips
 * `text-base` on iOS instead of leaving it alone. An array skips a null entry.
 *
 * @param base the size the element already renders at — `text-base` = 16, `text-lg` = 18.
 */
export const androidTextStyle = (base: number): { fontSize: number } | null =>
  Platform.OS === 'android'
    ? // Half-point steps: whole numbers alone round a 16 and an 18 by different
      // proportions, so a heading and the body under it drift apart.
      { fontSize: Math.round(base * ANDROID_TEXT_SCALE * 2) / 2 }
    : null;

export default androidTextStyle;
