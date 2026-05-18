import api from './index';
import { AxiosResponse } from 'axios';

export const SettingsService = {
  // 2FA Settings
  getTfaStatus: (): Promise<AxiosResponse<any>> => api.get('/two-factor-auth/v1/settings'),
  setupAuthenticator: (): Promise<AxiosResponse<any>> =>
    api.post('/two-factor-auth/v1/setup/authenticator'),
  verifyAuthenticator: (token: string, secret: string): Promise<AxiosResponse<any>> =>
    api.post('/two-factor-auth/v1/verify/authenticator', { token, secret }),
  setupEmail: (): Promise<AxiosResponse<any>> => api.post('/two-factor-auth/v1/setup/email'),
  disableTfa: (): Promise<AxiosResponse<any>> => api.post('/two-factor-auth/v1/disable'),
  regenerateBackupCodes: (): Promise<AxiosResponse<any>> =>
    api.post('/two-factor-auth/v1/backup-codes/regenerate'),

  // Trusted Devices
  getTrustedDevices: (): Promise<AxiosResponse<any>> =>
    api.get('/two-factor-auth/v1/trusted-devices'),
  revokeDevice: (deviceId: string): Promise<AxiosResponse<any>> =>
    api.delete('/two-factor-auth/v1/trusted-devices', { data: { deviceId } }),

  // Profile & Company
  updateProfile: (data: any, headers?: any): Promise<AxiosResponse<any>> => 
    api.put('/user/update', data, { headers }),
  updateCompanyProfile: (data: any): Promise<AxiosResponse<any>> =>
    api.put('/company/update/profile', data),
};
