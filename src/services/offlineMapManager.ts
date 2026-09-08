/**
 * offlineMapManager.ts — wraps Mapbox offlineManager for lead-radius packs.
 *
 * Each pack is a region of map tiles downloaded to disk so the rep can still see
 * pins, streets and satellite imagery when they lose signal in the field.  Packs
 * are keyed by lead id (`lead-{leadId}`) or by a manual timestamp (`manual-{ts}`)
 * and their metadata is persisted in MMKV so the Profile UI can list them.
 *
 * ⚠️  Mapbox tile limits apply.  `setTileCountLimit` is called once on init to
 * stay within the Mapbox TOS cap.  Each lead-radius pack at default zoom is a
 * modest region; the limit is enforced app-wide by Mapbox internally.
 *
 * Callers interact through the single `offlineMapManager` export — no other
 * handle to `Mapbox.offlineManager` should exist in app code.
 */

import Mapbox from '@rnmapbox/maps';

import { Storage } from '../utils/storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Serialisable metadata persisted in MMKV for every pack. */
export interface OfflinePackRecord {
  /** Pack name used as the Mapbox key — `lead-{leadId}` or `manual-{ts}`. */
  name: string;
  /** Lead id when the pack was created for a lead, or null for manual packs. */
  leadId: string | null;
  /** `[southWest, northEast]` in `[lng, lat]` (GeoJSON positions). */
  bounds: [GeoJSON.Position, GeoJSON.Position];
  /** Mapbox style URL key — e.g. "Street", "SatelliteStreet", "Dark". */
  styleKey: string;
  minZoom: number;
  maxZoom: number;
  /** `Date.now()` when the download was started. */
  startedAt: number;
  /** `Date.now()` when the download completed (0 while in-progress). */
  completedAt: number;
  /** Last known percentage (0-100) from the progress listener. */
  percentage: number;
  /** Byte estimate of downloaded resources. */
  completedResourceSize: number;
  /** `"active"` | `"paused"` | `"complete"` | `"error"`. */
  status: 'active' | 'paused' | 'complete' | 'error';
}

/** Snapshot of progress delivered to UI listeners. */
export interface PackProgressSnapshot {
  name: string;
  percentage: number;
  completedResourceSize: number;
  requiredResourceCount: number;
  completedResourceCount: number;
  state: number;
}

type PackProgressListener = (name: string, snapshot: PackProgressSnapshot) => void;
type PackErrorListener = (name: string, error: { name: string; message: string }) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** MMKV key for the JSON-serialised pack registry. */
const STORAGE_KEY = 'offline-map-packs';

/** Default radius in miles around a lead's location. */
export const DEFAULT_RADIUS_MILES = 10;

/** Default zoom range — conservative to keep tile counts manageable. */
const DEFAULT_MIN_ZOOM = 0;
const DEFAULT_MAX_ZOOM = 16;

/** Throttle in ms for progress events from Mapbox. */
const PROGRESS_THROTTLE_MS = 300;

/** Max tile count enforced on the Mapbox SDK (Mapbox TOS cap). */
const TILE_COUNT_LIMIT = 6_000;

// ---------------------------------------------------------------------------
// Helpers — geometry
// ---------------------------------------------------------------------------

/**
 * Convert miles to degrees of latitude / longitude.
 *
 * 1° lat ≈ 69 miles everywhere.
 * 1° lng ≈ 69 miles × cos(lat).
 */
const milesToDegrees = (
  miles: number,
  centreLat: number,
): { latDelta: number; lngDelta: number } => {
  const latDelta = miles / 69;
  const lngDelta = miles / (69 * Math.cos((centreLat * Math.PI) / 180));
  return { latDelta, lngDelta };
};

/**
 * Build a bounding box `[[south, west], [north, east]]` (GeoJSON positions)
 * around `centreLng, centreLat` with the given radius in miles.
 */
export const buildBoundingBox = (
  centreLng: number,
  centreLat: number,
  radiusMiles: number = DEFAULT_RADIUS_MILES,
): [GeoJSON.Position, GeoJSON.Position] => {
  const { latDelta, lngDelta } = milesToDegrees(radiusMiles, centreLat);
  return [
    [centreLng - lngDelta, centreLat - latDelta], // south-west
    [centreLng + lngDelta, centreLat + latDelta], // north-east
  ];
};

