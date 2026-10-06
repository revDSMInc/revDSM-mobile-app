import type { KeyboardTypeOptions } from 'react-native';

/**
 * Which keyboard type a numeric TextInput declares - the in-app pad is chosen from it (utils/numpad.ts).
 *
 * ⚠️ HISTORY: iPad used to get `numbers-and-punctuation` here to dodge iPadOS's floating key
 * palette (see docs/claude/app-wide.md, "iPad: numeric fields get a DOCKED keyboard"). Numeric
 * fields now use the in-app number pad (`widgets/common/keyboard/NumPad`) and the system
 * keyboard never appears for them, so the type only has to say "whole number" vs "decimal" -
 * which is exactly what the pad reads. Do not reintroduce a platform split here.
 */

/** For fields that accept decimals (prices, footages): the pad gets a `.` key. */
export const NUMERIC_KEYBOARD: KeyboardTypeOptions = 'numeric';

/** For whole-number fields: digits only. */
export const NUMBER_PAD_KEYBOARD: KeyboardTypeOptions = 'number-pad';

/**
 * True when the numeric keyboard being shown HAS a return key.
 *
 * ⚠️ Now ALWAYS true: numeric fields use the in-app pad (`widgets/common/keyboard/NumPad`),
 * whose ✓ key fires `onSubmitEditing` and then blurs on every platform. Running an `onBlur`
 * commit as well would therefore commit TWICE per tap - read this before adding any
 * blur-as-submit workaround to a numeric field.
 */
export const NUMERIC_KEYBOARD_HAS_RETURN_KEY = true;
