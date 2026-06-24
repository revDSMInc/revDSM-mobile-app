import { NativeModules, Platform } from 'react-native';

const { AutofillHelper } = NativeModules;

export const commitAutofill = () => {
  if (Platform.OS === 'android' && AutofillHelper && typeof AutofillHelper.commit === 'function') {
    try {
      AutofillHelper.commit();
    } catch (e) {
      console.warn('[AutofillHelper] commit failed', e);
    }
  }
};

export const cancelAutofill = () => {
  if (Platform.OS === 'android' && AutofillHelper && typeof AutofillHelper.cancel === 'function') {
    try {
      AutofillHelper.cancel();
    } catch (e) {
      console.warn('[AutofillHelper] cancel failed', e);
    }
  }
};
