// Colours for the annotation pen (REVUIUX-589). The pen panel shows six quick colours; its palette button opens this fuller grid.
// Pure on purpose (HSL -> hex), so the grid is deterministic and testable.

export const QUICK_COLORS = ['#FF7043', '#4CBB17', '#42A5F5', '#FFB74D', '#FFFFFF', '#000000'];

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** h 0..360, s / l 0..1 -> '#RRGGBB' (uppercase). */
export const hslToHex = (h: number, s: number, l: number): string => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${hex2(f(0) * 255)}${hex2(f(8) * 255)}${hex2(f(4) * 255)}`.toUpperCase();
};

export const GRID_COLUMNS = 8;
const HUES = [0, 25, 45, 60, 120, 175, 210, 270];

/** Rows of the full palette: greys, then bright / light / dark versions of 8 hues. */
export const paletteGrid = (): string[][] => [
  [0, 1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7, 1].map((l) => hslToHex(0, 0, 1 - l)), // white -> black
  HUES.map((h) => hslToHex(h, 0.85, 0.5)),
  HUES.map((h) => hslToHex(h, 0.85, 0.72)),
  HUES.map((h) => hslToHex(h, 0.7, 0.32)),
];

export const sameColor = (a?: string | null, b?: string | null): boolean => !!a && !!b && a.toUpperCase() === b.toUpperCase();

export const isQuickColor = (c?: string | null): boolean => QUICK_COLORS.some((q) => sameColor(q, c));

/**
 * A colour picked from the full grid takes the place of the ACTIVE swatch in the quick row, and is then the active colour - the palette button
 * itself never changes. If the picked colour is already in the row it is just selected; if the active colour is not in the row (a note or a
 * shape that came with some other colour), the last swatch is replaced.
 */
export const replaceQuickColor = (row: string[], active: string | null | undefined, picked: string): string[] => {
  if (row.some((c) => sameColor(c, picked))) return row;
  const at = row.findIndex((c) => sameColor(c, active));
  const i = at >= 0 ? at : row.length - 1;
  return row.map((c, idx) => (idx === i ? picked.toUpperCase() : c));
};
