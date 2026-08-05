/**
 * Mobile dashboard access rule — the single source of truth for "which app does
 * this account get, if any".
 *
 * The decision is made purely from the profile returned by `GET /company` after a
 * successful sign-in: `permissions.DASHBOARD`.
 *
 *   ["installer_dashboard"]            → Installer dashboard
 *   ["sales_representative_dashboard"] → Sales dashboard
 *   anything else / empty / missing    → NOT allowed on mobile (web portal only)
 *
 * Every other dashboard permission (manager, admin, office, …) is a web-portal-only
 * role: the app has no screens for it, so the sign-in is rejected and the session is
 * torn down rather than dropping the user on a sales dashboard they can't use.
 *
 * This lives in `utils/` rather than in `useUserRole` because it is needed in two
 * non-hook places — the login/OTP mutations (to gate the sign-in) and app bootstrap
 * (to re-check a restored session).
 */

/** DASHBOARD permission granting the Installer experience. */
export const INSTALLER_DASHBOARD_PERMISSION = 'installer_dashboard';

/** DASHBOARD permission granting the Sales experience. */
export const SALES_DASHBOARD_PERMISSION = 'sales_representative_dashboard';

/** Shown verbatim whenever an account has neither mobile dashboard permission. */
export const NO_MOBILE_ACCESS_MESSAGE =
  "You don't have permission to access this mobile app. Please use the Web Portal to Login.";

export type MobileDashboard = 'installer' | 'sales';

/** `permissions.DASHBOARD`, defensively normalised to a string array. */
export const getDashboardPermissions = (user: any): string[] => {
  const raw = user?.permissions?.DASHBOARD;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string');
};

/**
 * The dashboard this profile is entitled to, or `null` when the account may not use
 * the mobile app at all.
 *
 * An account holding BOTH permissions resolves to `installer` — installers are the
 * narrower, device-bound role, so it wins the tie deliberately. Flip the order of the
 * two checks below if the product decides sales should take precedence instead.
 */
export const resolveMobileDashboard = (user: any): MobileDashboard | null => {
  const dashboards = getDashboardPermissions(user);
  if (dashboards.includes(INSTALLER_DASHBOARD_PERMISSION)) return 'installer';
  if (dashboards.includes(SALES_DASHBOARD_PERMISSION)) return 'sales';
  return null;
};

/**
 * Thrown by the login / OTP mutations when the profile loaded fine but carries no
 * mobile dashboard permission. Carries a flag as well as the message so the auth
 * screens can present it as an access problem instead of running it through their
 * "wrong credentials" wording.
 */
export class MobileAccessDeniedError extends Error {
  readonly isMobileAccessDenied = true;

  constructor(message: string = NO_MOBILE_ACCESS_MESSAGE) {
    super(message);
    this.name = 'MobileAccessDeniedError';
  }
}

/** True for the rejection above — survives the class identity being lost in transit. */
export const isMobileAccessDenied = (err: any): boolean =>
  err?.isMobileAccessDenied === true || err?.name === 'MobileAccessDeniedError';
