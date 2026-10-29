/**
 * mapbox-log-noise.ts - Mapbox's native logger is not the app's error channel.
 *
 * `@rnmapbox/maps` forwards every native log through `console.error` (-> the red LogBox screen in dev) unless a log callback
 * returns true. An offline-region download that cannot reach Mapbox (weak cellular, a pack removed mid-download, a
 * tower hop) logs `Unable to fetch region for region-florida` at ERROR level - but `offlineMapManager` already receives the
 * same failure through the pack's `onError`, marks the area `error` (counted as `failed`) and lets the rep retry it. So the
 * native line is a duplicate report of something handled, and it showed as a full-screen "Console Error".
 *
 * Only these known, handled shapes are downgraded; any other native Mapbox error still reaches `console.error`.
 *
 * Pure so it can be tested.
 */

export interface MapboxLog {
  level?: string;
  tag?: string;
  message?: string;
}

const HANDLED_OFFLINE_RE =
  /unable to fetch region|offline region|offline pack|failed to (download|fetch) (tile|region|resource)|tile (request|download) failed|could not connect to the server|the internet connection appears to be offline|network connection was lost|request failed due to a permanent error/i;

export const isHandledMapboxLog = (log: MapboxLog | null | undefined): boolean => {
  if (!log || log.level !== 'error') return false;
  return HANDLED_OFFLINE_RE.test(`${log.tag || ''} ${log.message || ''}`);
};

/** The `Logger.setLogCallback` handler: true = "handled, skip the default console.error". */
export const mapboxLogCallback = (log: MapboxLog, sink: Pick<Console, 'log'> = console): boolean => {
  if (!isHandledMapboxLog(log)) return false;
  sink.log('[mapbox]', log.tag ? `${log.tag} |` : '', log.message);
  return true;
};
