import { Platform } from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';

/**
 * Which numeric keyboard a TextInput should ask for.
 *
 * ⚠️ WHY THIS EXISTS: iPadOS renders every "pad" keyboard type — `number-pad`,
 * `decimal-pad`, and `numeric` (which react-native maps to `UIKeyboardTypeDecimalPad`
 * on iOS) — as a small FLOATING key palette anchored beside the field, with the
 * phone-keypad `2 ABC / 3 DEF` lettering. On the Deal Center calculator that palette
 * lands on top of the rows the rep is filling in, and it cannot be docked: the floating
 * presentation is Apple's, chosen from the keyboard type alone, and no prop moves it.
 *
 * A NON-pad type is rendered as the ordinary full-width keyboard docked at the bottom
 * of the screen, which is what the ticket asked for, so iPad asks for
 * `numbers-and-punctuation` instead.
 *
 * ⚠️ It is a FULL keyboard, so it carries a letters key. That is safe here only because
 * every consumer already strips non-numerics in `onChangeText` (or parses with
 * `parseFloat`) — do not point these at a field that stores raw text.
 *
 * iPhone and Android are deliberately untouched: the compact pad is the right control on
 * a phone, and Android has no floating-palette behaviour to work around.
 */
const IS_IPAD = Platform.OS === 'ios' && Platform.isPad;

/** For fields that accept decimals (prices, footages). Phone/Android: `numeric`. */
export const NUMERIC_KEYBOARD: KeyboardTypeOptions = IS_IPAD
  ? 'numbers-and-punctuation'
  : 'numeric';

/** For whole-number fields. Phone/Android: `number-pad`. */
export const NUMBER_PAD_KEYBOARD: KeyboardTypeOptions = IS_IPAD
  ? 'numbers-and-punctuation'
  : 'number-pad';

/**
 * True when the numeric keyboard being shown HAS a return key.
 *
 * ⚠️ Read this before adding an `onBlur` commit as a stand-in for `onSubmitEditing`:
 * a pad type has no return key (so `onSubmitEditing` never fires and blur is the only
 * commit), but the iPad keyboard above does — and running both would commit twice.
 */
export const NUMERIC_KEYBOARD_HAS_RETURN_KEY = IS_IPAD || Platform.OS === 'android';
