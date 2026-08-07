import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ScrollView, ScrollViewProps } from 'react-native';

/**
 * Scroll lock shared between a hold-to-peek thumbnail (`PhotoPeekPressable`) and the
 * ScrollView it lives inside.
 *
 * WHY: `PhotoPeekPressable` opens the enlarged preview on a long-press and closes it on
 * `onPressOut`. Inside a ScrollView, the MOMENT the finger moves the ScrollView claims
 * the touch as a scroll — which TERMINATES the underlying Pressable (RN fires
 * `onPressOut` on responder-termination), dismissing the peek mid-hold. `pressRetentionOffset`
 * can't stop this because it's the parent ScrollView stealing the responder, not the
 * Pressable's own bounds.
 *
 * FIX: while a peek is open, freeze the surrounding scroll. A frozen ScrollView
 * (`scrollEnabled={false}`) never tries to become the responder on move, so the press is
 * never terminated and the peek stays up until a real finger-lift.
 *
 * Usage:
 *   <PhotoPeekScrollLockProvider>
 *     <PeekAwareScrollView>{...thumbnails using PhotoPeekPressable...}</PeekAwareScrollView>
 *   </PhotoPeekScrollLockProvider>
 *
 * The peek component calls `lock()`/`unlock()` (via the hook); a counter supports several
 * peekable thumbnails without one closing another's lock. Everything is optional — with no
 * provider the hook is a no-op and `PeekAwareScrollView` scrolls normally.
 */

interface PeekScrollLockValue {
  /** false while ANY peek is open — feed this to the surrounding ScrollView. */
  scrollEnabled: boolean;
  lock: () => void;
  unlock: () => void;
}

const PhotoPeekScrollLockContext = createContext<PeekScrollLockValue | null>(null);

export const PhotoPeekScrollLockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Ref-count open peeks so overlapping peeks (or a stray unlock) can't unfreeze the
  // scroll while another peek is still held.
  const [lockCount, setLockCount] = useState(0);
  const lock = useCallback(() => setLockCount((c) => c + 1), []);
  const unlock = useCallback(() => setLockCount((c) => Math.max(0, c - 1)), []);
  const value = useMemo<PeekScrollLockValue>(
    () => ({ scrollEnabled: lockCount === 0, lock, unlock }),
    [lockCount, lock, unlock],
  );
  return <PhotoPeekScrollLockContext.Provider value={value}>{children}</PhotoPeekScrollLockContext.Provider>;
};

/** Returns the lock API, or `null` when rendered outside a provider (peek then just no-ops). */
export const usePhotoPeekScrollLock = (): PeekScrollLockValue | null =>
  useContext(PhotoPeekScrollLockContext);

/**
 * Drop-in `ScrollView` that freezes itself while a `PhotoPeekPressable` peek is open (when
 * under a `PhotoPeekScrollLockProvider`). An explicit `scrollEnabled={false}` from the
 * caller still wins.
 */
export const PeekAwareScrollView = React.forwardRef<ScrollView, ScrollViewProps>(
  ({ scrollEnabled, ...props }, ref) => {
    const lock = usePhotoPeekScrollLock();
    const peekEnabled = lock ? lock.scrollEnabled : true;
    return <ScrollView ref={ref} {...props} scrollEnabled={scrollEnabled !== false && peekEnabled} />;
  },
);

PeekAwareScrollView.displayName = 'PeekAwareScrollView';
