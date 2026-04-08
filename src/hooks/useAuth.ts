import { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../redux/store';
import { logout as logoutAction, setInitial } from '../redux/reducer/auth.reducer';
import { AuthService } from '../services/api/auth';
import { setSessionHeader } from '../services/api';

export const useAuth = () => {
  const dispatch = useDispatch();
  const { user, isAuthenticated, loading, isInitialized } = useSelector(
    (state: RootState) => state.auth
  );

  /**
   * Universal Logout Utility
   */
  const logout = useCallback(async () => {
    // 1. Clear session from persistent storage & headers
    await setSessionHeader(null);
    // 2. Wipe memory / Redux state
    dispatch(logoutAction());
  }, [dispatch]);

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
