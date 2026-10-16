import type { FilterState } from '../widgets/modals/MapFiltersModal';
import {
  getJobDistanceMiles,
  getPinCategory,
  getPinSortDate,
  jobNumberMatches,
  matchesPinStatusFilter,
} from './sales-pins';

export const DEFAULT_MAP_FILTERS: FilterState = {
  jobNumber: '',
  sortOrder: 'date-desc',
  radius: 0,
  minPrice: '',
  maxPrice: '',
  startDate: null,
  endDate: null,
  myJobsOnly: false,
  isFavoriteOnly: false,
  isReferralOnly: false,
  isHeatMap: false,
  showRoute: false,
  showProduct: true,
  statusFilter: 'all',
  isMapInstalledOnly: false,
  isMapPendingInstallOnly: false,
  centerCoords: undefined,
};

export const isJobOwner = (item: any, user: any): boolean => {
  if (!user || !item) return false;
  const uid = typeof user === 'string' ? user : (user._id || user.id);
  if (!uid) return false;

  const matchesId = !!(
    item.salesRepId === uid ||
    item.salesRep === uid ||
    (item.salesRep && typeof item.salesRep === 'object' && (item.salesRep._id === uid || item.salesRep.id === uid)) ||
    item.assignedRepId === uid ||
    (item.assignedRep && typeof item.assignedRep === 'object' && (item.assignedRep._id === uid || item.assignedRep.id === uid))
  );
  if (matchesId) return true;

  if (typeof user === 'object') {
    const repName = (item.salesRepName || item.userName || (typeof item.salesRep === 'string' ? item.salesRep : ''))?.toLowerCase().trim();
    if (repName) {
      const userFullName = `${user.firstName || ''} ${user.lastName || ''}`.toLowerCase().trim();
      const userFirstName = (user.firstName || '').toLowerCase().trim();
      if (userFullName && (repName === userFullName || repName === userFirstName)) {
        return true;
      }
    }
  }

  return false;
};

/** Hides the seeded TAM30000-30032 demo jobs, exactly as the Map screen always has. */
const isHiddenDemoJob = (item: any): boolean => {
  const jobNumber = item?.jobNumber;
  if (typeof jobNumber !== 'string' || !jobNumber.startsWith('TAM')) return false;
  const number = parseInt(jobNumber.replace('TAM', ''), 10);
  return !isNaN(number) && number >= 30000 && number <= 30032;
};

/**
 * The Map screen's client-side job filter, shared with the Zone Canvasser's sales pins so the same
 * `MapFiltersModal` means the same thing in both. Pure - no sorting, no timestamps (the Map adds those).
 */
export const filterMapJobs = (
  leads: any[],
  filters: FilterState,
  ctx: { user: any; userLocation?: { latitude: number; longitude: number } | null }
): any[] => {
  const { user, userLocation } = ctx;
  return leads.filter((item) => {
    if (isHiddenDemoJob(item)) return false;

    if (filters.jobNumber && !filters.centerCoords) {
      const search = String(filters.jobNumber).toLowerCase();
      const matchesJob = jobNumberMatches(item, search);
      const matchesAddress = String(item.fullAddress ?? '').toLowerCase().includes(search);
      if (!matchesJob && !matchesAddress) return false;
    }

    if (filters.isReferralOnly) {
      const isMine = isJobOwner(item, user);
      const hasReferrals = item.jobReferrals && item.jobReferrals.length > 0;
      if (!hasReferrals) return false;

      if (!isMine) {
        const activeToggle = item.jobReferrals[0]?.referralToggle === true || item.jobReferrals[0]?.referralToggle === 'true';
        if (!activeToggle) return false;
      }
    }

    if (filters.myJobsOnly && !isJobOwner(item, user)) return false;

    if (filters.isFavoriteOnly) {
      const isFav = item.isFavorite === true || item.isFavourite === true;
      if (!isFav) return false;
    }

    if (!matchesPinStatusFilter(item, filters.statusFilter)) return false;

    if (filters.isMapInstalledOnly && getPinCategory(item) !== 'installed') return false;
    if (filters.isMapPendingInstallOnly && getPinCategory(item) !== 'pendingInstall') return false;

    if (filters.minPrice && (item.price || 0) < parseFloat(filters.minPrice)) return false;
    if (filters.maxPrice && (item.price || 0) > parseFloat(filters.maxPrice)) return false;

    if (filters.radius > 0) {
      const origin = filters.centerCoords || userLocation;
      if (origin) {
        const miles = getJobDistanceMiles(item, origin);
        if (miles === null || miles > filters.radius) return false;
      }
    }

    if (filters.startDate) {
      const itemDate = new Date(getPinSortDate(item));
      if (itemDate < new Date(filters.startDate)) return false;
    }
    if (filters.endDate) {
      const itemDate = new Date(getPinSortDate(item));
      if (itemDate > new Date(filters.endDate)) return false;
    }

    return true;
  });
};
