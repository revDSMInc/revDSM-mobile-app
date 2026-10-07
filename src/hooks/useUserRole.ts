import { useMemo } from 'react';
import { useAuth } from './useAuth';
import {
  getDashboardPermissions,
  resolveMobileDashboard,
  INSTALLER_DASHBOARD_PERMISSION,
  SALES_DASHBOARD_PERMISSION,
  type MobileDashboard,
} from '../utils/auth/dashboard-access';

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
      dashboard,
      isInstaller: dashboard === 'installer',
      isSales: dashboard === 'sales',
      installerCompanyName: user?.installerCompanyName as string | undefined,
    };
  }, [user, isAuthenticated]);
}