// ---------------------------------------------------------------------------
// Helpers — MMKV registry
// ---------------------------------------------------------------------------

const readRegistry = (): OfflinePackRecord[] => {
  try {
    const raw = Storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeRegistry = (records: OfflinePackRecord[]): void => {
  try {
    Storage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.warn('[offlineMap] failed to persist pack registry:', e);
  }
};

const upsertRecord = (record: OfflinePackRecord): void => {
  const all = readRegistry();
  const idx = all.findIndex((r) => r.name === record.name);
  if (idx >= 0) {
    all[idx] = record;
  } else {
    all.push(record);
  }
  writeRegistry(all);
};

const removeRecord = (name: string): void => {
  writeRegistry(readRegistry().filter((r) => r.name !== name));
};

// ---------------------------------------------------------------------------
// Helpers — pack naming
// ---------------------------------------------------------------------------

export const leadPackName = (leadId: string): string => `lead-${leadId}`;
export const manualPackName = (suffix?: string): string =>
  `manual-${suffix ?? Date.now()}`;

// ---------------------------------------------------------------------------
// Class — singleton
// ---------------------------------------------------------------------------

class OfflineMapManager {
  /** In-flight subscriptions so we can tear them down. */
  private _activeSubscriptions = new Set<string>();

  /** Event emitter for progress updates. */
  private _progressListeners = new Set<PackProgressListener>();

  /** Event emitter for errors. */
  private _errorListeners = new Set<PackErrorListener>();

  /** Guards against double init. */
  private _initialized = false;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * One-time setup: throttle, tile limit, ambient cache size.
   * Safe to call multiple times (idempotent).
   */
  async init(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    try {
      Mapbox.offlineManager.setProgressEventThrottle(PROGRESS_THROTTLE_MS);
      Mapbox.offlineManager.setTileCountLimit(TILE_COUNT_LIMIT);
      // 100 MB ambient cache — covers the visible area while panning before
      // tiles are explicitly downloaded.
      await Mapbox.offlineManager.setMaximumAmbientCacheSize(100 * 1024 * 1024);
    } catch (e) {
      console.warn('[offlineMap] init failed:', e);
    }
  }

  // -----------------------------------------------------------------------
  // Event emitter
  // -----------------------------------------------------------------------

  onPackProgress = (listener: PackProgressListener): (() => void) => {
    this._progressListeners.add(listener);
    return () => {
      this._progressListeners.delete(listener);
    };
  };

  onPackError = (listener: PackErrorListener): (() => void) => {
    this._errorListeners.add(listener);
    return () => {
      this._errorListeners.delete(listener);
    };
  };

  // -----------------------------------------------------------------------
  // Pack CRUD
  // -----------------------------------------------------------------------

  /**
   * Download map tiles for a region surrounding a lead's GPS location.
   *
   * If a pack with the same name already exists and is complete this is a no-op.
   * If it exists but errored or is in-progress the existing download is NOT
   * restarted — the caller should check `getRecord` first.
   */
  async downloadLeadPack(
    leadId: string,
    coordinates: [number, number], // [lng, lat]
    opts?: {
      radiusMiles?: number;
      styleKey?: string;
      minZoom?: number;
      maxZoom?: number;
    },
  ): Promise<void> {
    const name = leadPackName(leadId);
    const existing = this.getRecord(name);
    if (existing && (existing.status === 'complete' || existing.status === 'active')) {
      return;
    }

    const [lng, lat] = coordinates;
    const radiusMiles = opts?.radiusMiles ?? DEFAULT_RADIUS_MILES;
    const bounds = buildBoundingBox(lng, lat, radiusMiles);
    const styleKey = opts?.styleKey ?? 'Street';
    const minZoom = opts?.minZoom ?? DEFAULT_MIN_ZOOM;
    const maxZoom = opts?.maxZoom ?? DEFAULT_MAX_ZOOM;

    const record: OfflinePackRecord = {
      name,
      leadId,
      bounds,
      styleKey,
      minZoom,
      maxZoom,
      startedAt: Date.now(),
      completedAt: 0,
      percentage: 0,
      completedResourceSize: 0,
      status: 'active',
    };
    upsertRecord(record);

    await this._startPack(record);
  }

  /**
   * Download map tiles for an arbitrary bounding box (manual / custom region).
   */
  async downloadManualPack(
    bounds: [GeoJSON.Position, GeoJSON.Position],
    opts?: {
      name?: string;
      styleKey?: string;
      minZoom?: number;
      maxZoom?: number;
    },
  ): Promise<string> {
    const name = opts?.name ?? manualPackName();
    const styleKey = opts?.styleKey ?? 'Street';
    const minZoom = opts?.minZoom ?? DEFAULT_MIN_ZOOM;
    const maxZoom = opts?.maxZoom ?? DEFAULT_MAX_ZOOM;

    const record: OfflinePackRecord = {
      name,
      leadId: null,
      bounds,
      styleKey,
      minZoom,
      maxZoom,
      startedAt: Date.now(),
      completedAt: 0,
      percentage: 0,
      completedResourceSize: 0,
      status: 'active',
    };
    upsertRecord(record);

    await this._startPack(record);
    return name;
  }

  /** Delete a pack from Mapbox and drop its metadata from MMKV. */
  async deletePack(name: string): Promise<void> {
    this._teardownSubscription(name);
    try {
      await Mapbox.offlineManager.deletePack(name);
    } catch (e) {
      console.warn(`[offlineMap] deletePack("${name}") failed:`, e);
    }
    removeRecord(name);
  }

  /** Pause a currently downloading pack. */
  async pausePack(name: string): Promise<void> {
    try {
      const pack = await Mapbox.offlineManager.getPack(name);
      if (pack) await pack.pause();
      const record = this.getRecord(name);
      if (record && record.status === 'active') {
        upsertRecord({ ...record, status: 'paused' });
      }
    } catch (e) {
      console.warn(`[offlineMap] pausePack("${name}") failed:`, e);
    }
  }

  /** Resume a paused pack. */
  async resumePack(name: string): Promise<void> {
    try {
      const pack = await Mapbox.offlineManager.getPack(name);
      if (pack) await pack.resume();
      const record = this.getRecord(name);
      if (record && record.status === 'paused') {
        upsertRecord({ ...record, status: 'active' });
      }
    } catch (e) {
      console.warn(`[offlineMap] resumePack("${name}") failed:`, e);
    }
  }

  /** Resume every paused pack. */
  async resumeAllPaused(): Promise<void> {
    const paused = this.getAllRecords().filter((r) => r.status === 'paused');
    for (const r of paused) {
      await this.resumePack(r.name);
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Read a single pack record from MMKV. */
  getRecord(name: string): OfflinePackRecord | null {
    return readRegistry().find((r) => r.name === name) ?? null;
  }

  /** Get all persisted pack records. */
  getAllRecords(): OfflinePackRecord[] {
    return readRegistry();
  }

  /** Get records for lead-specific packs only. */
  getLeadRecords(): OfflinePackRecord[] {
    return readRegistry().filter((r) => r.leadId !== null);
  }

  /** Get records for manually-created packs only. */
  getManualRecords(): OfflinePackRecord[] {
    return readRegistry().filter((r) => r.leadId === null);
  }

  /** Total bytes across all packs (for Profile UI display). */
  totalDownloadedBytes(): number {
    return readRegistry().reduce((sum, r) => sum + r.completedResourceSize, 0);
  }

  /** Number of active (downloading) packs. */
  activeCount(): number {
    return readRegistry().filter((r) => r.status === 'active').length;
  }

  // -----------------------------------------------------------------------
  // Convenience — download all visible leads
  // -----------------------------------------------------------------------

  /**
   * Given a list of leads with GPS coordinates, start downloads for any that
   * don't already have a complete pack.  Intended to be called from the
   * Wi-Fi reconnect handler or the map screen.
   */
  async syncLeads(
    leads: Array<{ _id: string; location?: { coordinates: [number, number] } }>,
    opts?: { radiusMiles?: number },
  ): Promise<void> {
    const tasks = leads
      .filter(
        (l) =>
          l.location?.coordinates &&
          l.location.coordinates[0] !== 0 &&
          l.location.coordinates[1] !== 0,
      )
      .map((l) => {
        const name = leadPackName(l._id);
        const existing = this.getRecord(name);
        if (existing?.status === 'complete') return null;

        return this.downloadLeadPack(
          l._id,
          l.location!.coordinates,
          { radiusMiles: opts?.radiusMiles },
        );
      })
      .filter(Boolean) as Promise<void>[];

    // Run sequentially to respect tile count limits.
    for (const task of tasks) {
      await task;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async _startPack(record: OfflinePackRecord): Promise<void> {
    await this.init();

    const styleURL = resolveStyleURL(record.styleKey);

    const options = {
      name: record.name,
      styleURL,
      bounds: record.bounds,
      minZoom: record.minZoom,
      maxZoom: record.maxZoom,
    };

    const progressListener = (
      _pack: unknown,
      status: {
        name: string;
        percentage: number;
        completedResourceSize: number;
        requiredResourceCount: number;
        completedResourceCount: number;
        state: number;
      },
    ) => {
      const snapshot: PackProgressSnapshot = {
        name: status.name,
        percentage: status.percentage,
        completedResourceSize: status.completedResourceSize,
        requiredResourceCount: status.requiredResourceCount,
        completedResourceCount: status.completedResourceCount,
        state: status.state,
      };

      // Update persisted record.
      const current = this.getRecord(record.name);
      if (current) {
        const isComplete = status.percentage >= 100;
        upsertRecord({
          ...current,
          percentage: status.percentage,
          completedResourceSize: status.completedResourceSize,
          status: isComplete ? 'complete' : current.status === 'paused' ? 'paused' : 'active',
          completedAt: isComplete ? Date.now() : 0,
        });
      }

      // Fan out to subscribers.
      this._progressListeners.forEach((l) => {
        try { l(record.name, snapshot); } catch (e) {
          console.warn('[offlineMap] progress listener threw:', e);
        }
      });

      // Cleanup subscription when done.
      if (status.percentage >= 100) {
        this._teardownSubscription(record.name);
      }
    };

    const errorListener = (_pack: unknown, err: { name: string; message: string }) => {
      const current = this.getRecord(record.name);
      if (current) {
        upsertRecord({ ...current, status: 'error' });
      }

      this._errorListeners.forEach((l) => {
        try { l(record.name, err); } catch (e) {
          console.warn('[offlineMap] error listener threw:', e);
        }
      });

      this._teardownSubscription(record.name);
    };

    try {
      await Mapbox.offlineManager.createPack(options, progressListener, errorListener);
      this._activeSubscriptions.add(record.name);
    } catch (e) {
      console.warn(`[offlineMap] createPack("${record.name}") failed:`, e);
      const current = this.getRecord(record.name);
      if (current) {
        upsertRecord({ ...current, status: 'error' });
      }
    }
  }

  private _teardownSubscription(name: string): void {
    if (this._activeSubscriptions.has(name)) {
      try { Mapbox.offlineManager.unsubscribe(name); } catch { /* ignore */ }
      this._activeSubscriptions.delete(name);
    }
  }
}

// ---------------------------------------------------------------------------
// Style URL resolution
// ---------------------------------------------------------------------------

/**
 * Mapbox expects a full `mapbox://styles/...` URL; we store a short key to
 * keep MMKV payloads small and readable.
 */
function resolveStyleURL(styleKey: string): string {
  switch (styleKey) {
    case 'SatelliteStreet':
      return 'mapbox://styles/mapbox/satellite-streets-v12';
    case 'Dark':
      return 'mapbox://styles/mapbox/dark-v11';
    case 'Light':
      return 'mapbox://styles/mapbox/light-v11';
    case 'Street':
    default:
      return 'mapbox://styles/mapbox/streets-v12';
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * App-wide singleton.  Import this, never `Mapbox.offlineManager` directly.
 *
 * @example
 * import { offlineMapManager } from '../services/offlineMapManager';
 * await offlineMapManager.downloadLeadPack(id, coords);
 */
export const offlineMapManager = new OfflineMapManager();
