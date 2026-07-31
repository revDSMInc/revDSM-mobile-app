import { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../redux/store';
import { logout as logoutAction, setInitial } from '../redux/reducer/auth.reducer';
import { AuthService } from '../services/api/auth';
import { setSessionHeader } from '../services/api';
import SocketManager from '../services/SocketManager';
import { queryClient } from '../services/api/queryClient';
import { logLogout } from '../utils/activity-log/auth-log';
import { clearActiveInstallerJob } from '../utils/activity-log/installer-log';


export const useAuth = () => {
  const dispatch = useDispatch();
  const { user, isAuthenticated, loading, isInitialized } = useSelector(
    (state: RootState) => state.auth
  );

  /**
   * Universal Logout Utility
   */
  const logout = useCallback(async () => {
    try {
      // 1. Log the sign-out FIRST, while the session still exists.
      //    `logEvent` captures the bearer token at call time, so firing it before
      //    `setSessionHeader(null)` is what keeps the POST authenticated — logged
      //    afterwards, it went up tokenless and the row never landed.
      logLogout(user);

      // 2. Clear session from persistent storage & headers
      await setSessionHeader(null);
      // 3. Disconnect the global socket before wiping auth state
      SocketManager.disconnect();
      // 4. Clear API cache (React Query)
      if (queryClient) queryClient.clear();

      // 5. Wipe memory / Redux state
      dispatch(logoutAction());

      // 6. Drop the installer job bound to the activity log, so the next session
      //    can't attach this user's job/lead context to its events.
      clearActiveInstallerJob();
    } catch (err) {
      console.error('Logout failed', err);
    }
  }, [dispatch, user]);

  /**
   * Refreshes the active user's profile from source
   */
  const refreshUser = useCallback(async () => {
    try {
      const res = await AuthService.getMe();
      dispatch(setInitial({ user: res.data?.data }));
    } catch (err) {
      console.error('Refresh user profile failed', err);
    }
  }, [dispatch]);

  return {
    user,
    isAuthenticated,
    loading,
    isInitialized,
    logout,
    refreshUser,
  };
};
