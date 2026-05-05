import { useEffect, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthService } from '../services/api/auth';
import { setSessionHeader } from '../services/api';
import { setInitial } from '../redux/reducer/auth.reducer';
import SocketManager from '../services/SocketManager';

export function useAppInitialization() {
  const dispatch = useDispatch();

  const initialize = useCallback(async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      if (accessToken) {
        await setSessionHeader(accessToken);

        // Restore the socket immediately — user is still logged in from a
        // previous session, so the socket should be live before they navigate.
        SocketManager.connect(accessToken);

        const res = await AuthService.getMe();
        dispatch(setInitial({ user: res.data?.data }));
      } else {
        await setSessionHeader(null);
        dispatch(setInitial({ user: null }));
      }
    } catch {
      await setSessionHeader(null);
      dispatch(setInitial({ user: null }));
    }
  }, [dispatch]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return { initialize };
}
