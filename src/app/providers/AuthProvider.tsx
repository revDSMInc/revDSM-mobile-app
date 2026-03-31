import React, { useEffect, useReducer, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthContext } from '../../shared/auth/context';
import axiosInstance, { endpoints, setSession } from '../../shared/api/axios';

type State = { user: any; loading: boolean };
type Action = { type: 'INITIAL' | 'LOGIN' | 'LOGOUT'; payload?: any };

const initialState: State = { user: null, loading: true };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'INITIAL':
      return { loading: false, user: action.payload.user };
    case 'LOGIN':
      return { ...state, user: action.payload.user };
    case 'LOGOUT':
      return { ...state, user: null };
    default:
      return state;
  }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const initialize = useCallback(async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      if (accessToken) {
        await setSession(accessToken);
        const res = await axiosInstance.get(endpoints.auth.me);
        dispatch({ type: 'INITIAL', payload: { user: res.data?.data } });
      } else {
        dispatch({ type: 'INITIAL', payload: { user: null } });
      }
    } catch {
      dispatch({ type: 'INITIAL', payload: { user: null } });
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await axiosInstance.post(endpoints.auth.login, { email, password });
    const token = res?.data?.data?.token;
    await setSession(token);
    const meRes = await axiosInstance.get(endpoints.auth.me);
    dispatch({ type: 'LOGIN', payload: { user: meRes.data?.data } });
  }, []);

  const logout = useCallback(async () => {
    await setSession(null);
    dispatch({ type: 'LOGOUT' });
  }, []);

  const status = state.loading ? 'loading' : state.user ? 'authenticated' : 'unauthenticated';

  const value = useMemo(
    () => ({
      user: state.user,
      method: 'jwt',
      loading: status === 'loading',
      authenticated: status === 'authenticated',
      unauthenticated: status === 'unauthenticated',
      login,
      logout,
    }),
    [login, logout, state.user, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
