import { NativeModules, Platform } from 'react-native';

const { HapticFeedback } = NativeModules;

export const triggerHaptic = (type: 'success' | 'error' | 'light' | 'threshold') => {
  if (HapticFeedback && typeof HapticFeedback.trigger === 'function') {
    try {
      HapticFeedback.trigger(type);
    } catch (e) {
      console.warn('[HapticFeedback] Trigger failed', e);
    }
  }
};

export const prepareHaptic = (type: 'notification' | 'impact') => {
  if (Platform.OS === 'ios' && HapticFeedback && typeof HapticFeedback.prepare === 'function') {
    try {
      HapticFeedback.prepare(type);
    } catch (e) {
      console.warn('[HapticFeedback] Prepare failed', e);
    }
  }
};

export const triggerSuccess = () => triggerHaptic('success');
export const triggerFailure = () => triggerHaptic('error');
export const triggerLightTap = () => triggerHaptic('light');
export const triggerThresholdCrossing = () => triggerHaptic('threshold');
