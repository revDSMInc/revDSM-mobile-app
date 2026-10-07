import Mapbox from '@rnmapbox/maps';
import { registerSessionResetHook } from './sessionScope';
import { isOnWifi } from './connectivity';

import { Storage } from '../utils/storage';
import {
  AREA_MAX_ZOOM,
  AREA_MIN_ZOOM,
  AREA_PACK_PREFIX,
  BASE_MAP_LABEL,
  BASE_MAP_PACK_NAME,
  BASE_MAX_ZOOM,
  BASE_MIN_ZOOM,
  FLORIDA_BOUNDS,
  LEGACY_LEAD_PACK_PREFIX,
  TILE_COUNT_LIMIT,
  areaCellsForLeads,
  areaLabel,
  selectAreaCells,
  type AreaCell,
  type LngLatBounds,
} from '../utils/offline-map-regions';

export type OfflinePackKind = 'base' | 'area';

export interface OfflinePackRecord {
  name: string;
  kind: OfflinePackKind;
  label: string;
  leadCount: number;
  leadId: string | null;
  bounds: LngLatBounds;
  styleKey: string;
  minZoom: number;
  maxZoom: number;
  startedAt: number;
  completedAt: number;
  percentage: number;
  completedResourceSize: number;
  status: 'queued' | 'active' | 'paused' | 'complete' | 'error';
}

export interface PackProgressSnapshot {
  name: string;
  percentage: number;
  completedResourceSize: number;
  requiredResourceCount: number;
  completedResourceCount: number;
  state: number;
}

export interface OfflineMapSummary {
  base: OfflinePackRecord | null;
  areas: {
    count: number;
    leadCount: number;
    bytes: number;
    downloading: number;
    queued: number;
    failed: number;
  };
  totalBytes: number;
}

type PackProgressListener = (name: string, snapshot: PackProgressSnapshot) => void;
type PackErrorListener = (name: string, error: { name: string; message: string }) => void;

type LeadLike = { _id?: string; location?: { coordinates?: unknown } };

const BASE_STORAGE_KEY = 'offline-map-base-packs';

const AREA_STORAGE_KEY = 'offline-map-packs';

const PROGRESS_THROTTLE_MS = 500;

const AMBIENT_CACHE_BYTES = 50 * 1024 * 1024;

const STALL_TIMEOUT_MS = 2 * 60 * 1000;

