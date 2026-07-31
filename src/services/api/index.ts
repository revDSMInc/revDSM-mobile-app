import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Storage } from '../../utils/storage';
import { ENV } from '../../config/env';

/**
 * Generic API Service Wrapper
 * Handles: GET, POST, PUT, PATCH, DELETE
 */
import { FlashMessage } from '../../config/message';
import { store } from '../../redux/store';
import { logout } from '../../redux/reducer/auth.reducer';
import { queryClient } from './queryClient';
import SocketManager from '../SocketManager';


/**
 * Generic API Service Wrapper
 */
const axiosInstance: AxiosInstance = axios.create({
  baseURL: ENV.API_URL,
  timeout: 120000,
  headers: {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});


/**
 * React Native DevTools' Network panel never shows a request body — its CDP bridge
 * omits `postData`, so the Payload tab always reads "[Preview unavailable]". These
 * dev-only interceptors print what was actually sent (and what came back) to the
 * Console tab instead, which is the only place the body is visible.
 */
const logTraffic = (label: string, url?: string, body?: any) => {
  if (!__DEV__) return;
  let printable = body;
  if (body instanceof FormData) printable = '[FormData]';
  else if (typeof body === 'string') {
    try {
      printable = JSON.parse(body);
    } catch {
      // leave the raw string
    }
  }
  console.log(`[API] ${label} ${url ?? ''}`, printable);
};

// Request Interceptor: Attach Auth Token
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

// Response Interceptor: Handle Global Errors (like 401 Expiry)
axiosInstance.interceptors.response.use(
  (res) => {
    logTraffic(`← ${res.status} ${res.config.method?.toUpperCase()}`, res.config.url, res.data);
    return res;
  },
  async (error) => {
    logTraffic(
      `✗ ${error.response?.status ?? 'ERR'} ${error.config?.method?.toUpperCase()}`,
      error.config?.url,
      { sent: error.config?.data, received: error.response?.data }
    );
    if (error.response?.status === 401) {
      const errorMsg = error.response.data?.message || error.response.data?.error || '';
      const isLoginRequest = error.config?.url?.includes('/company/login');

      // Do NOT trigger global logout logic for login failures
      if (!isLoginRequest) {
        const isUserNotFound =
          errorMsg.toLowerCase().includes('user not found') ||
          errorMsg.toLowerCase().includes('no user found') ||
          errorMsg.toLowerCase().includes('only sales representative');

        if (!isUserNotFound) {
          // Unified Flash Message before logout
          FlashMessage.error(
            'Session Expired',
            "Your session has expired or you've logged in on another device. Please log in again."
          );

          // Handle Logout Workflow
          await clearSession();
          queryClient.clear();
          SocketManager.disconnect();
          store.dispatch(logout());

        }
      }
    }
    return Promise.reject(normalizeApiError(error));
  }
);

/**
 * Turns any axios failure into an object with a readable `message`.
 *
 * The server's own JSON body is passed through untouched — callers read `err.message`
 * and that is the API's wording. But a body is not always JSON: a route that doesn't
 * exist, or a gateway that fell over, answers with an HTML page, and rejecting with
 * that string left `err.message` UNDEFINED — the caller then showed a blank reason and
 * the status code was lost with it, which makes a 404 indistinguishable from a dropped
 * connection. So a non-object body is replaced with a real message, and the HTTP status
 * is always attached as `httpStatus` (not `status`, which some payloads use themselves).
 */
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

// Helper to clear session explicitly
const clearSession = () => {
  Storage.removeItem('accessToken');
  // Add other local clear requirements here if needed
  delete axiosInstance.defaults.headers.common.Authorization;
};

// Generic Methods
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

export const setSessionHeader = (token: string | null) => {
  if (token) {
    Storage.setItem('accessToken', token);
    axiosInstance.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    clearSession();
  }
};

export default api;
