import { LookPattern } from './types';

export const MIN_GLOW_CHANNEL = 40;

export const MAX_CUSTOM_COLORS = 6;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(String(value).trim());
}

export function expandHex(hex: string): string {
  const v = String(hex).trim();
  if (v.length !== 4) return v.toUpperCase();
  return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toUpperCase();
}

export function brightestChannel(hex: string): number {
  const v = expandHex(hex);
  if (!isHexColor(v)) return 0;
  return Math.max(
    parseInt(v.slice(1, 3), 16),
    parseInt(v.slice(3, 5), 16),
    parseInt(v.slice(5, 7), 16),
  );
}

export function canGlow(hex: string): boolean {
  return brightestChannel(hex) >= MIN_GLOW_CHANNEL;
}

export function dropUnglowableColors(colors: string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const c of colors) {
    (canGlow(c) ? kept : dropped).push(expandHex(c));
  }
  return { kept, dropped };
}

export function puckColors(colors: string[], pattern: LookPattern, count: number): string[] {
  const palette = colors.length ? colors : ['#4A5677'];
  if (pattern === 'single' || palette.length === 1) {
    return Array.from({ length: count }, () => palette[0]);
  }
  return Array.from({ length: count }, (_, i) => palette[i % palette.length]);
}

export function patternFor(colors: string[]): LookPattern {
  return colors.length === 1 ? 'single' : 'alternating';
}

export function clamp01(value: number, fallback = 0): number {
  if (Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hue = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
  s = clamp01(s);
  v = clamp01(v);
  h = hue;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60);
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  if (!isHexColor(hex)) return { h: 0, s: 0, v: 1 };
  const v6 = expandHex(hex);
  const r = parseInt(v6.slice(1, 3), 16) / 255;
  const g = parseInt(v6.slice(3, 5), 16) / 255;
  const b = parseInt(v6.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
