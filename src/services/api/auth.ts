import api from './index';
import { AxiosResponse } from 'axios';

export const AuthEndpoints = {
  me: '/company',
  login: '/company/login',
  update: '/user/update',
  tfaSettings: '/two-factor-auth/v1/settings',
  tfaDisable: '/two-factor-auth/v1/disable',
  tfaSetup: (method: string) => `/two-factor-auth/v1/setup/${method}`,
  forgotPassword: '/company/user/forget-password',
  resetPassword: '/company/user/reset-password',
  companyNames: '/company/user/company-names',
};

export interface LoginData {
  email: string;
  password?: string;
  twoFactorCode?: string;
  trustDevice?: boolean;
  lat?: number;
  long?: number;
  deviceId?: string;
}

export const AuthService = {
  login: (data: LoginData): Promise<AxiosResponse<any>> => api.post(AuthEndpoints.login, data),
  getMe: (): Promise<AxiosResponse<any>> => api.get(AuthEndpoints.me),
  updateProfile: (data: any): Promise<AxiosResponse<any>> => api.patch(AuthEndpoints.update, data),
  getTfaSettings: (): Promise<AxiosResponse<any>> => api.get(AuthEndpoints.tfaSettings),
  disableTfa: (): Promise<AxiosResponse<any>> => api.post(AuthEndpoints.tfaDisable),
  setupTfa: (method: string): Promise<AxiosResponse<any>> =>
    api.post(AuthEndpoints.tfaSetup(method)),
  getCompanyNames: (email: string): Promise<AxiosResponse<any>> =>
    api.post(AuthEndpoints.companyNames, { email }),
  forgotPassword: (email: string, companyId: string): Promise<AxiosResponse<any>> =>
    api.post(AuthEndpoints.forgotPassword, { email, companyId }),
  resetPassword: (data: any): Promise<AxiosResponse<any>> => api.post(AuthEndpoints.resetPassword, data),
};
