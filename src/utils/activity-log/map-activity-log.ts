import { logEvent } from '../../services/api/LoggerService';
import { calculateDistance } from '../location-util';

/** Mirrors web map.js sales_map view log */
export const logSalesMapView = async (user: any) => {
  const userId = user?._id || user?.id;
  if (!userId) return;
  await logEvent('view', {
    user_id: userId,
    module_type: 'sales_map',
    created_by: userId,
  });
};

/** Mirrors web map.js favorite_job click log */
export const logFavoriteJobClick = async (user: any, job: any, added: boolean) => {
  const userId = user?._id || user?.id;
  if (!userId) return;
  await logEvent('click', {
    user_id: userId,
    module_type: 'favorite_job',
    created_by: userId,
    meta: {
      jobId: job?._id || job?.id,
      jobNumber: job?.jobNumber,
      action: added ? 'added_to_favorites' : 'removed_from_favorites',
    },
  });
};

export interface MapPinSelectedOpts {
  job: any;
  coordinates: { lat: number; lng: number };
  userLocation?: { latitude: number; longitude: number } | null;
  currentLead?: any;
}

/** Mirrors web map.js map_interaction pin select log */
export const logMapPinSelected = async (user: any, opts: MapPinSelectedOpts) => {
  const userId = user?._id || user?.id;
  if (!userId || !opts.job) return;

  const { job, coordinates, userLocation, currentLead } = opts;
  const leadCoords = currentLead?.location?.coordinates;
  const fromLat = leadCoords ? leadCoords[1] : userLocation?.latitude;
  const fromLng = leadCoords ? leadCoords[0] : userLocation?.longitude;
  const distance =
    fromLat != null && fromLng != null
      ? calculateDistance(fromLat, fromLng, coordinates.lat, coordinates.lng)
      : 0;

  await logEvent('click', {
    user_id: userId,
    created_by: userId,
    module_type: 'map_interaction',
    meta: {
      jobNumber: job?.jobNumber || 'N/A',
      jobId: job?._id || job?.id || 'N/A',
      address: job?.address?.streetName || job?.streetName || 'N/A',
      city: job?.address?.city || job?.city || 'N/A',
      state: job?.address?.state || job?.state || 'N/A',
      coordinates,
      price: job?.price || 0,
      installDate: job?.installationDate || job?.leadDate || '',
      distance: distance || 0,
      distanceFrom: leadCoords ? 'current_lead' : 'user_gps',
      action: 'job_pin_selected',
    },
  });
};
