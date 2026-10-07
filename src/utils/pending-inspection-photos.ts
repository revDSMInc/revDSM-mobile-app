import { norm } from '../widgets/components/lead-center/dynamic-inspection-schema-utils';

export interface PendingUpload {
  id: string;
  leadId: string;
  categoryName: string;
  subcategory: string;
  uri: string;
  timestamp?: string;
}

export const slotKeyOf = (categoryName: string, subcategory: string): string =>
  `${norm(categoryName)}||${norm(subcategory)}`;

const isAnnotated = (subcategory: unknown): boolean =>
  String(subcategory ?? '').toLowerCase().includes('(annotated)');

export const indexPendingBySlot = (
  items: PendingUpload[] | null | undefined,
  leadId: string | null | undefined
): Map<string, PendingUpload[]> => {
  const out = new Map<string, PendingUpload[]>();
  if (!leadId) return out;
  (items || []).forEach((it) => {
    if (!it || it.leadId !== leadId || !it.uri) return;
    if (isAnnotated(it.subcategory)) return;
    const k = slotKeyOf(it.categoryName, it.subcategory);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  });
  return out;
};

export interface PendingPhotoView {
  secureUrl: string;
  subcategory: string;
  isPending: true;
  isOptimistic: true;
  pendingId: string;
  timestampTaken?: string;
}

const toView = (it: PendingUpload): PendingPhotoView => ({
  secureUrl: it.uri,
  subcategory: it.subcategory,
  isPending: true,
  isOptimistic: true,
  pendingId: it.id,
  timestampTaken: it.timestamp,
});

export const mergePendingForSlot = <T,>(
  serverPhotos: T[] | null | undefined,
  pending: PendingUpload[] | null | undefined
): (T | PendingPhotoView)[] => {
  const server = Array.isArray(serverPhotos) ? serverPhotos : [];
  const queued = Array.isArray(pending) ? pending : [];
  const surplus = queued.length - server.length;
  if (surplus <= 0) return server;
  return [...server, ...queued.slice(queued.length - surplus).map(toView)];
};

export const countWithPending = (
  serverCountBySlot: Map<string, number> | Record<string, number>,
  pendingBySlot: Map<string, PendingUpload[]>
): number => {
  const get = (k: string): number =>
    serverCountBySlot instanceof Map
      ? serverCountBySlot.get(k) || 0
      : Number((serverCountBySlot as any)?.[k]) || 0;

  let total = 0;
  const counted = new Set<string>();
  pendingBySlot.forEach((items, k) => {
    counted.add(k);
    total += Math.max(get(k), items.length);
  });
  if (serverCountBySlot instanceof Map) {
    serverCountBySlot.forEach((n, k) => {
      if (!counted.has(k)) total += n;
    });
  } else {
    Object.entries(serverCountBySlot || {}).forEach(([k, n]) => {
      if (!counted.has(k)) total += Number(n) || 0;
    });
  }
  return total;
};

export type PendingStatus = 'saved-offline' | 'uploading' | 'queued';

export interface PendingStatusView {
  status: PendingStatus;
  label: string;
  icon: string;
  color: string;
  spinner: boolean;
}

export const pendingStatusFor = (
  isActiveUpload: boolean,
  online: boolean
): PendingStatusView => {
  if (!online) {
    return {
      status: 'saved-offline',
      label: 'Saved on device',
      icon: 'cloud-off-outline',
      color: '#9CA3AF',
      spinner: false,
    };
  }
  if (isActiveUpload) {
    return { status: 'uploading', label: 'Uploading…', icon: 'cloud-upload', color: '#F59E0B', spinner: true };
  }
  return {
    status: 'queued',
    label: 'Waiting to upload',
    icon: 'cloud-upload-outline',
    color: '#F59E0B',
    spinner: false,
  };
};

export type PhotoTileState = 'ready' | 'unavailable' | 'loading';

