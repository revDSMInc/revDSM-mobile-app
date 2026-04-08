import { showMessage, MessageType } from 'react-native-flash-message';

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
    });
  },

  /**
   * Success notification - Professional green background
   */
  success: (title: string, description: string = '') => {
    showMessage({
      message: title,
      description: description,
      type: 'success',
      icon: 'success',
      duration: 3000,
    });
  },

  /**
   * Error notification - Critical red background
   */
  error: (title: string, description: string = 'Something went wrong') => {
    showMessage({
      message: title,
      description: description,
      type: 'danger',
      icon: 'danger',
      duration: 4000,
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
    });
  },
};

/**
 * Shorthand alias as requested
 */
export const message = (text: string, type: MessageType = 'warning') => {
  FlashMessage.show(text, '', type);
};
