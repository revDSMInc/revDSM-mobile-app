import { useMemo } from 'react';
import { useAuth } from './useAuth';

/**
 * Role / dashboard-permission detection.
 *
 * The Installer signal is `permissions.DASHBOARD` containing `installer_dashboard`.
 * That is preferred over the role name because `permissions` is the field the app
 * already relies on elsewhere (see AccountPopover's `permissions.LMS` check), so it
 * is known to survive `GET /company`. `roleName` / `role` are checked as a fallback
 * in case a deployment sends one but not the other.
 */
export const INSTALLER_DASHBOARD_PERMISSION = 'installer_dashboard';

export function useUserRole() {
  const { user, isAuthenticated } = useAuth();

  return useMemo(() => {
    const dashboards: string[] = user?.permissions?.DASHBOARD ?? [];
    const roleName: string | undefined = user?.roleName ?? user?.role;

    const isInstaller =
      dashboards.includes(INSTALLER_DASHBOARD_PERMISSION) ||
      roleName?.toLowerCase() === 'installer';

    return {
      roleName,
      dashboards,
      /** True when the signed-in user should see the Installer experience. */
      isInstaller: isAuthenticated && !!isInstaller,
      /** Installer's own company, shown in the job list header. */
      installerCompanyName: user?.installerCompanyName as string | undefined,
    };
  }, [user, isAuthenticated]);
}
