/**
 * The app's default typeface, resolved for a single text style.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────
 * Public Sans is the design system's font and all nine faces are bundled and linked
 * on both platforms (`src/assets/fonts`, `react-native.config.js`). But a `<Text>`
 * only gets it when something NAMES a face: the NativeWind `font-*` classes do
 * (`tailwind.config.js` maps every one of them to a `PublicSans-*` file), and the
 * ~850 inline `style={{ fontWeight: '700' }}` sites in this repo do NOT. With no
 * `fontFamily`, each platform falls back to its own system font — Roboto (or
 * whatever the user picked in Android's font setting) and San Francisco — which is
 * the reported bug: "some of the fonts on android are the android default font".
 *
 * ⚠️ On Android a *named* face is not enough either. `ReactFontManager` resolves a
 * family + weight by looking for the FILE `fonts/<family><variant>.ttf`
 * (`createAssetTypeface`), so `PublicSans-Regular` + `fontWeight: '700'` looks for
 * `PublicSans-Regular_bold.ttf`, does not find it, and falls through to
 * `Typeface.create("PublicSans-Regular", BOLD)` — an unknown family, so Android
 * hands back the SYSTEM font, synthetically bolded. Silent, and it looks exactly
 * like the missing-font bug. The fix for both is the same: pick the face that
 * already carries the weight and stop asking the platform to bolden it.
 *
 * So every patch this module returns is a PAIR — the face, plus `fontWeight:
 * 'normal'`:
 *   • Android → `nearestStyle` is NORMAL, so `fonts/PublicSans-Bold.ttf` is loaded.
 *   • iOS     → `RCTFontUtils` reads the name, recovers its real family, and then
 *     `fontWeight = (fontWeight != 0.0) ?: RCTGetFontWeight(font)`. `normal` IS
 *     `UIFontWeightRegular`, which is literally `0.0`, so the named face's own
 *     weight wins. This is the same pair `tailwind.config.js` already emits (every
 *     `fontWeight` value there is remapped to `'normal'`), so it is the combination
 *     the app has always shipped — just applied to the styles that had none.
 */

/** The nine bundled faces, by CSS weight. */
export const PUBLIC_SANS_BY_WEIGHT: Readonly<Record<number, string>> = Object.freeze({
  100: 'PublicSans-Thin',
  200: 'PublicSans-ExtraLight',
  300: 'PublicSans-Light',
  400: 'PublicSans-Regular',
  500: 'PublicSans-Medium',
  600: 'PublicSans-SemiBold',
  700: 'PublicSans-Bold',
  800: 'PublicSans-ExtraBold',
  900: 'PublicSans-Black',
});

const FACE_NAMES: ReadonlySet<string> = new Set(Object.values(PUBLIC_SANS_BY_WEIGHT));

const WEIGHT_BY_FACE: Readonly<Record<string, number>> = Object.freeze(
  Object.entries(PUBLIC_SANS_BY_WEIGHT).reduce<Record<string, number>>((acc, [w, face]) => {
    acc[face] = Number(w);
    return acc;
  }, {}),
);

/** Is this one of OUR faces (as opposed to an icon font, or any other custom font)? */
export function isPublicSansFace(family: unknown): boolean {
  return typeof family === 'string' && FACE_NAMES.has(family);
}

/**
 * A style's `fontWeight` as a number, or `null` when it does not name one.
 *
 * `'normal'`/`'bold'` are the two keywords react-native accepts beside the numeric
 * steps; anything else (including `'lighter'`, which RN does not support) reads as
 * "no opinion" rather than being guessed at.
 */
export function normalizeFontWeight(weight: unknown): number | null {
  if (weight === 'normal') return 400;
  if (weight === 'bold') return 700;
  const n = typeof weight === 'number' ? weight : typeof weight === 'string' ? Number(weight) : NaN;
  if (!Number.isFinite(n)) return null;
  // Snap to the nearest bundled step so an unusual value (450, 1000) still lands on
  // a real file instead of falling through to the system font.
  const snapped = Math.round(n / 100) * 100;
  if (snapped < 100) return 100;
  if (snapped > 900) return 900;
  return snapped;
}

/** The face that already carries this weight. */
export function faceForWeight(weight: number | null | undefined): string {
  return PUBLIC_SANS_BY_WEIGHT[normalizeFontWeight(weight) ?? 400] || PUBLIC_SANS_BY_WEIGHT[400];
}

export interface FontPatch {
  readonly fontFamily: string;
  readonly fontWeight: 'normal';
}

// One frozen object per face, so a patch is a stable reference across renders and
// react-native's style diffing sees no change when nothing changed.
const PATCH_BY_FACE: Readonly<Record<string, FontPatch>> = Object.freeze(
  Object.values(PUBLIC_SANS_BY_WEIGHT).reduce<Record<string, FontPatch>>((acc, face) => {
    acc[face] = Object.freeze({ fontFamily: face, fontWeight: 'normal' as const });
    return acc;
  }, {}),
);

interface FlatTextStyle {
  fontFamily?: unknown;
  fontWeight?: unknown;
  fontStyle?: unknown;
}

/**
 * The `{ fontFamily, fontWeight }` to append to a text style, or `null` to leave it
 * exactly as the author wrote it.
 *
 * ⚠️ A font that is NOT one of ours is never touched — that is what keeps
 * `react-native-vector-icons` working, since every icon is a `<Text>` whose
 * `fontFamily` is `Ionicons` / `MaterialCommunityIcons` / … Rewriting those to
 * Public Sans would replace every icon in the app with a missing glyph.
 *
 * ⚠️ ITALIC is left alone. No italic face is bundled, so naming a family would ask
 * Android for `PublicSans-Regular_italic.ttf` (missing → the system font again) and
 * would leave iOS with an upright face, silently dropping the slant it renders
 * today. Eleven sites use it; they keep the system italic they already have.
 *
 * ⚠️ When a Public Sans face is ALREADY named, an explicit `'normal'` / `400` does
 * NOT re-derive the face. That value is not usually an author's opinion: Tailwind
 * emits it mechanically beside every `font-*` family class (see the `fontWeight`
 * block in `tailwind.config.js`), so honouring it would turn every `font-bold` in
 * the app back into a regular face. A heavier explicit weight DOES win, because
 * that is a real instruction — and it is also the Android trap above, where
 * `font-sans` + `fontWeight: '700'` currently renders in the system font.
 */
export function resolveFontPatch(style: FlatTextStyle | null | undefined): FontPatch | null {
  const family = style?.fontFamily;

  // Some other font — an icon set, or a face this app does not ship. Hands off.
  if (family != null && family !== '' && !isPublicSansFace(family)) return null;
  if (style?.fontStyle === 'italic') return null;

  const weight = normalizeFontWeight(style?.fontWeight);

  if (isPublicSansFace(family)) {
    // Already ours, and nothing asks for a different weight.
    if (weight === null || weight === 400) return null;
    // The face the requested weight names — which is what iOS resolves for this pair
    // today, so this makes Android agree rather than changing the design. It is
    // returned even when it re-states the family already there, because the point of
    // the pair is to drop the numeric weight Android chokes on.
    return PATCH_BY_FACE[faceForWeight(weight)];
  }

  return PATCH_BY_FACE[faceForWeight(weight)];
}

/** The weight a bundled face carries, for tests and diagnostics. */
export function weightOfFace(family: string): number | null {
  return WEIGHT_BY_FACE[family] ?? null;
}
