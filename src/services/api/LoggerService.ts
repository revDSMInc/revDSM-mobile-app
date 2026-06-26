import axios from 'axios';
import { ENV } from '../../config/env';
import { Storage } from '../../utils/storage';
import Geolocation from 'react-native-geolocation-service';

const ExcludedModuleTypes = ['leads_list', 'system', 'lms', 'self_gen_lead'];

export const logEvent = async (eventType: string, details: any = {}) => {
  const userId = details.user_id;
  const isPublic = details.isPublic || false;
  if (!userId && !isPublic) return;

  const meta = { ...(details.meta || {}) };
  if (details.action && meta.action == null) {
    meta.action = details.action;
  }

  // Sync with web app: automatically attach leadId if missing and available in storage
  if (!meta.leadId && !ExcludedModuleTypes.includes(details.module_type)) {
    const storedLeadId = Storage.getItem('leadId');
    if (storedLeadId) {
      meta.leadId = storedLeadId;
    }
  }

  // Check current time in EST for location logging (9am to 7pm)
  const currentTime = new Date();
  const estTime = new Date(currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Between 9am (540 min) and 7pm (1260 min)
  if (timeInMinutes >= 540 && timeInMinutes <= 1260) {
    try {
      // In mobile, we assume permissions are already handled by the calling screen
      // but we can wrap it in a silent request
      await new Promise((resolve) => {
        Geolocation.getCurrentPosition(
          (pos) => {
            meta.lat = pos.coords.latitude;
            meta.long = pos.coords.longitude;
            resolve(true);
          },
          (err) => {
            console.warn('[Logger] Could not get user location:', err);
            resolve(false);
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
        );
      });
    } catch (err) {
      console.warn('[Logger] Location error:', err);
    }
  }

  try {
    const payload = {
      user_id: userId,
      action_type: eventType,
      module_type: details.module_type,
      created_by: details.created_by || userId,
      meta: meta,
    };

    // Ensure URL doesn't have double slashes
    const baseUrl = ENV.API_URL.endsWith('/') ? ENV.API_URL.slice(0, -1) : ENV.API_URL;
    const token = Storage.getItem('accessToken');
    const headers: any = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    await axios.post(`${baseUrl}/user-activity-log/v1/create`, payload, { headers });
  } catch (err) {
    console.error('[Logger] Failed to send log:', err);
  }
};

