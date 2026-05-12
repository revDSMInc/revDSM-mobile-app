import { useMutation } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { AuthService, LoginData } from '../services/api/auth';
import { login as loginAction } from '../redux/reducer/auth.reducer';
import { setSessionHeader } from '../services/api';
import SocketManager from '../services/SocketManager';

export const useLoginMutation = () => {
  const dispatch = useDispatch();

  return useMutation({
    mutationFn: async (data: LoginData) => {
      // 1. Perform Login
      const loginRes = await AuthService.login(data);
      const resData = loginRes.data?.data || loginRes.data;

      // Check if 2FA is required (New structure support)
      if (resData?.requires2FA || resData?.twoFactorRequired) {
        return { 
          twoFactorRequired: true, 
          method: resData.twoFactorMethod || resData.method, 
          email: data.email 
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

      return { userData };
    },
    onSuccess: (res: any) => {
      if (res.userData) {
        // 5. Update Redux State
        dispatch(loginAction({ user: res.userData }));
      }
    },
  });
};

export const useVerifyOtpMutation = () => {
  const dispatch = useDispatch();

  return useMutation({
    mutationFn: async (data: { email: string; code: string; password?: string; trustDevice?: boolean }) => {
      // Verify OTP is just another login call with the twoFactorCode field and password
      const loginRes = await AuthService.login({
        email: data.email,
        password: data.password,
        twoFactorCode: data.code,
        trustDevice: data.trustDevice,
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

      return userData;
    },
    onSuccess: (userData) => {
      dispatch(loginAction({ user: userData }));
    },
  });
};
