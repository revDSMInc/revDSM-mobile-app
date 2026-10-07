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

      logLoginAttempt(data.email, { deviceId, platform: Platform.OS });

      const loginRes = await AuthService.login({ ...data, deviceId });

      const resData = loginRes.data?.data || loginRes.data;

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

      await setSessionHeader(token);

      SocketManager.connect(token);

      const meRes = await AuthService.getMe();
      const userData = meRes.data?.data;
      if (!userData) {
        throw new Error('Signed in, but your profile could not be loaded. Please try again.');
      }

      assertMobileAccess(userData);

      adoptSessionOwner(userData?._id || userData?.id);

      return { userData };
    },
    onSuccess: (res: any) => {
      if (res.userData) {
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
        void PushNotificationService.bind(res.userData?._id || res.userData?.id);
      }
    },
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

      assertMobileAccess(userData);

      adoptSessionOwner(userData?._id || userData?.id);

      return userData;
    },
    onSuccess: (userData) => {
      flushPendingLogs(userData);
      logLoginSuccess(userData, '2fa');
      commitAutofill();
      if (Platform.OS === 'android') {
        setTimeout(() => {
          dispatch(loginAction({ user: userData }));
        }, 200);
      } else {
        dispatch(loginAction({ user: userData }));
      }
      void PushNotificationService.bind(userData?._id || userData?.id);
    },
    onError: (err: any, variables) => {
      logTwoFactorFailed(variables?.email ?? '', undefined, err);
    },
  });
};
