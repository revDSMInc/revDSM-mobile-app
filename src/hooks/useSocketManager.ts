import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Storage } from '../utils/storage';
import { RootState } from '../redux/store';
import SocketManager from '../services/SocketManager';

export function useSocketManager() {
  const { isAuthenticated } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    if (isAuthenticated) {
      const token = Storage.getItem('accessToken');
      if (token) {
        console.log('[useSocketManager] Authenticated — connecting global socket');
        SocketManager.connect(token);
      } else {
        console.warn('[useSocketManager] Authenticated but no token in storage');
      }
    } else {
      console.log('[useSocketManager] Not authenticated — disconnecting socket');
      SocketManager.disconnect();
    }
  }, [isAuthenticated]);
}
