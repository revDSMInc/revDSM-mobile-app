import type { LngLat, LngLatBounds } from './offline-map-regions';

export type MapCoverage =
  | 'live'
  | 'street'
  | 'base'
  | 'none';

export interface PackLike {
  bounds: LngLatBounds;
  status: string;
  kind?: string;
}

export const isUsablePack = (pack: PackLike | null | undefined): boolean =>
  !!pack && pack.status === 'complete';

export const pointInBounds = (point: LngLat, bounds: LngLatBounds): boolean => {
  const [[swLng, swLat], [neLng, neLat]] = bounds;
  const [lng, lat] = point;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return lng >= swLng && lng <= neLng && lat >= swLat && lat <= neLat;
};

export const resolveMapCoverage = (args: {
  online: boolean;
  basePack: PackLike | null | undefined;
  areaPacks: readonly PackLike[] | null | undefined;
  point: LngLat | null;
}): MapCoverage => {
  if (args.online) return 'live';

  const hasBase = isUsablePack(args.basePack);
  const { point } = args;

  if (point) {
    const covered = (args.areaPacks || []).some(
      (p) => isUsablePack(p) && pointInBounds(point, p.bounds)
    );
    if (covered) return 'street';
  }

  return hasBase ? 'base' : 'none';
};

export interface CoverageNotice {
  tone: 'info' | 'warning' | null;
  title: string;
  body: string;
  blocking: boolean;
}

export const coverageNotice = (coverage: MapCoverage): CoverageNotice => {
  switch (coverage) {
    case 'live':
    case 'street':
      return { tone: null, title: '', body: '', blocking: false };
    case 'base':
      return {
        tone: 'info',
        title: 'Offline map',
        body: 'Showing the saved map. Street-level detail for this address was not downloaded — it will sharpen when you are back online.',
        blocking: false,
      };
    case 'none':
    default:
      return {
        tone: 'warning',
        title: 'Map needs internet',
        body: 'No map has been saved to this device yet. Your pins and lead details still work — connect to Wi-Fi once to download the map for offline use.',
        blocking: true,
      };
  }
};

export const satelliteNotice = (online: boolean): CoverageNotice =>
  online
    ? { tone: null, title: '', body: '', blocking: false }
    : {
        tone: 'info',
        title: 'Satellite needs internet',
        body: 'Aerial imagery is not saved for offline use. The street map is still available.',
        blocking: false,
      };
