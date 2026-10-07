export type LngLat = [number, number];

export type LngLatBounds = [LngLat, LngLat];

export const FLORIDA_BOUNDS: LngLatBounds = [
  [-87.64, 24.39],
  [-79.97, 31.0],
];

export const BASE_MAP_PACK_NAME = 'region-florida';
export const BASE_MAP_LABEL = 'Florida (base map)';
export const BASE_MIN_ZOOM = 0;
export const BASE_MAX_ZOOM = 10;

export const AREA_MIN_ZOOM = BASE_MAX_ZOOM + 1;
export const AREA_MAX_ZOOM = 16;

export const AREA_CELL_DEG = 0.05;

export const AREA_EDGE_PAD_MILES = 0.5;

export const TILE_COUNT_LIMIT = 6_000;

export const MAX_AREA_PACKS = 24;

export const AREA_PACK_PREFIX = 'area-';

export const LEGACY_LEAD_PACK_PREFIX = 'lead-';

const MAX_MERCATOR_LAT = 85.0511;

const clampLat = (lat: number): number => Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));

export const lngToTileX = (lng: number, zoom: number): number => {
  const n = 2 ** zoom;
  return Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
};

export const latToTileY = (lat: number, zoom: number): number => {
  const n = 2 ** zoom;
  const rad = (clampLat(lat) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return Math.min(n - 1, Math.max(0, Math.floor(y)));
};

export const countTiles = (bounds: LngLatBounds, minZoom: number, maxZoom: number): number => {
  const [[west, south], [east, north]] = bounds;
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const cols = lngToTileX(east, z) - lngToTileX(west, z) + 1;
    const rows = latToTileY(south, z) - latToTileY(north, z) + 1;
    total += Math.max(0, cols) * Math.max(0, rows);
  }
  return total;
};

export const BASE_MAP_TILES = countTiles(FLORIDA_BOUNDS, BASE_MIN_ZOOM, BASE_MAX_ZOOM);

export interface AreaCell {
  name: string;
  bounds: LngLatBounds;
  leadCount: number;
  tiles: number;
}

const cellIndex = (deg: number): number => Math.floor(deg / AREA_CELL_DEG);

const cellBounds = (ix: number, iy: number): LngLatBounds => {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return [
    [r(ix * AREA_CELL_DEG), r(iy * AREA_CELL_DEG)],
    [r((ix + 1) * AREA_CELL_DEG), r((iy + 1) * AREA_CELL_DEG)],
  ];
};

export const areaPackName = (ix: number, iy: number): string => `${AREA_PACK_PREFIX}${ix}_${iy}`;

export const leadCoordinates = (lead: unknown): LngLat | null => {
  const coords = (lead as { location?: { coordinates?: unknown } } | null)?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng === 0 || lat === 0) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > MAX_MERCATOR_LAT) return null;
  return [lng, lat];
};

export const areaCellsForLeads = (leads: readonly unknown[] | null | undefined): AreaCell[] => {
  const counts = new Map<string, { ix: number; iy: number; leadCount: number }>();
  for (const lead of leads || []) {
    const pos = leadCoordinates(lead);
    if (!pos) continue;
    const [lng, lat] = pos;
    const latPad = AREA_EDGE_PAD_MILES / 69;
    const lngPad = AREA_EDGE_PAD_MILES / (69 * Math.cos((lat * Math.PI) / 180));
    const xs = new Set([cellIndex(lng - lngPad), cellIndex(lng), cellIndex(lng + lngPad)]);
    const ys = new Set([cellIndex(lat - latPad), cellIndex(lat), cellIndex(lat + latPad)]);
    xs.forEach((ix) =>
      ys.forEach((iy) => {
        const name = areaPackName(ix, iy);
        const entry = counts.get(name) || { ix, iy, leadCount: 0 };
        entry.leadCount += 1;
        counts.set(name, entry);
      })
    );
  }
  return [...counts.entries()]
    .map(([name, { ix, iy, leadCount }]) => {
      const bounds = cellBounds(ix, iy);
      return { name, bounds, leadCount, tiles: countTiles(bounds, AREA_MIN_ZOOM, AREA_MAX_ZOOM) };
    })
    .sort((a, b) => b.leadCount - a.leadCount || a.name.localeCompare(b.name));
};

export const selectAreaCells = (
  wanted: readonly AreaCell[],
  existing: readonly AreaCell[] = [],
  tileBudget: number = TILE_COUNT_LIMIT - BASE_MAP_TILES,
): { keep: AreaCell[]; evict: AreaCell[] } => {
  const keep: AreaCell[] = [];
  const evict: AreaCell[] = [];
  const seen = new Set<string>();
  let used = 0;
  const consider = (cell: AreaCell) => {
    if (seen.has(cell.name)) return;
    seen.add(cell.name);
    if (keep.length < MAX_AREA_PACKS && used + cell.tiles <= tileBudget) {
      keep.push(cell);
      used += cell.tiles;
    } else {
      evict.push(cell);
    }
  };
  wanted.forEach(consider);
  existing.forEach(consider);
  const existingNames = new Set(existing.map((c) => c.name));
  return { keep, evict: evict.filter((c) => existingNames.has(c.name)) };
};

export const areaLabel = (leadCount: number): string =>
  `Lead area · ${leadCount} lead${leadCount === 1 ? '' : 's'}`;
