/**
 * funding-theme.ts — the palette the Funding step and the multi-method pricing
 * rows share.
 *
 * These screens are inline-styled (like the rest of the Dynamic Deal Center) and
 * the same six semantic colours recur across five components; naming them here is
 * what stops "the amber warning" from being three slightly different ambers.
 * Values are the mockup's CSS custom properties, except `GREEN`, which is the
 * app's existing primary rather than the mockup's `#4ec52f` so the Result Lead
 * header and the funding controls agree.
 */

export const FUND = {
  /** App primary — matches the Result Lead sheet header. */
  GREEN: '#4CBB17',
  GREEN_TEXT: '#2F7D1C',
  GREEN_BG: '#DCF6E2',
  GREEN_BORDER: '#B6E3A4',
  GREEN_CARD_BG: '#F6FCF3',

  AMBER: '#E8961E',
  AMBER_TEXT: '#8A5B0C',
  AMBER_BG: '#FDF3E2',
  AMBER_BORDER: '#F0D09A',
  AMBER_CARD_BG: '#FFFDF8',

  RED: '#D4483B',
  RED_TEXT: '#992D22',
  RED_BG: '#FDEEEC',
  RED_BORDER: '#F0B8B1',
  RED_CARD_BG: '#FFFBFA',

  TEXT: '#111418',
  SUBTEXT: '#5B626C',
  MUTED: '#9AA1AB',
  FAINT: '#B6BCC4',

  BORDER: '#E6E8EC',
  FILL: '#F4F5F7',
  /** The recessed "Pricing" / "Contract Total" panel. */
  PANEL: '#EEF3EF',
  PANEL_LINE: '#DDE5DF',
  PANEL_LABEL: '#6D7A70',

  /** Dashed connector / dot for a step that is never a rep action. */
  LOCKED_LINE: '#D3D8DE',

  LAV_TEXT: '#6B4ECF',
  LAV_PILL: '#E7DFFB',
} as const;

/**
 * The app's typeface, for a screen that is inline-styled.
 *
 * ⚠️ **The weight lives in the FAMILY, not in `fontWeight`.** These screens used
 * numeric weights with no family, so every line rendered in the SYSTEM font while
 * the rest of the app rendered in Public Sans — the exact defect already recorded
 * at `screens/Installer/JobDetail.tsx` (*"half the block rendered in the SYSTEM
 * font while sales rendered in Public Sans"*). NativeWind screens get this for free
 * from `tailwind.config.js`, which maps `font-bold` → `PublicSans-Bold` **and**
 * forces `fontWeight` to `normal`; there is no class here to do it, so the family is
 * named directly.
 *
 * ⚠️ Do NOT pair one of these with a numeric `fontWeight`. The face is already the
 * weight, so iOS synthesises bold on top of a bold face and Android can fail the
 * lookup and drop back to the system font — which is the bug this replaces. That is
 * why the tailwind config zeroes the weight for every named class.
 */
export const PS = {
  regular: 'PublicSans-Regular',
  medium: 'PublicSans-Medium',
  semibold: 'PublicSans-SemiBold',
  bold: 'PublicSans-Bold',
  extrabold: 'PublicSans-ExtraBold',
  black: 'PublicSans-Black',
} as const;

/**
 * The type scale for the Result Lead sheet and the funding screen.
 *
 * The screen had grown **eighteen** distinct sizes (9, 9.5, 10, 10.5, 11, 11.5, 12,
 * 12.5, 13, 13.5, 14, 14.5, 15.5, 16, 18, 19, 22, 24, 34) with no relationship
 * between them, which is what made it read as crowded rather than dense — the eye
 * gets no hierarchy out of a half-point difference.
 *
 * ⚠️ `MICRO` is the floor at 9 and is deliberately NOT reduced further: it is only
 * ever used for letter-spaced uppercase eyebrows, which stay legible small, and
 * anything below this stops being readable on a phone at arm's length.
 *
 * ⚠️ Public Sans has a taller x-height than the system faces this screen was
 * accidentally rendering in, so it reads slightly LARGER at the same point size.
 * The two changes were made together for that reason — swapping the family without
 * the reduction would have made the screen tighter, not looser.
 */
export const FS = {
  /** Letter-spaced uppercase eyebrows only. */
  MICRO: 9,
  /** Chips, badges, step labels, captions under a control. */
  TINY: 10,
  /** Secondary and help text. */
  SMALL: 11,
  /** Default body — labels, list rows, most of the screen. */
  BODY: 12,
  /** Emphasised body: control labels, button text. */
  BODY_LG: 13,
  /** Row amounts and text inputs — the numbers a rep checks against a contract. */
  LEAD: 14,
  /** Card and sheet headings. */
  TITLE: 16,
  /** The one big number on a screen. */
  DISPLAY: 20,
  /** Emoji only, where the glyph IS the graphic and the face never applies. */
  EMOJI: 30,
} as const;
