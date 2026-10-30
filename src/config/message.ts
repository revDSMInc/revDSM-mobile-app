import { showMessage, MessageType, MessageOptions } from 'react-native-flash-message';
import { Platform, StatusBar } from 'react-native';
import { triggerSuccess, triggerFailure } from '../utils/haptics';

export interface FlashHost {
  show: (options: MessageOptions) => boolean;
}

const hosts: FlashHost[] = [];

export function registerFlashHost(host: FlashHost): () => void {
  hosts.push(host);
  return () => {
    const i = hosts.indexOf(host);
    if (i >= 0) hosts.splice(i, 1);
  };
}

function emit(options: MessageOptions) {
  for (let i = hosts.length - 1; i >= 0; i--) {
    if (hosts[i].show(options)) return;
  }
  showMessage(options);
}

export const FlashMessage = {
  show: (title: string, description: string = '', type: MessageType = 'info') => {
    emit({
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
        ...(type === 'danger' ? { backgroundColor: '#D32F2F' } : null),
      },
      hideStatusBar: false,
    });
  },

  success: (title: string, description: string = '') => {
    triggerSuccess();
    emit({
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

  error: (title: string, description: string = 'Something went wrong') => {
    triggerFailure();
    emit({
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

  warning: (title: string, description: string = '') => {
    emit({
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

  info: (title: string, description: string = '') => {
    emit({
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

export const message = (text: string, type: MessageType = 'warning') => {
  FlashMessage.show(text, '', type);
};
