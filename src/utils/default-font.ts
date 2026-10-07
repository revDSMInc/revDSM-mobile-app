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

export function isPublicSansFace(family: unknown): boolean {
  return typeof family === 'string' && FACE_NAMES.has(family);
}

export function normalizeFontWeight(weight: unknown): number | null {
  if (weight === 'normal') return 400;
  if (weight === 'bold') return 700;
  const n = typeof weight === 'number' ? weight : typeof weight === 'string' ? Number(weight) : NaN;
  if (!Number.isFinite(n)) return null;
  const snapped = Math.round(n / 100) * 100;
  if (snapped < 100) return 100;
  if (snapped > 900) return 900;
  return snapped;
}

export function faceForWeight(weight: number | null | undefined): string {
  return PUBLIC_SANS_BY_WEIGHT[normalizeFontWeight(weight) ?? 400] || PUBLIC_SANS_BY_WEIGHT[400];
}

export interface FontPatch {
  readonly fontFamily: string;
  readonly fontWeight: 'normal';
}

const PATCH_BY_FACE: Readonly<Record<string, FontPatch>> = Object.freeze(
  Object.values(PUBLIC_SANS_BY_WEIGHT).reduce<Record<string, FontPatch>>((acc, face) => {
    acc[face] = Object.freeze({ fontFamily: face, fontWeight: 'normal' as const });
    return acc;
  }, {}),
);

export const ITALIC_REGULAR_FACE = 'PublicSans-Regular';
export const ITALIC_BOLD_FACE = 'PublicSans-Bold';

interface FlatTextStyle {
  fontFamily?: unknown;
  fontWeight?: unknown;
  fontStyle?: unknown;
}

export function resolveFontPatch(style: FlatTextStyle | null | undefined): FontPatch | null {
  const family = style?.fontFamily;

  if (family != null && family !== '' && !isPublicSansFace(family)) return null;

  const weight = normalizeFontWeight(style?.fontWeight);

  if (style?.fontStyle === 'italic') {
    const faceWeight = isPublicSansFace(family) ? weightOfFace(family as string) : null;
    const effective = faceWeight !== null && (weight === null || weight === 400) ? faceWeight : weight;
    return PATCH_BY_FACE[(effective ?? 400) >= 600 ? ITALIC_BOLD_FACE : ITALIC_REGULAR_FACE];
  }

  if (isPublicSansFace(family)) {
    if (weight === null || weight === 400) return null;
    return PATCH_BY_FACE[faceForWeight(weight)];
  }

  return PATCH_BY_FACE[faceForWeight(weight)];
}

export function weightOfFace(family: string): number | null {
  return WEIGHT_BY_FACE[family] ?? null;
}
