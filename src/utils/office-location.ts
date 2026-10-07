export interface OfficeCoords {
  latitude: number;
  longitude: number;
}

export const OFFICE_ZOOM = 13;

const toNumber = (value: any): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readOfficeCoords = (office: any): OfficeCoords | null => {
  const latitude = toNumber(office?.verifiedAddress?.lat) ?? toNumber(office?.lat);
  const longitude = toNumber(office?.verifiedAddress?.lon) ?? toNumber(office?.long);

  if (latitude === null || longitude === null) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude };
};

export const getAllOfficeCoords = (user: any): OfficeCoords[] => {
  const raw = user?.office;
  const offices: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return offices
    .map(readOfficeCoords)
    .filter((coords): coords is OfficeCoords => coords !== null);
};

export const getOfficeCoords = (user: any): OfficeCoords | null => {
  const raw = user?.office;
  const offices: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!offices.length) return null;

  const locatable = offices
    .map((office) => ({ office, coords: readOfficeCoords(office) }))
    .filter((entry) => entry.coords !== null);

  if (!locatable.length) return null;

  const assigned = locatable.find((entry) => entry.office?.assigned === true);
  return (assigned ?? locatable[0]).coords;
};
