import { Dimensions, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  if (Platform.OS !== 'android') return insets.bottom;
  return Math.max(insets.bottom, Math.round(Dimensions.get('screen').height - windowHeight));
}
