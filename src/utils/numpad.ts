import type { KeyboardTypeOptions } from 'react-native';

export type NumPadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

/** `digits` = whole numbers (no dot key); `decimal` = prices / footages. */
export type NumPadMode = 'digits' | 'decimal';

const NUMERIC_TYPES: ReadonlySet<KeyboardTypeOptions> = new Set<KeyboardTypeOptions>([
  'number-pad',
  'numeric',
  'decimal-pad',
  'phone-pad',
  // Legacy iPad value (it has a dot): kept so a literal one still gets the pad.
  'numbers-and-punctuation',
]);

/**
 * Which in-app pad a field wants, decided from the keyboard type it already declares:
 * `null` = it needs the normal full keyboard (text, email, url...).
 * `NUMERIC_KEYBOARD` / `NUMBER_PAD_KEYBOARD` stay distinct on every platform now, so decimal vs
 * whole-number needs no override (`numPad` still forces one).
 */
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

/**
 * The next text value after one pad key press. Always edits at the END of the text:
 * several fields reformat as they go (the phone's `+1 (XXX) XXX-XXXX`), which makes a
 * mid-string caret meaningless after the first keystroke.
 *
 * ⚠️ Backspace in `digits` mode also eats trailing punctuation: `+1 (123) ` would otherwise
 * be re-formatted straight back to itself and the key would appear dead.
 */
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

/**
 * The pad's size, derived (not measured) so the host can place it and pan content before it
 * has rendered: 4 key rows must fit in ~32% of the window (small phones, landscape) but never
 * grow past a comfortable thumb target. Decimal fields get a 5th row (Done on its own row).
 */
export function numPadMetrics(windowHeight: number, insetBottom: number, mode: NumPadMode, isIos: boolean) {
  // ⚠️ insets read 0 or stale inside a Modal - floor them for the home bar / gesture area.
  const bottomPad = Math.max(insetBottom, isIos ? 16 : 10);
  const keyHeight = Math.max(
    38,
    Math.min(56, Math.floor((windowHeight * 0.32 - bottomPad - NUMPAD_GAP * 5) / 4)),
  );
  const rows = mode === 'decimal' ? 5 : 4;
  return { bottomPad, keyHeight, panelHeight: NUMPAD_GAP + rows * (keyHeight + NUMPAD_GAP) + bottomPad };
}

/**
 * How far the host's content must slide UP so the focused field's bottom edge clears the pad.
 * All inputs are in the SAME coordinate space (window y, measured with no pan applied).
 * 0 when the field is already clear; capped at the pad height so a field can never be pushed
 * further than the pad itself.
 */
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
