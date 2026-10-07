export const INSTALLER_DASHBOARD_PERMISSION = 'installer_dashboard';

export const SALES_DASHBOARD_PERMISSION = 'sales_representative_dashboard';

export const NO_MOBILE_ACCESS_MESSAGE =
  "You don't have permission to access this mobile app. Please use the Web Portal to Login.";

export type MobileDashboard = 'installer' | 'sales';

export const getDashboardPermissions = (user: any): string[] => {
  const raw = user?.permissions?.DASHBOARD;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string');
};

export const resolveMobileDashboard = (user: any): MobileDashboard | null => {
  const dashboards = getDashboardPermissions(user);
  if (dashboards.includes(INSTALLER_DASHBOARD_PERMISSION)) return 'installer';
  if (dashboards.includes(SALES_DASHBOARD_PERMISSION)) return 'sales';
  return null;
};

export class MobileAccessDeniedError extends Error {
  readonly isMobileAccessDenied = true;

  constructor(message: string = NO_MOBILE_ACCESS_MESSAGE) {
    super(message);
    this.name = 'MobileAccessDeniedError';
  }
}

export const isMobileAccessDenied = (err: any): boolean =>
  err?.isMobileAccessDenied === true || err?.name === 'MobileAccessDeniedError';
