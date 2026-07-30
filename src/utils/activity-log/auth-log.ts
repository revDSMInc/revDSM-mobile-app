/**
 * Authentication activity log.
 *
 * `login` and `logout` are web-faithful — same event names, same `module_type: 'system'`,
 * same meta as `auth-provider.js` / `account-popover.js` — so the portal renders mobile
 * sessions in the same rows as web ones. The rest of the flow (an attempt, a failure, a
 * 2FA challenge, a code that didn't verify) has no web counterpart; it is logged because
 * a sign-in that never completes is exactly the thing worth being able to look up.
 *
 * ## The pre-auth problem
 *
 * `logEvent` refuses an event with no `user_id` unless it is marked `isPublic` — and
 * before a token exists there IS no user id, only the email that was typed. Those events
 * therefore go up as `isPublic` with the email in meta, and the API sees them
 * unauthenticated (no bearer token to attach yet).
 *
 * ⚠️ Whether `user-activity-log/v1/create` accepts an unauthenticated body is a BACKEND
 * question that has not been confirmed. If it answers 401, the attempt/failure events
 * are dropped — `logEvent` swallows that — while `login` and `logout`, which run with a
 * token, keep working. Nothing here can break the sign-in either way.
 */

import { logEvent } from '../../services/api/LoggerService';
import { LOG_ACTIONS } from '../../constants/activity-log.constants';

/** Every auth event lives under the same non-lead-scoped module as web's. */
const MODULE = 'system';

const userIdOf = (user: any): string | undefined => user?._id || user?.id;

/** Identity of the person the log is about, as far as it is known at that moment. */
const identityOf = (user: any) => ({
  email: user?.email,
  firstName: user?.firstName,
  lastName: user?.lastName,
});

/**
 * Why a sign-in failed, in a form worth grouping by.
 *
 * The screen's own copy is deliberately vague ("Incorrect email or password") so it
 * can't confirm which half was wrong; the log is where the real cause belongs, since
 * "everyone's password is failing" and "the API is unreachable" need different fixes.
 */
const failureReason = (err: any): string => {
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

/** Only the shape of a failure travels — never the password, never the typed code. */
const failureMeta = (err: any) => ({
  reason: failureReason(err),
  message: typeof err?.message === 'string' ? err.message : undefined,
  httpStatus: err?.httpStatus,
});

// ─────────────────────────────────────────────────────────────────────────────
// Pre-auth — no user id yet, so these ride on `isPublic`
// ─────────────────────────────────────────────────────────────────────────────

/** The Sign In button was pressed and the request is going out. */
export const logLoginAttempt = (email: string, meta: Record<string, any> = {}) =>
  logEvent('login_attempt', {
    isPublic: true,
    module_type: MODULE,
    action: LOG_ACTIONS.SUBMIT,
    meta: { email, ...meta },
  });

/** The credentials were rejected, or the request never landed. */
export const logLoginFailed = (email: string, err: any) =>
  logEvent('login_failed', {
    isPublic: true,
    module_type: MODULE,
    action: LOG_ACTIONS.SUBMIT,
    meta: { email, ...failureMeta(err) },
  });

/**
 * The password was right but a second factor is required.
 *
 * Worth its own event: it is the point where a sign-in legitimately stops without being
 * a failure, and a user stuck here looks identical to one who never tried.
 */
export const logTwoFactorRequired = (email: string, method?: string) =>
  logEvent('login_2fa_required', {
    isPublic: true,
    module_type: MODULE,
    action: LOG_ACTIONS.VIEW,
    meta: { email, method: method || 'email' },
  });

/** A submitted 2FA code was wrong or expired. */
export const logTwoFactorFailed = (email: string, method: string | undefined, err: any) =>
  logEvent('login_2fa_failed', {
    isPublic: true,
    module_type: MODULE,
    action: LOG_ACTIONS.SUBMIT,
    meta: { email, method: method || 'email', ...failureMeta(err) },
  });

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — a token and a user exist
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signed in. Web parity: event `login`, `module_type: 'system'`, email + name in meta.
 *
 * `via` says how the session was obtained — password, or a verified 2FA code — without
 * changing the event name the portal groups on.
 */
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

/** Signed out. Web parity: event `logout`, `module_type: 'system'`. */
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
