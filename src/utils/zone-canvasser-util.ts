/** Haversine distance in miles */
export function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export function formatZoneDisplayName(zone: any): string {
  const name = zone?.zoneName || zone?.zoneId || 'Zone Statistics';
  return name.replace(/^(REV-)(\d+)(\d{4})$/, '$1...$3');
}
