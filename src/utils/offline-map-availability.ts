/**
 * offline-map-availability.ts — WHAT to tell the rep when the map cannot draw itself.
 *
 * The map is the one screen that degrades silently. Everything else offline either shows cached
 * content or a queued badge; Mapbox just renders an empty grey canvas, and the only thing the rep
 * saw was the axios banner from some unrelated request ("Network Error"). Standing on a doorstep
 * that reads as the app being broken.
 *
 * Three facts decide the message, and they are independent:
 *
 *   | fact | source |
 *   |---|---|
 *   | is the device reachable | `services/connectivity` (three-state model) |
 *   | is the base map downloaded | `offlineMapManager.getSummary().base` |
 *   | is THIS doorstep inside a downloaded street cell | the area pack bounds |
 *
 * ⚠️ Offline does NOT mean "no map". A complete base pack still draws towns, highways and the
 * pin — enough to see which side of town the lead is on. Saying "needs internet" over a map the
 * rep can actually use would be a worse lie than saying nothing. Only `none` is a blocking state.
 *
 * ⚠️ Satellite is never available offline, at any zoom. Mapbox packs are downloaded against ONE
 * style (`styleKey: 'Street'` — see `offlineMapManager`), and imagery tiles are not in it. The
 * toggle therefore needs its own answer rather than being folded into the coverage tiers.
 *
 * Pure and RN-free so it is testable: anything importing `@rnmapbox/maps` cannot load under jest
 * here (see CLAUDE.md §6). The screens do the I/O and pass the facts in.
 */

import type { LngLat, LngLatBounds } from './offline-map-regions';

/** What the device can actually draw right now. */
export type MapCoverage =
  /** Online — Mapbox streams whatever it needs. */
  | 'live'
  /** Offline, street cell covers this point — full detail, same as online bar imagery. */
  | 'street'
  /** Offline, base pack only — towns and highways, no street detail at this doorstep. */
  | 'base'
  /** Offline and nothing downloaded — a grey canvas. The only blocking state. */
  | 'none';

export interface PackLike {
  bounds: LngLatBounds;
  status: string;
  kind?: string;
}

/** A pack only helps if it finished. A half-downloaded cell has arbitrary holes in it. */
export const isUsablePack = (pack: PackLike | null | undefined): boolean =>
  !!pack && pack.status === 'complete';

/**
 * Is `[lng, lat]` inside this pack's box? Inclusive on both edges — a point on a shared boundary
 * is covered by both neighbours, which is the safe direction (the pad in `areaCellsForLeads`
 * downloads both).
 */
export const pointInBounds = (point: LngLat, bounds: LngLatBounds): boolean => {
  const [[swLng, swLat], [neLng, neLat]] = bounds;
  const [lng, lat] = point;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return lng >= swLng && lng <= neLng && lat >= swLat && lat <= neLat;
};

/**
 * Resolve the three facts into one coverage tier.
 *
 * `point` null (a lead with no coordinates, or the map opened on the rep's own position before the
 * first GPS fix) falls back to the base pack: we cannot prove street coverage, and claiming it
 * would promise detail that is not there.
 */
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
  /** Null when there is nothing worth saying — never interrupt a working map. */
  tone: 'info' | 'warning' | null;
  title: string;
  body: string;
  /** True only when the map cannot draw at all, so the caller can cover the canvas. */
  blocking: boolean;
}

/**
 * The rep-facing wording. Written for someone standing at a door with a customer watching, so it
 * says what still works before what does not, and never uses the words "error" or "failed" — the
 * map being offline is an expected state out in the field, not a fault.
 */
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

/**
 * Satellite is its own axis: the toggle is live-only whatever the coverage tier, because packs
 * hold street tiles only. Returned separately so the caller can disable the toggle AND explain it
 * rather than letting the rep tap into a grey screen.
 */
export const satelliteNotice = (online: boolean): CoverageNotice =>
  online
    ? { tone: null, title: '', body: '', blocking: false }
    : {
        tone: 'info',
        title: 'Satellite needs internet',
        body: 'Aerial imagery is not saved for offline use. The street map is still available.',
        blocking: false,
      };
