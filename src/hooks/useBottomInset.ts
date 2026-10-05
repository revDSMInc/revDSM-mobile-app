import { Dimensions, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The bottom edge a full-screen `Modal` must keep clear of.
 *
 * ⚠️ A `statusBarTranslucent` Modal draws UNDER Android's navigation bar while the app-level
 * `useSafeAreaInsets().bottom` can still read 0, so bottom-anchored content (a thumbnail strip,
 * a toolbar) ended up behind the three-button bar. The screen-minus-window height is the bar's
 * real height there (0 once the window already is edge-to-edge, where the inset is right
 * instead), so take the larger. iOS just uses the inset (home indicator).
 */
export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  if (Platform.OS !== 'android') return insets.bottom;
  return Math.max(insets.bottom, Math.round(Dimensions.get('screen').height - windowHeight));
}
