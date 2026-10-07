import { logEvent } from '../../services/api/LoggerService';
import { LOG_ACTIONS } from '../../constants/activity-log.constants';

const MODULE = 'system';

const userIdOf = (user: any): string | undefined => user?._id || user?.id;

const identityOf = (user: any) => ({
  email: user?.email,
  firstName: user?.firstName,
  lastName: user?.lastName,
});

const failureReason = (err: any): string => {
  if (err?.isMobileAccessDenied === true) return 'no_mobile_access';

  const message = String(err?.message ?? '').toLowerCase();
  if (!message) return 'no_response';
  if (message.includes('password') || message.includes('credential')) return 'bad_credentials';
  if (message.includes('unauthorized')) return 'unauthorized';
  if (message.includes('not found')) return 'user_not_found';
  if (message.includes('validation')) return 'validation';
  if (message.includes('network') || message.includes('timeout')) return 'network';
  if (message.includes('code')) return 'bad_code';
  return 'other';
};

const failureMeta = (err: any) => ({
  reason: failureReason(err),
  message: typeof err?.message === 'string' ? err.message : undefined,
  httpStatus: err?.httpStatus,
});

export const logLoginAttempt = (email: string, meta: Record<string, any> = {}) =>
  logEvent('login_attempt', {
    isPublic: true,
    module_type: MODULE,
    action: LOG_ACTIONS.SUBMIT,
    meta: { email, ...meta },
  });

export const logLoginFailed = (email: string, err: any) =>
  logEvent('login_failed', {
    isPublic: true,
    module_type: MODULE,
    action: LOG_ACTIONS.SUBMIT,
    meta: { email, ...failureMeta(err) },
  });

export const logTwoFactorRequired = (email: string, method?: string) =>
  logEvent('login_2fa_required', {
    isPublic: true,
    module_type: MODULE,
    action: LOG_ACTIONS.VIEW,
    meta: { email, method: method || 'email' },
  });

export const logTwoFactorFailed = (email: string, method: string | undefined, err: any) =>
  logEvent('login_2fa_failed', {
    isPublic: true,
    module_type: MODULE,
    action: LOG_ACTIONS.SUBMIT,
    meta: { email, method: method || 'email', ...failureMeta(err) },
  });

export const logLoginSuccess = (user: any, via: 'password' | '2fa' = 'password') => {
  const userId = userIdOf(user);
  if (!userId) return;
  return logEvent('login', {
    user_id: userId,
    created_by: userId,
    module_type: MODULE,
    meta: { ...identityOf(user), via },
  });
};

export const logLogout = (user: any, meta: Record<string, any> = {}) => {
  const userId = userIdOf(user);
  if (!userId) return;
  return logEvent('logout', {
    user_id: userId,
    created_by: userId,
    module_type: MODULE,
    meta: { ...identityOf(user), ...meta },
  });
};
