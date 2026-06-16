import { useEffect, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { Storage } from '../utils/storage';
import { migrateAsyncStorageToMMKV } from '../utils/migrate-storage';
import { AuthService } from '../services/api/auth';
import { setSessionHeader } from '../services/api';
import { setInitial } from '../redux/reducer/auth.reducer';
import SocketManager from '../services/SocketManager';
import { autoConfirmManager } from '../utils/calculator/autoConfirmManager';

export function useAppInitialization() {
  const dispatch = useDispatch();

  const initialize = useCallback(async () => {
    try {
      // Run one-time migration from AsyncStorage → MMKV on first boot
      await migrateAsyncStorageToMMKV();

      const accessToken = Storage.getItem('accessToken');
      if (accessToken) {
        setSessionHeader(accessToken);

        // Restore the socket immediately — user is still logged in from a
        // previous session, so the socket should be live before they navigate.
        SocketManager.connect(accessToken);

        const res = await AuthService.getMe();
        dispatch(setInitial({ user: res.data?.data }));
      } else {
        setSessionHeader(null);
        dispatch(setInitial({ user: null }));
      }
    } catch {
      setSessionHeader(null);
      dispatch(setInitial({ user: null }));
    }
  }, [dispatch]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    const cleanup = autoConfirmManager.startAutoConfirmScheduler();
    return () => cleanup();
  }, []);

  return { initialize };
}
