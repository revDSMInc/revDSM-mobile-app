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
      style: {
        zIndex: 9999,
        elevation: 9999,
        backgroundColor: type === 'danger' ? '#D32F2F' : undefined,
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
