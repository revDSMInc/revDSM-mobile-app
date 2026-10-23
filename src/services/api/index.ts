import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Storage } from '../../utils/storage';
import { sanitizeForLog } from '../../utils/sanitize-for-log';
import { ENV } from '../../config/env';

import { FlashMessage } from '../../config/message';
import { store } from '../../redux/store';
import { logout } from '../../redux/reducer/auth.reducer';
import { queryClient } from './queryClient';
import { findClientIdInUrl, leadNotSyncedError } from '../../utils/lead-sync-state';
import SocketManager from '../SocketManager';
import {
  beginRequest,
  classifyRequestError,
  endRequest,
  isConnectionStable,
  reportRequestSignal,
} from '../connectivity';


/**
 * ⚠️ Was 120 s, which is what the rep in the one-bar video actually waited on - twice, because
 * TanStack retries once. A request that has not answered in this long on a field device is not
 * going to; the cached copy is the better answer. See `utils/slow-request.ts`.
 */
const REQUEST_TIMEOUT_MS = 15_000;

const axiosInstance: AxiosInstance = axios.create({
  baseURL: ENV.API_URL,
  timeout: REQUEST_TIMEOUT_MS,
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
    (config as any).__inFlightId = beginRequest(config.url);
    return config;
  },
  (error) => Promise.reject(error)
);

let parkedNoticeShownAt = 0;
const PARKED_NOTICE_COOLDOWN_MS = 60_000;

axiosInstance.interceptors.response.use(
  (res) => {
    endRequest((res.config as any)?.__inFlightId ?? null, true);
    reportRequestSignal('success');
    logTraffic(`← ${res.status} ${res.config.method?.toUpperCase()}`, res.config.url, res.data);
    return res;
  },
  async (error) => {
    endRequest(
      (error.config as any)?.__inFlightId ?? null,
      typeof error?.response?.status === 'number'
    );
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

/**
 * ⚠️ The app-wide containment for the counterfeit-id trap (docs/claude/offline.md, "Unsynced lead"): a lead made at a door is
 * keyed `lead-/appt-/calc-/work-<ts>-<rand>` until its `lead` saga step lands, and every lead-scoped endpoint 400s on a
 * non-ObjectId ("Valid lead id is required"). So a request whose PATH carries a client id never leaves the device - it rejects
 * (a plain object, no `httpStatus`, like every other rejection here) with `LEAD_NOT_SYNCED`, BEFORE axios, so the connectivity
 * model never sees it as a failed request and the banner cannot flip. Callers that queue (funding, delivery preference) treat
 * it as "keep it on the device"; the rest show its plain-English message instead of the server's Mongo wording.
 */
const blockedClientId = <T>(url: string): Promise<AxiosResponse<T>> | null => {
  const id = findClientIdInUrl(url);
  return id ? Promise.reject(leadNotSyncedError(id)) : null;
};

export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    blockedClientId<T>(url) ?? axiosInstance.get(url, config),
  post: <T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    blockedClientId<T>(url) ?? axiosInstance.post(url, data, config),
  put: <T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    blockedClientId<T>(url) ?? axiosInstance.put(url, data, config),
  patch: <T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    blockedClientId<T>(url) ?? axiosInstance.patch(url, data, config),
  delete: <T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    blockedClientId<T>(url) ?? axiosInstance.delete(url, config),
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
