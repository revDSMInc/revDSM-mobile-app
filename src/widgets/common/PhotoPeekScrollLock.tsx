import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ScrollView, ScrollViewProps } from 'react-native';

interface PeekScrollLockValue {
  scrollEnabled: boolean;
  lock: () => void;
  unlock: () => void;
}

const PhotoPeekScrollLockContext = createContext<PeekScrollLockValue | null>(null);

export const PhotoPeekScrollLockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lockCount, setLockCount] = useState(0);
  const lock = useCallback(() => setLockCount((c) => c + 1), []);
  const unlock = useCallback(() => setLockCount((c) => Math.max(0, c - 1)), []);
  const value = useMemo<PeekScrollLockValue>(
    () => ({ scrollEnabled: lockCount === 0, lock, unlock }),
    [lockCount, lock, unlock],
  );
  return <PhotoPeekScrollLockContext.Provider value={value}>{children}</PhotoPeekScrollLockContext.Provider>;
};

export const usePhotoPeekScrollLock = (): PeekScrollLockValue | null =>
  useContext(PhotoPeekScrollLockContext);

export const PeekAwareScrollView = React.forwardRef<ScrollView, ScrollViewProps>(
  ({ scrollEnabled, ...props }, ref) => {
    const lock = usePhotoPeekScrollLock();
    const peekEnabled = lock ? lock.scrollEnabled : true;
    return <ScrollView ref={ref} {...props} scrollEnabled={scrollEnabled !== false && peekEnabled} />;
  },
);

PeekAwareScrollView.displayName = 'PeekAwareScrollView';
