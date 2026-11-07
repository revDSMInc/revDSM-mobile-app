import { showMessage, MessageType, MessageOptions } from 'react-native-flash-message';
import { Platform, StatusBar } from 'react-native';
import { triggerSuccess, triggerFailure } from '../utils/haptics';
import { scrubTransportCopy, shouldShowTransportToast } from '../utils/transport-error-copy';


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

/**
 * ⚠️ THE ONE CHOKEPOINT every `FlashMessage.*` call passes through - which is the only reason
 * the transport scrub below is affordable. ~48 call sites are written
 * `FlashMessage.error('Error', err?.message || '<good copy>')`, and `normalizeApiError` always
 * populates `.message`, so that fallback is unreachable at every one of them and axios's raw
 * `"timeout of 15000ms exceeded"` went straight to the rep. Rewriting the words HERE fixes all
 * of them at once, and keeps fixing the ones added next month.
 *
 * ⚠️ Presentation only. The error object never changes, so retry/queue logic still sees the
 * real failure; see `utils/transport-error-copy.ts`.
 */
function emit(options: MessageOptions) {
  const raw = {
    title: String(options.message ?? ''),
    description: String(options.description ?? ''),
  };

  /**
   * ⚠️ A connection failure is never announced as a red card - it is alarm without an action,
   * and the work is queued either way. The connection strip (where the screen renders one) and
   * each screen's own inline state carry it instead. Server rejections still come through.
   */
  if (!shouldShowTransportToast(raw)) return;

  const scrubbed = scrubTransportCopy(raw);
  const next: MessageOptions =
    scrubbed.title === options.message && scrubbed.description === options.description
      ? options
      : { ...options, message: scrubbed.title, description: scrubbed.description };

  for (let i = hosts.length - 1; i >= 0; i--) {
    if (hosts[i].show(next)) return;
  }
  showMessage(next);
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
