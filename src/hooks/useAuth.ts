import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../redux/store';
import { logout as logoutAction, setInitial } from '../redux/reducer/auth.reducer';
import { AuthService } from '../services/api/auth';
import { setSessionHeader } from '../services/api';
import SocketManager from '../services/SocketManager';
import { queryClient } from '../services/api/queryClient';
import { resetSessionStorage } from '../services/sessionScope';
import { logLogout } from '../utils/activity-log/auth-log';
import { clearPendingLogs } from '../services/api/LoggerService';
import { clearActiveInstallerJob } from '../utils/activity-log/installer-log';
import { endInstallerWorkSession } from '../utils/installer-work-session';
import { endActiveLeadWorkSession } from '../utils/lead-work-session';
import PushNotificationService from '../services/PushNotificationService';
import { applyPendingSettingsToUser } from '../utils/offline-settings';
import {
  getPendingCalculatorSettings,
  subscribePendingCalculatorSettings,
} from '../services/offlineSettings';


export const useAuth = () => {
  const dispatch = useDispatch();
  const { user: storedUser, isAuthenticated, loading, isInitialized } = useSelector(
    (state: RootState) => state.auth
  );

  const [pendingSettings, setPendingSettings] = useState(getPendingCalculatorSettings);
  useEffect(
    () =>
      subscribePendingCalculatorSettings(() =>
        setPendingSettings(getPendingCalculatorSettings())
      ),
    []
  );
  const user = useMemo(
    () => applyPendingSettingsToUser(storedUser, pendingSettings),
    [storedUser, pendingSettings]
  );

  const logout = useCallback(async () => {
    try {
      logLogout(user);

      await endInstallerWorkSession('logout');

      // A rep who logs out mid-appointment is no longer at that door. Without this the lead stays
      // open on the server and the rep reads as live on the ops board until something else ends
      // it. Ordered BEFORE `setSessionHeader(null)`: both calls need the token.
      await endActiveLeadWorkSession();

      await PushNotificationService.unbind();

      await setSessionHeader(null);
      SocketManager.disconnect();
      if (queryClient) queryClient.clear();

      dispatch(logoutAction());

      clearActiveInstallerJob();

      clearPendingLogs();

      resetSessionStorage();
    } catch (err) {
      console.error('Logout failed', err);
    }
  }, [dispatch, user]);

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
