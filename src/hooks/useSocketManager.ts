/**
 * useSocketManager — App-level socket lifecycle hook
 *
 * Mount this ONCE at the root of the authenticated app (AppContent).
 *
 * The token is read from AsyncStorage because the Redux `user` object only
 * contains profile data — the auth token is stored separately in AsyncStorage
 * by setSessionHeader() during login.
 */

import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Storage } from '../utils/storage';
import { RootState } from '../redux/store';
import SocketManager from '../services/SocketManager';

export function useSocketManager() {
  const { isAuthenticated } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    if (isAuthenticated) {
      // Token is stored in MMKV by setSessionHeader() during login/init.
      // The Redux user object only holds profile data, not the token.
      const token = Storage.getItem('accessToken');
      if (token) {
        console.log('[useSocketManager] Authenticated — connecting global socket');
        SocketManager.connect(token);
      } else {
        console.warn('[useSocketManager] Authenticated but no token in storage');
      }
    } else {
      // User logged out — disconnect the socket
      console.log('[useSocketManager] Not authenticated — disconnecting socket');
      SocketManager.disconnect();
    }
  }, [isAuthenticated]);
}
