const PALETTE: Record<string, string> = {
  primary: '#4CBB17',
  secondary: '#8E33FF',
  info: '#00B8D9',
  success: '#22C55E',
  warning: '#FFAB00',
  error: '#FF5630',
  grey: '#637381',
  gray: '#637381',
};

export function resolveSchemaColor(color?: string, fallback = '#637381'): string {
  if (!color) return fallback;
  const trimmed = String(color).trim();
  if (trimmed.startsWith('#')) return trimmed;
  const base = trimmed.includes('.') ? trimmed.split('.')[0] : trimmed;
  return PALETTE[base.toLowerCase()] || (base.startsWith('#') ? base : fallback);
}

export function softBg(hexColor: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hexColor) ? `${hexColor}1A` : '#F4F6F8';
}

const KEYWORD_ICONS: Array<[string, string]> = [
  ['home', 'home'],
  ['house', 'home'],
  ['roof', 'home'],
  ['leaf', 'leaf'],
  ['shield', 'shield-checkmark'],
  ['grid', 'grid'],
  ['floor', 'grid'],
  ['lightbulb', 'bulb'],
  ['bulb', 'bulb'],
  ['light', 'bulb'],
  ['hammer', 'hammer'],
  ['window', 'browsers-outline'],
  ['sofa', 'bed'],
  ['couch', 'bed'],
  ['border', 'layers'],
  ['layer', 'layers'],
  ['fascia', 'layers'],
  ['briefcase', 'briefcase'],
  ['case', 'briefcase'],
  ['settings', 'settings'],
  ['gear', 'settings'],
  ['cog', 'settings'],
  ['build', 'construct'],
  ['construct', 'construct'],
  ['wrench', 'construct'],
  ['tool', 'construct'],
  ['water', 'water'],
  ['drop', 'water'],
  ['flash', 'flash'],
  ['bolt', 'flash'],
  ['gift', 'gift'],
  ['card', 'card'],
  ['clipboard', 'clipboard'],
  ['receipt', 'receipt'],
  ['add', 'add-circle'],
  ['plus', 'add-circle'],
  ['shape', 'shapes'],
  ['star', 'star'],
  ['brush', 'brush'],
  ['paint', 'color-palette'],
];

export function iconifyToIonicons(icon?: string, fallback = 'pricetag'): string {
  if (!icon) return fallback;
  const raw = String(icon).toLowerCase();
  const name = (raw.includes(':') ? raw.split(':').pop() || raw : raw)
    .replace(/-(bold|duotone|outline|line|fill|solid|two-tone|twotone|o)\b/g, '')
    .trim();
  for (const [kw, ion] of KEYWORD_ICONS) {
    if (name.includes(kw)) return ion;
  }
  return fallback;
}

export type SchemaStyle = { color: string; icon: string; bg: string };

export function resolveSchemaStyle(
  entity: { icon?: string; color?: string } | undefined,
  fallback?: Partial<SchemaStyle>
): SchemaStyle {
  const color = entity?.color ? resolveSchemaColor(entity.color) : (fallback?.color || '#637381');
  const icon = entity?.icon ? iconifyToIonicons(entity.icon) : (fallback?.icon || 'pricetag');
  const bg = fallback?.bg && !entity?.color ? fallback.bg : softBg(color);
  return { color, icon, bg };
}

export const CATEGORY_STYLE_MAP: Record<string, SchemaStyle> = {
  gutters: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
  gutter: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
  leaffilter: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  'leaf filter': { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  leaf: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  soffit: { color: '#00B8D9', icon: 'build', bg: '#E0F8FB' },
  fascia: { color: '#8E33FF', icon: 'layers', bg: '#F2E8FF' },
  lighting: { color: '#FFAB00', icon: 'bulb', bg: '#FFF8E6' },
  additional: { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
  'additional services': { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
  miscellaneous: { color: '#637381', icon: 'ellipsis-horizontal-circle', bg: '#F4F6F8' },
};

export function styleForKey(name: string, color?: string): SchemaStyle {
  const found = CATEGORY_STYLE_MAP[(name || '').toLowerCase()];
  if (found) return found;
  const c = color || '#637381';
  return { color: c, icon: 'pricetag', bg: color ? `${c}1A` : '#F4F6F8' };
}

export function buildCategoryMeta(
  verticals: Array<{ categories?: Array<{ id: string; label?: string; name?: string; icon?: string; color?: string }> }> | undefined,
): Record<string, { label: string; style: SchemaStyle }> {
  const map: Record<string, { label: string; style: SchemaStyle }> = {};
  (verticals || []).forEach((v) => (v.categories || []).forEach((cat) => {
    const named = CATEGORY_STYLE_MAP[(cat.name || '').toLowerCase()] || CATEGORY_STYLE_MAP[(cat.label || '').toLowerCase()];
    map[cat.id] = { label: cat.label || cat.id, style: resolveSchemaStyle({ icon: cat.icon, color: cat.color }, named) };
  }));
  return map;
}
