import type { KeyboardTypeOptions } from 'react-native';

export type NumPadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

export type NumPadMode = 'digits' | 'decimal';

const NUMERIC_TYPES: ReadonlySet<KeyboardTypeOptions> = new Set<KeyboardTypeOptions>([
  'number-pad',
  'numeric',
  'decimal-pad',
  'phone-pad',
  'numbers-and-punctuation',
]);

export function numPadModeFor(
  keyboardType: KeyboardTypeOptions | undefined,
  override?: NumPadMode | false,
): NumPadMode | null {
  if (override === false) return null;
  if (override) return override;
  if (!keyboardType || !NUMERIC_TYPES.has(keyboardType)) return null;
  return keyboardType === 'numeric' ||
    keyboardType === 'decimal-pad' ||
    keyboardType === 'numbers-and-punctuation'
    ? 'decimal'
    : 'digits';
}

export function applyNumPadKey(
  value: string,
  key: NumPadKey,
  mode: NumPadMode,
  maxLength?: number,
): string {
  const text = value ?? '';
  if (key === 'back') {
    if (mode === 'decimal') return text.slice(0, -1);
    const trimmed = text.replace(/\D+$/, '');
    return trimmed.slice(0, -1);
  }
  if (maxLength != null && text.length >= maxLength) return text;
  if (key === '.') {
    if (mode !== 'decimal' || text.includes('.')) return text;
    return text === '' ? '0.' : `${text}.`;
  }
  return text + key;
}

export const NUMPAD_GAP = 8;

export function numPadMetrics(windowHeight: number, insetBottom: number, _mode: NumPadMode, isIos: boolean) {
  // ⚠️ insets read 0 or stale inside a Modal - floor them for the home bar / gesture area.
  const bottomPad = Math.max(insetBottom, isIos ? 16 : 10);
  const keyHeight = Math.max(
    38,
    Math.min(56, Math.floor((windowHeight * 0.32 - bottomPad - NUMPAD_GAP * 5) / 4)),
  );
  // Both modes are 4 rows now (decimal is 4 columns wide instead of taller).
  const rows = 4;
  return { bottomPad, keyHeight, panelHeight: NUMPAD_GAP + rows * (keyHeight + NUMPAD_GAP) + bottomPad };
}

export function panShiftFor(
  inputBottom: number,
  padTop: number,
  panelHeight: number,
  margin = 20,
): number {
  const need = inputBottom + margin - padTop;
  if (!(need > 0)) return 0;
  return Math.min(Math.ceil(need), panelHeight);
}
