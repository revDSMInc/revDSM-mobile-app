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
      const token = loginRes.data?.data?.token;

      if (!token) {
        throw new Error('Invalid authentication response');
      }

      // 2. Set Session (AsyncStorage + Axios Header)
      await setSessionHeader(token);

      // 3. Connect global socket immediately — before anything else loads
      //    so the connection is ready when the user reaches any chat screen.
      SocketManager.connect(token);

      // 4. Fetch Profile (Required for app state)
      const meRes = await AuthService.getMe();
      const userData = meRes.data?.data;

      return userData;
    },
    onSuccess: (userData) => {
      // 5. Update Redux State
      dispatch(loginAction({ user: userData }));
    },
  });
};
