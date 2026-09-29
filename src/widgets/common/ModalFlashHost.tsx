import React, { useEffect, useRef } from 'react';
import RNFlashMessage from 'react-native-flash-message';
import { registerFlashHost } from '../../config/message';

interface Props {
  /**
   * Is the sheet that owns this host actually on screen? A host registered by a
   * modal whose `visible` is `false` would capture banners belonging to the screen
   * behind it and render them into a view tree nobody can see.
   */
  active?: boolean;
}

/**
 * A `FlashMessage` instance that lives INSIDE a native `Modal`, so banners raised
 * while that modal is open are drawn over it instead of behind it.
 *
 * Mount it as the LAST child of the modal's root view and pass `active={visible}`.
 * Nothing else changes: `FlashMessage.error(...)` anywhere — including inside hooks
 * that have no idea a sheet is open — routes here through the registry in
 * `config/message.ts` for as long as this is mounted.
 *
 * ⚠️ **`canRegisterAsDefault={false}` is required.** Without it this instance asks
 * `FlashMessageManager` to become the process-wide default for the library's own
 * `showMessage()`. It happens to be a no-op today (the manager keeps the FIRST
 * registrant, which is App.tsx's root instance) — but it would silently hijack every
 * global banner in the app the moment mount order changed. Our routing is the
 * registry above, never that manager.
 *
 * ⚠️ Deliberately does NOT read `useSafeAreaInsets()`. Insets read 0 or stale inside
 * a `Modal`, and the library already derives the status-bar offset itself
 * (`FlashMessageWrapper`) from the options `config/message.ts` sends — which is the
 * same offset the root instance uses, so a banner does not jump when a sheet opens.
 */
export function ModalFlashHost({ active = true }: Props) {
  const ref = useRef<RNFlashMessage>(null);

  useEffect(() => {
    if (!active) return;
    // Registered from an effect, not render: the ref only attaches after mount, and
    // a host that answers `false` forever would push every banner back to the root
    // instance — i.e. back behind the sheet.
    return registerFlashHost({
      show: (options) => {
        const instance = ref.current;
        if (!instance) return false;
        instance.showMessage(options);
        return true;
      },
    });
  }, [active]);

  if (!active) return null;

  // `position="top"` matches App.tsx, so a banner sits where the rep already looks
  // for one. The library's root view is absolute and `pointerEvents="box-none"`, so
  // this covers the sheet without swallowing taps on it.
  return <RNFlashMessage ref={ref} position="top" canRegisterAsDefault={false} />;
}
