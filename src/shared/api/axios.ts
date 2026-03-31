import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ENV } from '../config/env';

const axiosInstance = axios.create({ baseURL: ENV.API_URL });

// Attach stored JWT on every request
axiosInstance.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

axiosInstance.interceptors.response.use(
  (res) => res,
  (error) => Promise.reject((error.response && error.response.data) || 'Something went wrong')
);

export const setSession = async (accessToken: string | null) => {
  if (accessToken) {
    await AsyncStorage.setItem('accessToken', accessToken);
  } else {
    await AsyncStorage.removeItem('accessToken');
  }
};

export const endpoints = {
  auth: {
    me: '/company',
    login: '/company/login',
  },
  leads: {
    salesPortal: (userId: string, params?: { status?: string; period?: string }) => {
      let url = `/demo/v1/leads/sales-portal?repId=${userId}`;
      if (params?.status) url += `&status=${params.status}`;
      if (params?.period) url += `&period=${params.period}`;
      return url;
    },
  },
  jobTracker: {
    list: '/job-tracker',
    monthly: (year: number) => `/job-tracker/monthly/${year}`,
  },
  appointment: {
    list: (date?: string) => (date ? `/appointments?lead_date=${date}` : '/appointments'),
  },
};

export default axiosInstance;