export const photoTileState = (
  uri: string | undefined | null,
  warmedUri: string | undefined | null,
  online: boolean
): PhotoTileState => {
  if (!uri) return 'unavailable';
  if (warmedUri) return 'ready';
  if (!/^https?:\/\//i.test(uri)) return 'ready';
  return online ? 'loading' : 'unavailable';
};

export interface PendingSectionPhoto extends PendingPhotoView {
  uri: string;
  id: string;
  index: number;
  category: string;
}

export const mergePendingIntoSections = <T,>(
  sections: Record<string, T[]> | null | undefined,
  pending: PendingUpload[] | null | undefined,
  leadId: string | null | undefined
): Record<string, (T | PendingSectionPhoto)[]> => {
  const base = (sections || {}) as Record<string, T[]>;
  const queued = (pending || []).filter(
    (it) => it && it.leadId === leadId && it.uri && !isAnnotated(it.subcategory)
  );
  if (!leadId || queued.length === 0) return base;

  const catOf = (name: string): string => norm(String(name || '').split('—')[0]);

  const byCat = new Map<string, PendingUpload[]>();
  queued.forEach((it) => {
    const k = catOf(it.categoryName);
    const list = byCat.get(k);
    if (list) list.push(it);
    else byCat.set(k, [it]);
  });

  const out: Record<string, (T | PendingSectionPhoto)[]> = { ...base };
  const keyFor = new Map(Object.keys(base).map((k) => [norm(k), k]));

  byCat.forEach((items, cat) => {
    const mapKey = keyFor.get(cat) || items[0].categoryName.split('—')[0].trim();
    const server = (out[mapKey] || []) as T[];
    const surplus = items.length - server.length;
    if (surplus <= 0) {
      out[mapKey] = server;
      return;
    }
    const add = items.slice(items.length - surplus).map((it, n) => ({
      ...toView(it),
      uri: it.uri,
      id: it.id,
      index: server.length + n,
      category: mapKey,
    }));
    out[mapKey] = [...server, ...add];
  });

  return out;
};

// ─── Folding pending photos into a lead's `salesPhotos` ──────────────────────

/**
 * Project the queue into the PHOTO-RECORD shape, so a screen that reads `lead.salesPhotos` sees
 * the door shots too.
 *
 * ⚠️ `buildInspectionSections` resolves a photo with `uriByS3[p.s3url] || p.secureUrl || p.uri`
 * and groups by `category` / `subcategory` — so those four fields are the whole contract. A
 * queued upload has no `s3url` and no `secureUrl`; `uri` is the local `file://` copy, which is
 * exactly what the third fallback exists for.
 */
export const pendingAsSalesPhotos = (
  pending: PendingUpload[] | null | undefined,
  leadId: string | null | undefined
): Array<Record<string, unknown>> => {
  if (!leadId) return [];
  return (pending || [])
    .filter((it) => it && it.leadId === leadId && it.uri && !isAnnotated(it.subcategory))
    .map((it) => ({
      uri: it.uri,
      category: it.categoryName,
      subcategory: it.subcategory,
      timestampTaken: it.timestamp,
      isPending: true,
      pendingId: it.id,
    }));
};

/**
 * A lead's server photos plus any queued shot the server does not yet account for.
 *
 * ⚠️ The SAME surplus rule as `mergePendingForSlot`, applied per SLOT rather than to the whole
 * list: a queue item survives until its upload succeeds and the lead refetch can land first, so
 * for a moment the photo is in both. Comparing whole-list counts would be wrong the instant one
 * slot uploads ahead of another — the surplus has to be worked out where the photos actually
 * correspond, which is the slot.
 *
 * Returns the SAME array when nothing is pending, so callers keep their memo identity.
 */
export const salesPhotosWithPending = <T extends Record<string, any>>(
  serverPhotos: T[] | null | undefined,
  pending: PendingUpload[] | null | undefined,
  leadId: string | null | undefined
): Array<T | Record<string, unknown>> => {
  const server = Array.isArray(serverPhotos) ? serverPhotos : [];
  const queued = pendingAsSalesPhotos(pending, leadId);
  if (queued.length === 0) return server;

  const slotOf = (cat: unknown, sub: unknown) => slotKeyOf(String(cat ?? ''), String(sub ?? ''));

  const serverBySlot = new Map<string, number>();
  server.forEach((p) => {
    const k = slotOf(p.category, p.subcategory);
    serverBySlot.set(k, (serverBySlot.get(k) || 0) + 1);
  });

  const add: Array<Record<string, unknown>> = [];
  const seen = new Map<string, number>();
  queued.forEach((q) => {
    const k = slotOf(q.category, q.subcategory);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    // Only the items BEYOND what the server already shows for this slot.
    if (n > (serverBySlot.get(k) || 0)) add.push(q);
  });

  return add.length === 0 ? server : [...server, ...add];
};
