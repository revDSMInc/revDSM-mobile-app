import api from './index';
import { normalizePropertyResponse } from '../../utils/property-util';

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

/** Web parity: reverse geocode → US address check → property lookup */
export async function fetchPropertyDetails(latitude: number, longitude: number) {
  const geocodeData = await reverseGeocode(latitude, longitude);

  if (!geocodeData?.results?.length) {
    throw new Error('No address found for these coordinates');
  }

  const { address1, address2 } = splitGoogleAddress(geocodeData);
  const fullAddress = `${address1}, ${address2}`;
  const isUSAddress = /, [A-Z]{2}, \d{5}/.test(fullAddress);

  if (!isUSAddress) {
    return {
      formattedAddress: geocodeData.results[0].formatted_address,
      address1,
      address2,
      geocodeData: geocodeData.results[0],
      propertyLookupUnavailable: true,
      error: 'Property data lookup is only available for US addresses',
    };
  }

  const propRes = await api.get<any>('/property/v1/properties', {
    params: { address: fullAddress },
  });

  const propertyRecord = normalizePropertyResponse(propRes.data);

  return {
    ...(propertyRecord || {}),
    formattedAddress: geocodeData.results[0].formatted_address,
    address1,
    address2,
    geocodeData: geocodeData.results[0],
  };
}

export async function createBuildingLead(payload: any) {
  const res = await api.post<any>('/sales-rep/lead/v1/create', payload);
  return res.data;
}

export async function updateBuildingLead(leadId: string, payload: any) {
  const res = await api.put<any>(`/canvasser/lead/v1/update/${leadId}`, payload);
  return res.data;
}

export async function updateSalesRepLead(leadId: string, payload: any) {
  const res = await api.put<any>(`/sales-rep/lead/v1/update/${leadId}`, payload);
  return res.data;
}
