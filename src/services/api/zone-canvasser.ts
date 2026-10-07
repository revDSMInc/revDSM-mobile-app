import api from './index';
import { normalizePropertyResponse } from '../../utils/property-util';

export const ZONE_ENDPOINTS = {
  list: '/revzones/v1/sales-rep/my-revzones',
  archivedList: '/revzones/v1/sales-rep/my-revzones?archived=true',
  create: '/revzones/v1/sales-rep/create',
  update: (zoneId: string) => `/revzones/v1/${zoneId}`,
  salesRepDelete: (zoneId: string) => `/revzones/v1/sales-rep/${zoneId}`,
  salesRepArchive: (zoneId: string) => `/revzones/v1/sales-rep/${zoneId}/archive`,
  salesRepUnarchive: (zoneId: string) => `/revzones/v1/sales-rep/${zoneId}/archive?unarchive=true`,
} as const;

function readZoneList(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.zones)) return body.zones;
  return [];
}

export async function fetchCanvasserZones(): Promise<any[]> {
  const res = await api.get<any>(ZONE_ENDPOINTS.list);
  return readZoneList(res.data);
}

export async function fetchArchivedZones(): Promise<any[]> {
  const res = await api.get<any>(ZONE_ENDPOINTS.archivedList);
  return readZoneList(res.data);
}

export async function createZone(payload: any) {
  const res = await api.post<any>(ZONE_ENDPOINTS.create, payload);
  return res.data;
}

export async function updateZone(zoneId: string, payload: any) {
  const res = await api.put<any>(ZONE_ENDPOINTS.update(zoneId), payload);
  return res.data;
}

export async function deleteZone(zoneId: string) {
  const res = await api.delete<any>(ZONE_ENDPOINTS.salesRepDelete(zoneId));
  return res.data;
}

export async function archiveZone(zoneId: string) {
  const res = await api.put<any>(ZONE_ENDPOINTS.salesRepArchive(zoneId));
  return res.data;
}

export async function unarchiveZone(zoneId: string) {
  const res = await api.put<any>(ZONE_ENDPOINTS.salesRepUnarchive(zoneId));
  return res.data;
}

function splitGoogleAddress(geocodeData: any) {
  const components = geocodeData?.results?.[0]?.address_components;
  if (!components) return { address1: '', address2: '' };

  let streetNumber = '';
  let route = '';
  let city = '';
  let state = '';
  let zipCode = '';

  components.forEach((component: any) => {
    const types = component.types;
    if (types.includes('street_number')) streetNumber = component.long_name;
    else if (types.includes('route')) route = component.long_name;
    else if (types.includes('locality')) city = component.long_name;
    else if (types.includes('administrative_area_level_1')) state = component.short_name;
    else if (types.includes('postal_code')) zipCode = component.long_name;
  });

  const address1 = `${streetNumber} ${route}`.trim();
  const address2 = `${city}, ${state}, ${zipCode}`.trim();
  return { address1, address2 };
}

export async function reverseGeocode(latitude: number, longitude: number) {
  const res = await api.get<any>('/geocoding/v1/reverse', {
    params: { latitude, longitude },
  });
  return res.data;
}

export async function fetchPropertyDetails(latitude: number, longitude: number) {
  const geocodeData = await reverseGeocode(latitude, longitude);

  if (!geocodeData?.results?.length) {
    throw new Error('No address found for these coordinates');
  }

  const { address1, address2 } = splitGoogleAddress(geocodeData);
  const fullAddress = `${address1}, ${address2}`;
  const isUSAddress = /, [A-Z]{2}, \d{5}/.test(fullAddress);

  const baseResult = {
    formattedAddress: geocodeData.results[0].formatted_address,
    address1,
    address2,
    geocodeData: geocodeData.results[0],
  };

  if (!isUSAddress) {
    return {
      ...baseResult,
      propertyLookupUnavailable: true,
      error: 'Property data lookup is only available for US addresses',
    };
  }

  try {
    const propRes = await api.get<any>('/property/v1/properties', {
      params: { address: fullAddress },
    });

    const propertyRecord = normalizePropertyResponse(propRes.data);
    if (!propertyRecord) {
      return {
        ...baseResult,
        propertyLookupUnavailable: true,
        error: 'No property data found in RentCast API for this address',
      };
    }

    return {
      ...propertyRecord,
      ...baseResult,
    };
  } catch (err: any) {
    console.warn('[fetchPropertyDetails] RentCast details fetch failed:', err);
    return {
      ...baseResult,
      propertyLookupUnavailable: true,
      error: 'Property data lookup failed (RentCast API unavailable)',
    };
  }
}


function withGeoPosition(payload: any) {
  const position = payload?.buildingDetails?.position;
  if (!Array.isArray(position) || position.length !== 2) return payload;
  const [lat, lng] = position;
  return {
    ...payload,
    buildingDetails: { ...payload.buildingDetails, position: [lng, lat] },
  };
}

export async function createBuildingLead(payload: any) {
  const res = await api.post<any>('/sales-rep/lead/v1/create', withGeoPosition(payload));
  return res.data;
}

export async function updateBuildingLead(leadId: string, payload: any) {
  const res = await api.put<any>(`/canvasser/lead/v1/update/${leadId}`, withGeoPosition(payload));
  return res.data;
}

export async function updateSalesRepLead(leadId: string, payload: any) {
  const res = await api.put<any>(`/sales-rep/lead/v1/update/${leadId}`, withGeoPosition(payload));
  return res.data;
}
