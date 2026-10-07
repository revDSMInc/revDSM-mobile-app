import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Storage } from '../../utils/storage';
import { sanitizeForLog } from '../../utils/sanitize-for-log';
import { ENV } from '../../config/env';

import { FlashMessage } from '../../config/message';
import { store } from '../../redux/store';
import { logout } from '../../redux/reducer/auth.reducer';
import { queryClient } from './queryClient';
import SocketManager from '../SocketManager';
import {
  classifyRequestError,
  isConnectionStable,
  reportRequestSignal,
} from '../connectivity';


const axiosInstance: AxiosInstance = axios.create({
  baseURL: ENV.API_URL,
  timeout: 120000,
  headers: {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});


const logTraffic = (label: string, url?: string, body?: any) => {
  if (!__DEV__) return;
  let printable = body;
  if (body instanceof FormData) printable = '[FormData]';
  else if (typeof body === 'string') {
    try {
      printable = JSON.parse(body);
    } catch {
    }
  }
  console.log(`[API] ${label} ${url ?? ''}`, sanitizeForLog(printable));
};

axiosInstance.interceptors.request.use(
  (config) => {
    const token = Storage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    logTraffic(`→ ${config.method?.toUpperCase()}`, config.url, config.data);
    return config;
  },
  (error) => Promise.reject(error)
);

let parkedNoticeShownAt = 0;
const PARKED_NOTICE_COOLDOWN_MS = 60_000;

axiosInstance.interceptors.response.use(
  (res) => {
    reportRequestSignal('success');
    logTraffic(`← ${res.status} ${res.config.method?.toUpperCase()}`, res.config.url, res.data);
    return res;
  },
  async (error) => {
    reportRequestSignal(classifyRequestError(error));
    logTraffic(
      `✗ ${error.response?.status ?? 'ERR'} ${error.config?.method?.toUpperCase()}`,
      error.config?.url,
      { sent: error.config?.data, received: error.response?.data }
    );
    if (error.response?.status === 401) {
      const errorMsg = error.response.data?.message || error.response.data?.error || '';
      const isLoginRequest = error.config?.url?.includes('/company/login');
      const alreadySignedOut = !store.getState().auth?.isAuthenticated;

      // Do NOT trigger global logout logic for login failures
      if (!isLoginRequest && !alreadySignedOut) {
        const isUserNotFound =
          errorMsg.toLowerCase().includes('user not found') ||
          errorMsg.toLowerCase().includes('no user found') ||
          errorMsg.toLowerCase().includes('only sales representative');

        if (!isUserNotFound) {
          if (!isConnectionStable()) {
            if (!parkedNoticeShownAt || Date.now() - parkedNoticeShownAt > PARKED_NOTICE_COOLDOWN_MS) {
              parkedNoticeShownAt = Date.now();
              FlashMessage.warning(
                'Reconnecting',
                'Could not confirm your session. Your work is safe — we will retry when the connection settles.'
              );
            }
            return Promise.reject(normalizeApiError(error));
          }

          FlashMessage.error(
            'Session Expired',
            "Your session has expired or you've logged in on another device. Please log in again."
          );

          try {
            const push = require('../PushNotificationService');
            void push?.default?.clearLocalPushState?.();
          } catch (pushErr) {
            console.warn('[Push] local teardown on 401 failed:', pushErr);
          }

          await clearSession();
          queryClient.clear();
          SocketManager.disconnect();
          store.dispatch(logout());

          try {
            const session = require('../sessionScope');
            session?.resetSessionStorage?.();
          } catch (sessionErr) {
            console.warn('[session] reset on 401 failed:', sessionErr);
          }

        }
      }
    }
    return Promise.reject(normalizeApiError(error));
  }
);

const normalizeApiError = (error: any): Record<string, any> => {
  const data = error?.response?.data;
  const httpStatus: number | undefined = error?.response?.status;

  const isJsonBody = !!data && typeof data === 'object' && !Array.isArray(data);
  const rejection: Record<string, any> = isJsonBody
    ? { ...data }
    : // A plain-text body is worth showing; an HTML error page is not.
      {
        message:
          typeof data === 'string' && data.trim() && !data.trim().startsWith('<')
            ? data.trim()
            : error?.message || 'Something went wrong',
        ...(data !== undefined && !isJsonBody ? { body: data } : {}),
      };

  if (httpStatus !== undefined) rejection.httpStatus = httpStatus;
  if (!rejection.message) {
    rejection.message = httpStatus
      ? `Request failed (${httpStatus})`
      : error?.message || 'Something went wrong';
  }

  return rejection;
};

const clearSession = () => {
  Storage.removeItem('accessToken');
  delete axiosInstance.defaults.headers.common.Authorization;
};

export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    axiosInstance.get(url, config),
  post: <T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    axiosInstance.post(url, data, config),
  put: <T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    axiosInstance.put(url, data, config),
  patch: <T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    axiosInstance.patch(url, data, config),
  delete: <T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    axiosInstance.delete(url, config),
};

export const hasSession = (): boolean => !!Storage.getItem('accessToken');

export const setSessionHeader = (token: string | null) => {
  if (token) {
    Storage.setItem('accessToken', token);
    axiosInstance.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    clearSession();
  }
};

export default api;
