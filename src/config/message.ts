import { showMessage, MessageType, MessageOptions } from 'react-native-flash-message';
import { Platform, StatusBar } from 'react-native';
import { triggerSuccess, triggerFailure } from '../utils/haptics';

/**
 * A banner target that is NOT the app-root `<FlashMessage />` in `App.tsx`.
 *
 * ⚠️ **A native `Modal` is its own view tree, and the root instance lives outside
 * it** — so every banner raised while a sheet is open rendered UNDERNEATH that
 * sheet, behind its scrim. The rep pressed Confirm, the server refused with a
 * rule they had to read ("Down payments total $600, above the 50% maximum"), and
 * nothing appeared. `zIndex` cannot fix this: the modal is a separate window.
 *
 * So a sheet mounts its own `<ModalFlashHost />` (`widgets/common/ModalFlashHost`),
 * which registers here for as long as it is open. Everything already routed
 * through this wrapper — including the calls made deep inside hooks like
 * `useFunding`, which know nothing about which sheet is on screen — then lands
 * INSIDE the sheet with no change at the call site.
 */
export interface FlashHost {
  /** Deliver the banner. `false` = this host could not (unmounted ref) → fall back. */
  show: (options: MessageOptions) => boolean;
}

/**
 * A STACK, not a single slot: a sheet can open over a sheet (Result Lead sits over
 * the Deal Center screen), and the banner belongs to the topmost one. Unregistering
 * removes by identity rather than popping, so hosts unmounting out of order — which
 * React does not guarantee — cannot leave a dead host on top.
 */
const hosts: FlashHost[] = [];

export function registerFlashHost(host: FlashHost): () => void {
  hosts.push(host);
  return () => {
    const i = hosts.indexOf(host);
    if (i >= 0) hosts.splice(i, 1);
  };
}

/**
 * Raise one banner: the topmost host that can take it, else the app-root instance.
 *
 * ⚠️ The fallback is not optional. A host whose ref has not attached yet (or whose
 * modal is mid-dismissal) returns `false`, and swallowing the banner there would be
 * worse than the bug this fixes — a refusal the rep never sees at all.
 */
function emit(options: MessageOptions) {
  for (let i = hosts.length - 1; i >= 0; i--) {
    if (hosts[i].show(options)) return;
  }
  showMessage(options);
}

/**
 * Standardized Flash Message Wrapper
 * Simplifies and centralizes application focal notifications
 */
export const FlashMessage = {
  /**
   * General-purpose notification
   */
  show: (title: string, description: string = '', type: MessageType = 'info') => {
    emit({
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

  /**
   * Error notification - Critical red background
   */
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

  /**
   * Warning notification - Attention orange background
   */
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

  /**
   * Information notification - Subtle blue background
   */
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

/**
 * Shorthand alias as requested
 */
export const message = (text: string, type: MessageType = 'warning') => {
  FlashMessage.show(text, '', type);
};
