import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../redux/store';
import { logout as logoutAction, setInitial } from '../redux/reducer/auth.reducer';
import { AuthService } from '../services/api/auth';
import { setSessionHeader } from '../services/api';
import SocketManager from '../services/SocketManager';
import { queryClient } from '../services/api/queryClient';
import { logLogout } from '../utils/activity-log/auth-log';
import { clearPendingLogs } from '../services/api/LoggerService';
import { clearActiveInstallerJob } from '../utils/activity-log/installer-log';
import { endInstallerWorkSession } from '../utils/installer-work-session';
// Safe to import statically: PushNotificationService is pure JS and reaches the
// native SDKs only through `services/push-native.ts`, which requires them lazily
// inside a try/catch. It must stay that way — a static native import anywhere in
// this chain makes SIGN-IN depend on the push modules being present.
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

  // ⚠️ A default the rep set with NO SIGNAL has not reached the server, so `getMe` still reports
  // the old one. Every "Set as Default" toggle in the app derives its on/off state from this user
  // record, so without this overlay the switch cannot move offline at all — it snaps back, and the
  // rep taps it again. Applied here rather than per screen so no surface can forget it.
  const [pendingSettings, setPendingSettings] = useState(getPendingCalculatorSettings);
  useEffect(
    () =>
      subscribePendingCalculatorSettings(() =>
        setPendingSettings(getPendingCalculatorSettings())
      ),
    []
  );
  // Returns the SAME reference when nothing is pending, so identity is stable in the normal case.
  const user = useMemo(
    () => applyPendingSettingsToUser(storedUser, pendingSettings),
    [storedUser, pendingSettings]
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

      // 2. Close any open installer work session — BEFORE the token goes.
      //    Signing out is one of the commonest ways to leave a job, and the job
      //    screen's own check-out fires after the header is cleared, so it went up
      //    unauthenticated and was dropped. The office was left showing the crew as
      //    still on the job.
      await endInstallerWorkSession('logout');

      // 3. Release the push token — BEFORE the header is cleared, because the
      //    DELETE is authenticated.
      //    ⚠️ SECURITY, not housekeeping: field crews share handsets, and a token
      //    left bound puts the previous rep's lead names, customer addresses and
      //    chat messages on the next rep's lock screen. The backend only prunes a
      //    dead token on its next send, so leaving it is a real window.
      await PushNotificationService.unbind();

      // 4. Clear session from persistent storage & headers
      await setSessionHeader(null);
      // 5. Disconnect the global socket before wiping auth state
      SocketManager.disconnect();
      // 6. Clear API cache (React Query)
      if (queryClient) queryClient.clear();

      // 7. Wipe memory / Redux state
      dispatch(logoutAction());

      // 8. Drop the installer job bound to the activity log, so the next session
      //    can't attach this user's job/lead context to its events.
      clearActiveInstallerJob();

      // 9. Drop anything the logger is holding for a session that never opened, for
      //    the same reason — the next person to sign in on this device must not
      //    inherit it.
      clearPendingLogs();
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
