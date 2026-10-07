import { Platform, StatusBar } from 'react-native';

const ANDROID_STATUS_BAR =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 0;

export const HEADER_TOP_GAP = 20;

export const headerTopPadding = (insetTop: number) =>
  Math.max(insetTop, ANDROID_STATUS_BAR + HEADER_TOP_GAP);

export const FOOTER_BOTTOM_GAP = 16;

export const EDGE_TO_EDGE_MODAL = {
  statusBarTranslucent: true,
  navigationBarTranslucent: true,
} as const;

export const footerBottomPadding = (insetBottom: number) =>
  Math.max(insetBottom, FOOTER_BOTTOM_GAP) + FOOTER_BOTTOM_GAP;
