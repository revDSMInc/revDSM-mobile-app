import api from './index';
import { AxiosResponse } from 'axios';

/**
 * Authentication Endpoints & Specific Logic
 */
export const AuthEndpoints = {
  me: '/company',
  login: '/company/login',
  update: '/user/update',
  tfaSettings: '/two-factor-auth/v1/settings',
  tfaDisable: '/two-factor-auth/v1/disable',
  tfaSetup: (method: string) => `/two-factor-auth/v1/setup/${method}`,
};

export interface LoginData {
  email: string;
  password?: string;
  otp?: string;
}

export const AuthService = {
  login: (data: LoginData): Promise<AxiosResponse<any>> => api.post(AuthEndpoints.login, data),
  getMe: (): Promise<AxiosResponse<any>> => api.get(AuthEndpoints.me),
  updateProfile: (data: any): Promise<AxiosResponse<any>> => api.patch(AuthEndpoints.update, data),
  getTfaSettings: (): Promise<AxiosResponse<any>> => api.get(AuthEndpoints.tfaSettings),
  disableTfa: (): Promise<AxiosResponse<any>> => api.post(AuthEndpoints.tfaDisable),
  setupTfa: (method: string): Promise<AxiosResponse<any>> => api.post(AuthEndpoints.tfaSetup(method)),
};
