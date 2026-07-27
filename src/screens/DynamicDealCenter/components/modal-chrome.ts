import { StyleSheet, ViewStyle } from 'react-native';

/**
 * Shared backdrop/card chrome for the dynamic deal center's centered modals.
 *
 * `blurType="light"` renders a near-WHITE frosted backdrop, and these cards are
 * `#fff` — with nothing between them the card edge disappears into the
 * background. The regular deal center's drop modal solves this with a stronger
 * blur + `shadow-2xl` on the card (`CalculatorSummary`); these values are that,
 * plus a scrim to dim the frost. Kept here so the three modals can't drift apart
 * again.
 */

/** Blur strength for the backdrop — matches the regular rollout's drop modal. */
export const MODAL_BLUR_AMOUNT = 10;

/** Dims the blurred backdrop so a white card has something to stand against.
 *  Render directly over the BlurView with `pointerEvents="none"` so
 *  tap-outside-to-close still reaches the Pressable underneath. */
export const MODAL_SCRIM: ViewStyle = {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0,0,0,0.25)',
};

/** Tailwind `shadow-2xl` equivalent — lifts the card off the backdrop. */
export const MODAL_CARD_SHADOW: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 25 },
  shadowOpacity: 0.25,
  shadowRadius: 25,
  elevation: 24,
};
