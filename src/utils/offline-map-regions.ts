/**
 * offline-map-regions.ts — WHAT map area to keep on the device, decided without Mapbox.
 *
 * Two tiers replace the old one-pack-per-lead design:
 *
 * | tier | area | zooms | why |
 * |---|---|---|---|
 * | base | the whole service region (Florida) | 0–10 | cities and highways everywhere, downloaded ONCE per install |
 * | area | a small grid cell around where leads are | 11–16 | street detail only where a rep actually knocks |
 *
 * ⚠️ The old design gave every lead a 10-mile radius at zoom 0–16 — ~4,800 tiles and ~85 MB to
 * cover one doorstep, with zoom 0 (the whole world) downloaded again for every lead. One pack all
 * but filled Mapbox's app-wide tile cap, so every later pack failed at `0 B · Error`.
 *
 * ⚠️ The whole state at STREET zoom is not an option: Florida at zoom 16 is hundreds of thousands
 * of tiles. The zoom range, not the area, is what decides the size — hence the split.
 *
 * Pure and RN-free so the arithmetic is testable; `services/offlineMapManager.ts` does the I/O.
 */

/** A GeoJSON position: `[lng, lat]`. */
export type LngLat = [number, number];

/** `[southWest, northEast]`, each `[lng, lat]`. */
export type LngLatBounds = [LngLat, LngLat];

// ─── Tier constants ──────────────────────────────────────────────────────────

/**
 * Florida, with a little margin for the Keys and the panhandle. Every lead today is there.
 * ⚠️ If the company expands, add a region here rather than widening this box — a second small box
 * costs far less than one box stretched across the Gulf.
 */
export const FLORIDA_BOUNDS: LngLatBounds = [
  [-87.64, 24.39],
  [-79.97, 31.0],
];

export const BASE_MAP_PACK_NAME = 'region-florida';
export const BASE_MAP_LABEL = 'Florida (base map)';
export const BASE_MIN_ZOOM = 0;
/** Zoom 10 reads as towns and main roads; 11 would roughly quadruple the base pack. */
export const BASE_MAX_ZOOM = 10;

/** Street detail starts exactly where the base map stops, so no zoom is downloaded twice. */
export const AREA_MIN_ZOOM = BASE_MAX_ZOOM + 1;
export const AREA_MAX_ZOOM = 16;

/** ~3.4 miles of latitude. A cell at zoom 11–16 is ~150 tiles in Florida. */
export const AREA_CELL_DEG = 0.05;

/**
 * A lead this close to a cell edge also pulls in the neighbouring cell, so a door on a boundary
 * never sits at the very edge of the downloaded street map.
 */
export const AREA_EDGE_PAD_MILES = 0.5;

/**
 * Mapbox's offline tile cap, app-wide across every pack (Mapbox TOS). Area packs share whatever
 * the base pack leaves.
 */
export const TILE_COUNT_LIMIT = 6_000;

/** A hard ceiling on area packs, independent of tiles, so the Profile list stays short. */
export const MAX_AREA_PACKS = 24;

export const AREA_PACK_PREFIX = 'area-';

/** Packs from the retired one-per-lead design, deleted on sight. */
export const LEGACY_LEAD_PACK_PREFIX = 'lead-';

// ─── Tile arithmetic (Web Mercator, the scheme Mapbox tiles use) ────────────

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

/** Tiles Mapbox will fetch for `bounds` across `minZoom..maxZoom` inclusive. */
export const countTiles = (bounds: LngLatBounds, minZoom: number, maxZoom: number): number => {
  const [[west, south], [east, north]] = bounds;
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const cols = lngToTileX(east, z) - lngToTileX(west, z) + 1;
    // Tile y grows SOUTHWARD, so north gives the smaller index.
    const rows = latToTileY(south, z) - latToTileY(north, z) + 1;
    total += Math.max(0, cols) * Math.max(0, rows);
  }
  return total;
};

export const BASE_MAP_TILES = countTiles(FLORIDA_BOUNDS, BASE_MIN_ZOOM, BASE_MAX_ZOOM);

// ─── Lead area cells ─────────────────────────────────────────────────────────

export interface AreaCell {
  /** Stable pack name — the same cell always has the same name, so it is never re-downloaded. */
  name: string;
  bounds: LngLatBounds;
  /** How many leads this cell covers (including ones pulled in from a neighbouring edge). */
  leadCount: number;
  tiles: number;
}

const cellIndex = (deg: number): number => Math.floor(deg / AREA_CELL_DEG);

/** The cell's exact grid box. Rounded so float noise cannot give one cell two different boxes. */
const cellBounds = (ix: number, iy: number): LngLatBounds => {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return [
    [r(ix * AREA_CELL_DEG), r(iy * AREA_CELL_DEG)],
    [r((ix + 1) * AREA_CELL_DEG), r((iy + 1) * AREA_CELL_DEG)],
  ];
};

export const areaPackName = (ix: number, iy: number): string => `${AREA_PACK_PREFIX}${ix}_${iy}`;

/**
 * A lead's `[lng, lat]`, or null. Rejects Null Island (a GPS fix that never arrived), NaN, and
 * anything off the Mercator grid — a `0,0` lead would otherwise download a cell in the Atlantic.
 */
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

/**
 * The grid cells covering these leads, busiest first. A lead within `AREA_EDGE_PAD_MILES` of a cell
 * edge also counts toward the neighbouring cell(s).
 */
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

/**
 * Which cells to keep, within the tile budget the base map leaves.
 *
 * `wanted` (cells the current leads need) outranks `existing` (cells already on the device that
 * the current leads do not mention). An existing cell is kept while budget remains, and evicted
 * only to make room — so opening a FILTERED map view cannot delete the street map for the rest of
 * the rep's route.
 */
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
  // Only cells that are actually on the device can be evicted; a wanted cell that did not fit was
  // simply never downloaded.
  const existingNames = new Set(existing.map((c) => c.name));
  return { keep, evict: evict.filter((c) => existingNames.has(c.name)) };
};

export const areaLabel = (leadCount: number): string =>
  `Lead area · ${leadCount} lead${leadCount === 1 ? '' : 's'}`;
