import { StyleSheet, ViewStyle } from 'react-native';

export const MODAL_BLUR_AMOUNT = 10;

export const MODAL_SCRIM: ViewStyle = {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0,0,0,0.25)',
};

export const MODAL_CARD_SHADOW: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 25 },
  shadowOpacity: 0.25,
  shadowRadius: 25,
  elevation: 24,
};
