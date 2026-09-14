import { useMutation } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { AuthService, LoginData } from '../services/api/auth';
import { login as loginAction } from '../redux/reducer/auth.reducer';
import { setSessionHeader } from '../services/api';
import { adoptSessionOwner } from '../services/sessionScope';
import SocketManager from '../services/SocketManager';
import PushNotificationService from '../services/PushNotificationService';
import { Platform } from 'react-native';
import { commitAutofill } from '../utils/autofill';
import { flushPendingLogs } from '../services/api/LoggerService';
import {
  MobileAccessDeniedError,
  resolveMobileDashboard,
} from '../utils/auth/dashboard-access';
import {
  logLoginAttempt,
  logLoginFailed,
  logLoginSuccess,
  logTwoFactorFailed,
  logTwoFactorRequired,
} from '../utils/activity-log/auth-log';

/**
 * Rejects a profile that carries no mobile dashboard permission, and tears the
 * half-open session down first.
 *
 * Order matters: the token is already in MMKV and on the axios instance by this point,
 * so clearing it here is what stops the next cold start from silently restoring a
 * session the user was just refused. The socket is dropped for the same reason.
 */
const assertMobileAccess = (userData: any) => {
  if (resolveMobileDashboard(userData)) return;

  SocketManager.disconnect();
  setSessionHeader(null);
  throw new MobileAccessDeniedError();
};


export const useLoginMutation = () => {
  const dispatch = useDispatch();

  return useMutation({
    mutationFn: async (data: LoginData) => {
      const deviceId = data.deviceId || `mobile-${Platform.OS}-${data.email}`;

      // Logged before the request, not after: an attempt that never comes back — the
      // API unreachable, the app killed mid-request — is precisely the case a log for
      // "did they even try" has to cover.
      logLoginAttempt(data.email, { deviceId, platform: Platform.OS });

      // 1. Perform Login
      const loginRes = await AuthService.login({ ...data, deviceId });

      const resData = loginRes.data?.data || loginRes.data;

      // Check if 2FA is required (New structure support)
      if (resData?.requires2FA || resData?.twoFactorRequired) {
        const method = resData.twoFactorMethod || resData.method;
        logTwoFactorRequired(data.email, method);
        return {
          twoFactorRequired: true,
          method,
          email: data.email,
          lat: data.lat,
          long: data.long,
        };
      }

      const token = resData?.token;
      if (!token) {
        throw new Error('Invalid authentication response');
      }

      // 2. Set Session (AsyncStorage + Axios Header)
      await setSessionHeader(token);

      // 3. Connect global socket immediately
      SocketManager.connect(token);

      // 4. Fetch Profile
      const meRes = await AuthService.getMe();
      const userData = meRes.data?.data;
      if (!userData) {
        // The token landed but the profile didn't. Nothing can be dispatched, so
        // resolving here would leave the screen sitting silently on a sign-in that
        // "worked" — throwing gives the user a reason and gives us a logged failure.
        throw new Error('Signed in, but your profile could not be loaded. Please try again.');
      }

      // 5. Gate on the dashboard permission — installer or sales only.
      assertMobileAccess(userData);

      // ⚠️ Claim the device for this rep BEFORE anything renders. Handsets are shared, and if the
      // last person to use this one was somebody else, `adoptSessionOwner` wipes their cached data
      // here rather than letting a screen paint it. It is a no-op when the same rep signs back in,
      // so their own queued leads and photos survive.
      //
      // This is the belt to the sign-out braces: a session that ended in a crash, a force-quit or
      // an app kill ran no cleanup at all, and this is the only place that can still catch it.
      adoptSessionOwner(userData?._id || userData?.id);

      return { userData };
    },
    onSuccess: (res: any) => {
      if (res.userData) {
        // Everything held while signed out — the attempt, any 2FA challenge — goes up
        // FIRST, so the portal reads attempt → login in the order it happened. The
        // endpoint refuses unauthenticated rows, so this is the earliest they can land.
        flushPendingLogs(res.userData);
        logLoginSuccess(res.userData, 'password');
        commitAutofill();
        if (Platform.OS === 'android') {
          setTimeout(() => {
            dispatch(loginAction({ user: res.userData }));
          }, 200);
        } else {
          dispatch(loginAction({ user: res.userData }));
        }
        // Bind the push token. The session header is already set in mutationFn, so
        // this POST is authenticated regardless of the dispatch delay above.
        void PushNotificationService.bind(res.userData?._id || res.userData?.id);
      }
    },
    // Covers every way the sign-in can end badly — rejected credentials, an
    // unreachable API, a profile that wouldn't load. The 2FA branch resolves rather
    // than rejects, so it is logged in `mutationFn` instead.
    onError: (err: any, variables) => {
      logLoginFailed(variables?.email ?? '', err);
    },
  });
};

export const useVerifyOtpMutation = () => {
  const dispatch = useDispatch();

  return useMutation({
    mutationFn: async (data: { 
      email: string; 
      code: string; 
      password?: string; 
      trustDevice?: boolean;
      lat?: number;
      long?: number;
    }) => {
      // Verify OTP is just another login call with the twoFactorCode field and password
      const loginRes = await AuthService.login({
        email: data.email,
        password: data.password,
        twoFactorCode: data.code,
        trustDevice: data.trustDevice,
        deviceId: `mobile-${Platform.OS}-${data.email}`,
        lat: data.lat,
        long: data.long,
      });
      const resData = loginRes.data?.data || loginRes.data;


      const token = resData?.token;
      if (!token) {
        throw new Error('Invalid or expired code');
      }

      await setSessionHeader(token);
      SocketManager.connect(token);

      const meRes = await AuthService.getMe();
      const userData = meRes.data?.data;
      if (!userData) {
        throw new Error('Signed in, but your profile could not be loaded. Please try again.');
      }

      // Same gate as the password path — 2FA is just the second half of a sign-in.
      assertMobileAccess(userData);

      // ⚠️ Claim the device for this rep BEFORE anything renders. Handsets are shared, and if the
      // last person to use this one was somebody else, `adoptSessionOwner` wipes their cached data
      // here rather than letting a screen paint it. It is a no-op when the same rep signs back in,
      // so their own queued leads and photos survive.
      //
      // This is the belt to the sign-out braces: a session that ended in a crash, a force-quit or
      // an app kill ran no cleanup at all, and this is the only place that can still catch it.
      adoptSessionOwner(userData?._id || userData?.id);

      return userData;
    },
    onSuccess: (userData) => {
      // The attempt and the 2FA challenge were both held pre-session; they lead the
      // flush so the sign-in story arrives in order.
      flushPendingLogs(userData);
      // Same `login` event as the password path — the portal groups on the event name,
      // and `via` is what tells the two apart.
      logLoginSuccess(userData, '2fa');
      commitAutofill();
      if (Platform.OS === 'android') {
        setTimeout(() => {
          dispatch(loginAction({ user: userData }));
        }, 200);
      } else {
        dispatch(loginAction({ user: userData }));
      }
      // Same bind as the password path — a 2FA sign-in is a sign-in.
      void PushNotificationService.bind(userData?._id || userData?.id);
    },
    // A wrong or expired code, or a profile that wouldn't load after it verified.
    onError: (err: any, variables) => {
      logTwoFactorFailed(variables?.email ?? '', undefined, err);
    },
  });
};
