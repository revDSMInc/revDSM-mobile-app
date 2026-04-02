import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ENV } from '../../config/env';

/**
 * Generic API Service Wrapper
 * Handles: GET, POST, PUT, PATCH, DELETE
 */
import { FlashMessage } from '../../config/message';
import { store } from '../../redux/store';
import { logout } from '../../redux/reducer/auth.reducer';

/**
 * Generic API Service Wrapper
 */
const axiosInstance: AxiosInstance = axios.create({
  baseURL: ENV.API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Attach Auth Token
axiosInstance.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Handle Global Errors (like 401 Expiry)
axiosInstance.interceptors.response.use(
  (res) => res,
  async (error) => {
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
            "Session Expired",
            "Your session has expired or you've logged in on another device. Please log in again."
          );

          // Handle Logout Workflow
          await clearSession();
          store.dispatch(logout());
        }
      }
    }
    return Promise.reject(error.response?.data || { message: 'Something went wrong' });
  }
);

// Helper to clear session explicitly
const clearSession = async () => {
  await AsyncStorage.removeItem('accessToken');
  // Add other local clear requirements here if needed
  delete axiosInstance.defaults.headers.common.Authorization;
};

// Generic Methods
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => axiosInstance.get(url, config),
  post: <T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => axiosInstance.post(url, data, config),
  put: <T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => axiosInstance.put(url, data, config),
  patch: <T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => axiosInstance.patch(url, data, config),
  delete: <T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => axiosInstance.delete(url, config),
};

export const setSessionHeader = async (token: string | null) => {
  if (token) {
    await AsyncStorage.setItem('accessToken', token);
    axiosInstance.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    await clearSession();
  }
};

export default api;
