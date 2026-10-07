import { Platform } from 'react-native';

export const ANDROID_TEXT_SCALE = 1.06;

export const androidTextStyle = (base: number): { fontSize: number } | null =>
  Platform.OS === 'android'
    ? // Half-point steps: whole numbers alone round a 16 and an 18 by different
      { fontSize: Math.round(base * ANDROID_TEXT_SCALE * 2) / 2 }
    : null;

export default androidTextStyle;
