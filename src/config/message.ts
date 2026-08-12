import { showMessage, MessageType } from 'react-native-flash-message';
import { Platform, StatusBar } from 'react-native';
import { triggerSuccess, triggerFailure } from '../utils/haptics';

/**
 * Standardized Flash Message Wrapper
 * Simplifies and centralizes application focal notifications
 */
export const FlashMessage = {
  /**
   * General-purpose notification
   */
  show: (title: string, description: string = '', type: MessageType = 'info') => {
    showMessage({
      message: title,
      description: description,
      type: type,
      icon: type as any,
      duration: 3000,
      floating: true,
      statusBarHeight: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : undefined,
      // ⚠️ `backgroundColor` is SPREAD IN only for danger — never written as
      // `backgroundColor: type === 'danger' ? '#D32F2F' : undefined`.
      //
      // react-native-flash-message resolves the type colour into its style array
      // and then applies OUR `style` last (`FlashMessage.js` ~line 224), and RN's
      // style flatten lets a present-but-`undefined` key win over an earlier
      // value. So an explicit `undefined` here wiped `ColorTheme[type]` and the
      // banner rendered TRANSPARENT — white text straight onto whatever was
      // behind it, which on the Lead Center is the dark green MainHeader.
      // `success`/`warning`/`info`/`error` never hit this because they don't set
      // the key at all (or set a real value).
      style: {
        zIndex: 9999,
        elevation: 9999,
        ...(type === 'danger' ? { backgroundColor: '#D32F2F' } : null),
      },
      hideStatusBar: false,
    });
  },

  /**
   * Success notification - Professional green background
   */
  success: (title: string, description: string = '') => {
    triggerSuccess();
    showMessage({
      message: title,
      description: description,
      type: 'success',
      icon: 'success',
      duration: 3000,
      floating: true,
      statusBarHeight: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : undefined,
      style: { zIndex: 9999, elevation: 9999 },
      hideStatusBar: false,
    });
  },

  /**
   * Error notification - Critical red background
   */
  error: (title: string, description: string = 'Something went wrong') => {
    triggerFailure();
    showMessage({
      message: title,
      description: description,
      type: 'danger',
      icon: 'danger',
      duration: 4000,
      floating: true,
      statusBarHeight: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : undefined,
      style: { zIndex: 9999, elevation: 9999, backgroundColor: '#D32F2F' },
      hideStatusBar: false,
    });
  },

  /**
   * Warning notification - Attention orange background
   */
  warning: (title: string, description: string = '') => {
    showMessage({
      message: title,
      description: description,
      type: 'warning',
      icon: 'warning',
      duration: 3500,
      floating: true,
      statusBarHeight: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : undefined,
      style: { zIndex: 9999, elevation: 9999 },
      hideStatusBar: false,
    });
  },

  /**
   * Information notification - Subtle blue background
   */
  info: (title: string, description: string = '') => {
    showMessage({
      message: title,
      description: description,
      type: 'info',
      icon: 'info',
      duration: 3000,
      floating: true,
      statusBarHeight: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : undefined,
      style: { zIndex: 9999, elevation: 9999 },
      hideStatusBar: false,
    });
  },
};

/**
 * Shorthand alias as requested
 */
export const message = (text: string, type: MessageType = 'warning') => {
  FlashMessage.show(text, '', type);
};
