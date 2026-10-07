import { Platform } from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';

const IS_IPAD = Platform.OS === 'ios' && Platform.isPad;

export const NUMERIC_KEYBOARD: KeyboardTypeOptions = IS_IPAD
  ? 'numbers-and-punctuation'
  : 'numeric';

export const NUMBER_PAD_KEYBOARD: KeyboardTypeOptions = IS_IPAD
  ? 'numbers-and-punctuation'
  : 'number-pad';

export const NUMERIC_KEYBOARD_HAS_RETURN_KEY = IS_IPAD || Platform.OS === 'android';