const readKey = (key: string): OfflinePackRecord[] => {
  try {
    const raw = Storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeKey = (key: string, records: OfflinePackRecord[]): void => {
  try {
    Storage.setItem(key, JSON.stringify(records));
  } catch (e) {
    console.warn('[offlineMap] failed to persist pack registry:', e);
  }
};

const keyFor = (name: string): string => (name === BASE_MAP_PACK_NAME ? BASE_STORAGE_KEY : AREA_STORAGE_KEY);

const readRegistry = (): OfflinePackRecord[] => [...readKey(BASE_STORAGE_KEY), ...readKey(AREA_STORAGE_KEY)];

const getRecordByName = (name: string): OfflinePackRecord | null =>
  readKey(keyFor(name)).find((r) => r.name === name) ?? null;

const upsertRecord = (record: OfflinePackRecord): void => {
  const key = keyFor(record.name);
  const all = readKey(key);
  const idx = all.findIndex((r) => r.name === record.name);
  if (idx >= 0) all[idx] = record;
  else all.push(record);
  writeKey(key, all);
};

const patchRecord = (name: string, patch: Partial<OfflinePackRecord>): void => {
  const current = getRecordByName(name);
  if (current) upsertRecord({ ...current, ...patch });
};

const removeRecord = (name: string): void => {
  const key = keyFor(name);
  writeKey(key, readKey(key).filter((r) => r.name !== name));
};

const newRecord = (
  name: string,
  kind: OfflinePackKind,
  label: string,
  leadCount: number,
  bounds: LngLatBounds,
  minZoom: number,
  maxZoom: number,
): OfflinePackRecord => ({
  name,
  kind,
  label,
  leadCount,
  leadId: null,
  bounds,
  styleKey: 'Street',
  minZoom,
  maxZoom,
  startedAt: 0,
  completedAt: 0,
  percentage: 0,
  completedResourceSize: 0,
  status: 'queued',
});

const recordToCell = (r: OfflinePackRecord): AreaCell => ({
  name: r.name,
  bounds: r.bounds,
  leadCount: r.leadCount || 0,
  tiles: 0, // re-measured by `areaCellsForLeads` for wanted cells; an existing cell only needs its name
});

class OfflineMapManager {
  private _progressListeners = new Set<PackProgressListener>();
  private _errorListeners = new Set<PackErrorListener>();
  private _initialized = false;

  private _queue: string[] = [];
  private _pumping = false;
  private _current: string | null = null;

  async init(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
    try {
      Mapbox.offlineManager.setProgressEventThrottle(PROGRESS_THROTTLE_MS);
      Mapbox.offlineManager.setTileCountLimit(TILE_COUNT_LIMIT);
      await Mapbox.offlineManager.setMaximumAmbientCacheSize(AMBIENT_CACHE_BYTES);
    } catch (e) {
      console.warn('[offlineMap] init failed:', e);
    }
    readRegistry()
      .filter((r) => r.status === 'active')
      .forEach((r) => patchRecord(r.name, { status: 'paused' }));
    await this._purgeLegacyPacks();
  }

  private async _purgeLegacyPacks(): Promise<void> {
    const names = new Set(
      readKey(AREA_STORAGE_KEY)
        .filter((r) => r.name.startsWith(LEGACY_LEAD_PACK_PREFIX))
        .map((r) => r.name),
    );
    try {
      const packs = await Mapbox.offlineManager.getPacks();
      packs.forEach((p: any) => {
        const n = p?.name;
        if (typeof n === 'string' && n.startsWith(LEGACY_LEAD_PACK_PREFIX)) names.add(n);
      });
    } catch {
    }
    for (const name of names) {
      try {
        await Mapbox.offlineManager.deletePack(name);
      } catch {
      }
      removeRecord(name);
    }
  }

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

  ensureBaseMap(): void {
    const existing = getRecordByName(BASE_MAP_PACK_NAME);
    if (existing?.status === 'complete') return;
    if (!existing) {
      upsertRecord(
        newRecord(BASE_MAP_PACK_NAME, 'base', BASE_MAP_LABEL, 0, FLORIDA_BOUNDS, BASE_MIN_ZOOM, BASE_MAX_ZOOM),
      );
    }
    this._enqueue(BASE_MAP_PACK_NAME, true);
  }

  async syncLeads(leads: readonly LeadLike[] | null | undefined): Promise<void> {
    await this.init();
    this.ensureBaseMap();

    const wanted = areaCellsForLeads(leads);
    const existing = readKey(AREA_STORAGE_KEY).map(recordToCell);
    const { keep, evict } = selectAreaCells(wanted, existing);

    for (const cell of evict) {
      await this.deletePack(cell.name);
    }

    const wantedByName = new Map(wanted.map((c) => [c.name, c]));
    for (const cell of keep) {
      const fresh = wantedByName.get(cell.name);
      const record = getRecordByName(cell.name);
      if (!record && fresh) {
        upsertRecord(
          newRecord(fresh.name, 'area', areaLabel(fresh.leadCount), fresh.leadCount, fresh.bounds, AREA_MIN_ZOOM, AREA_MAX_ZOOM),
        );
      } else if (record && fresh && record.leadCount !== fresh.leadCount) {
        patchRecord(cell.name, { leadCount: fresh.leadCount, label: areaLabel(fresh.leadCount) });
      }
      const after = getRecordByName(cell.name);
      if (after && after.status !== 'complete') this._enqueue(cell.name);
    }
    void this._pump();
  }

  async resumeAllPaused(): Promise<void> {
    await this.init();
    readRegistry()
      .filter((r) => r.status === 'paused' || r.status === 'queued')
      .forEach((r) => this._enqueue(r.name, r.kind === 'base'));
    void this._pump();
  }

  async deletePack(name: string): Promise<void> {
    this._queue = this._queue.filter((n) => n !== name);
    try {
      Mapbox.offlineManager.unsubscribe(name);
    } catch {
    }
    try {
      await Mapbox.offlineManager.deletePack(name);
    } catch (e) {
      console.warn(`[offlineMap] deletePack("${name}") failed:`, e);
    }
    removeRecord(name);
  }

  async deleteAllAreas(): Promise<void> {
    for (const r of readKey(AREA_STORAGE_KEY)) {
      await this.deletePack(r.name);
    }
  }

  deleteAllPacksForSessionEnd(): void {
    const names = readKey(AREA_STORAGE_KEY).map((r) => r.name);
    this._queue = this._queue.filter((n) => n === BASE_MAP_PACK_NAME);
    if (!names.length) return;
    void (async () => {
      for (const name of names) {
        try {
          Mapbox.offlineManager.unsubscribe(name);
          await Mapbox.offlineManager.deletePack(name);
        } catch (e) {
          console.warn(`[offlineMap] could not delete "${name}" on session end`, e);
        }
      }
    })();
  }

  getRecord(name: string): OfflinePackRecord | null {
    return getRecordByName(name);
  }

  getAllRecords(): OfflinePackRecord[] {
    return readRegistry();
  }

  totalDownloadedBytes(): number {
    return readRegistry().reduce((sum, r) => sum + (r.completedResourceSize || 0), 0);
  }

  getSummary(): OfflineMapSummary {
    const areas = readKey(AREA_STORAGE_KEY).filter((r) => r.name.startsWith(AREA_PACK_PREFIX));
    return {
      base: getRecordByName(BASE_MAP_PACK_NAME),
      areas: {
        count: areas.length,
        leadCount: areas.reduce((s, r) => s + (r.leadCount || 0), 0),
        bytes: areas.reduce((s, r) => s + (r.completedResourceSize || 0), 0),
        downloading: areas.filter((r) => r.status === 'active').length,
        queued: areas.filter((r) => r.status === 'queued' || r.status === 'paused').length,
        failed: areas.filter((r) => r.status === 'error').length,
      },
      totalBytes: this.totalDownloadedBytes(),
    };
  }

  private _enqueue(name: string, front = false): void {
    if (this._current === name || this._queue.includes(name)) return;
    if (front) this._queue.unshift(name);
    else this._queue.push(name);
  }

  private async _pump(): Promise<void> {
    if (this._pumping) return;
    this._pumping = true;
    try {
      await this.init();
      while (this._queue.length) {
        // Stop — do not drain — off Wi-Fi. Everything left stays queued for the next Wi-Fi sync.
        if (!isOnWifi()) break;
        const name = this._queue.shift()!;
        const record = getRecordByName(name);
        if (!record || record.status === 'complete') continue;
        this._current = name;
        try {
          await this._download(record);
        } finally {
          this._current = null;
        }
      }
    } finally {
      this._pumping = false;
    }
  }

  private _download(record: OfflinePackRecord): Promise<void> {
    const { name } = record;
    return new Promise<void>((resolve) => {
      let settled = false;
      let stallTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (patch: Partial<OfflinePackRecord>) => {
        if (settled) return;
        settled = true;
        if (stallTimer) clearTimeout(stallTimer);
        try {
          Mapbox.offlineManager.unsubscribe(name);
        } catch {
        }
        patchRecord(name, patch);
        resolve();
      };

      const armStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => finish({ status: 'paused' }), STALL_TIMEOUT_MS);
      };

      const onProgress = (_pack: unknown, status: PackProgressSnapshot) => {
        armStall();
        const done = status.percentage >= 100;
        patchRecord(name, {
          percentage: status.percentage,
          completedResourceSize: status.completedResourceSize,
          status: done ? 'complete' : 'active',
          completedAt: done ? Date.now() : 0,
        });
        this._progressListeners.forEach((l) => {
          try {
            l(name, { ...status, name });
          } catch (e) {
            console.warn('[offlineMap] progress listener threw:', e);
          }
        });
        if (done) finish({ status: 'complete', percentage: 100, completedAt: Date.now() });
      };

      const onError = (_pack: unknown, err: { name: string; message: string }) => {
        this._errorListeners.forEach((l) => {
          try {
            l(name, err);
          } catch (e) {
            console.warn('[offlineMap] error listener threw:', e);
          }
        });
        finish({ status: 'error' });
      };

      patchRecord(name, { status: 'active', startedAt: record.startedAt || Date.now() });
      armStall();

      void (async () => {
        try {
          const existing = await Mapbox.offlineManager.getPack(name).catch(() => undefined);
          if (existing) {
            const st: any = await existing.status().catch(() => null);
            if (st && st.percentage >= 100) {
              finish({
                status: 'complete',
                percentage: 100,
                completedResourceSize: st.completedResourceSize || record.completedResourceSize,
                completedAt: Date.now(),
              });
              return;
            }
            await Mapbox.offlineManager.subscribe(name, onProgress as any, onError as any);
            await existing.resume();
            return;
          }
          await Mapbox.offlineManager.createPack(
            {
              name,
              styleURL: resolveStyleURL(record.styleKey),
              bounds: [record.bounds[1], record.bounds[0]] as any, // Mapbox takes [ne, sw]
              minZoom: record.minZoom,
              maxZoom: record.maxZoom,
            },
            onProgress as any,
            onError as any,
          );
        } catch (e) {
          console.warn(`[offlineMap] download("${name}") failed:`, e);
          finish({ status: 'error' });
        }
      })();
    });
  }
}

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

export const offlineMapManager = new OfflineMapManager();

registerSessionResetHook(() => offlineMapManager.deleteAllPacksForSessionEnd());
