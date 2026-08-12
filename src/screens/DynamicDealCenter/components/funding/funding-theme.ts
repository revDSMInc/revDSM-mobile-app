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