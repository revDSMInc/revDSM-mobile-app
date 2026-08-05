import { useMemo } from 'react';
import { useAuth } from './useAuth';
import {
  getDashboardPermissions,
  resolveMobileDashboard,
  INSTALLER_DASHBOARD_PERMISSION,
  SALES_DASHBOARD_PERMISSION,
  type MobileDashboard,
} from '../utils/auth/dashboard-access';

/**
 * Role / dashboard-permission detection.
 *
 * The dashboard is decided ONLY by `permissions.DASHBOARD` on the signed-in profile —
 * `installer_dashboard` → Installer, `sales_representative_dashboard` → Sales, anything
 * else → no mobile access (the sign-in never gets this far; see
 * `utils/auth/dashboard-access.ts`). `roleName` is still surfaced for display/logging
 * but is deliberately NOT part of the decision, so the app and the backend can never
 * disagree about which experience an account gets.
 */
export { INSTALLER_DASHBOARD_PERMISSION, SALES_DASHBOARD_PERMISSION };

export function useUserRole() {
  const { user, isAuthenticated } = useAuth();

  return useMemo(() => {
    const dashboards = getDashboardPermissions(user);
    const roleName: string | undefined = user?.roleName ?? user?.role;
    const dashboard: MobileDashboard | null = isAuthenticated
      ? resolveMobileDashboard(user)
      : null;

    return {
      roleName,
      dashboards,
      /** Which mobile experience this account is entitled to (`null` = none). */
      dashboard,
      /** True when the signed-in user should see the Installer experience. */
      isInstaller: dashboard === 'installer',
      /** True when the signed-in user should see the Sales experience. */
      isSales: dashboard === 'sales',
      /** Installer's own company, shown in the job list header. */
      installerCompanyName: user?.installerCompanyName as string | undefined,
    };
  }, [user, isAuthenticated]);
}
