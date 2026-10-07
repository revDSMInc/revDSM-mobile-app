/**
 * pending-inspection-photos.ts — folding NOT-YET-UPLOADED photos into the inspection views.
 *
 * A photo taken offline is written to the persistent MMKV upload queue and shown immediately by
 * whichever screen took it, via `useDynamicInspectionCapture`'s in-memory `capturedPreviews`.
 *
 * ⚠️ That preview is state on ONE mount of the hook, and Manage Photos mounts its own. So a rep who
 * shot three photos offline saw "Manage Photos (3)" on the Lead Center — which folds the queue in —
 * and then "Manage Photos (0)" with every tab at 0/N inside it, because the dynamic views read only
 * `lead.salesPhotos`, and offline there is nothing on the server yet. The photos were never lost;
 * they were queued and invisible, which is worse, because a rep who cannot see them will shoot them
 * again or assume the app dropped them.
 *
 * The queue is the right source: it is MMKV-backed, so unlike the preview it survives the modal
 * boundary, a screen change and an app restart — which are exactly the gaps offline opens up.
 *
 * Pure and RN-free so the handover rule can be tested; `useDynamicInspectionCapture` pulls in React
 * Native and the repo has no mock for the queue's storage.
 */

import { norm } from '../widgets/components/lead-center/dynamic-inspection-schema-utils';

/** The subset of `UploadQueueItem` this needs. Kept structural so the queue can evolve. */
export interface PendingUpload {
  id: string;
  leadId: string;
  /** Already product-scoped at enqueue time — `"Gutters/Roofline — HOME"`. */
  categoryName: string;
  subcategory: string;
  /** The local `file://` copy. This is what renders until the upload lands. */
  uri: string;
  timestamp?: string;
}

/** `photosBySubcat`'s key shape, so pending and server photos index the same way. */
export const slotKeyOf = (categoryName: string, subcategory: string): string =>
  `${norm(categoryName)}||${norm(subcategory)}`;

/** True for the annotated COPY of a photo, which belongs to its own section, not a slot. */
const isAnnotated = (subcategory: unknown): boolean =>
  String(subcategory ?? '').toLowerCase().includes('(annotated)');

/**
 * The lead's pending uploads, grouped by slot.
 *
 * ⚠️ Scoped to `leadId`. The queue is app-wide and can hold work for several leads at once — a rep
 * shoots one lead, drives to the next, and both are waiting on signal. Without the filter, lead B
 * would show lead A's photos.
 */
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

/** What a pending upload looks like to a view that renders `CapturedPhoto`s. */
export interface PendingPhotoView {
  secureUrl: string;
  subcategory: string;
  /** Marks the row as not-yet-on-the-server. Views use it to hide delete / move / annotate. */
  isPending: true;
  /** Optimistic too, so existing code that already special-cases previews keeps working. */
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

/**
 * Server photos for one slot, plus any pending upload the server does not yet account for.
 *
 * ⚠️ The handover rule: only pending BEYOND what the server already shows is added — the same rule
 * the Lead Center's own counter uses, and the reason both surfaces now agree. A queue item is not
 * removed until its upload succeeds, and the lead refetch that follows can land first, so for a
 * moment the photo exists in BOTH lists. Concatenating would show it twice and the slot would read
 * 0 → 1 → 2 → 1. Counting the surplus makes it read 0 → 1 and hold.
 *
 * ⚠️ Matching by COUNT, not identity, is deliberate: a queue item has no `s3url` and the server row
 * has no queue id, so there is nothing to join on. Count is the only honest comparison, and it is
 * correct for the case that matters — one slot, one photo.
 */
export const mergePendingForSlot = <T,>(
  serverPhotos: T[] | null | undefined,
  pending: PendingUpload[] | null | undefined
): (T | PendingPhotoView)[] => {
  const server = Array.isArray(serverPhotos) ? serverPhotos : [];
  const queued = Array.isArray(pending) ? pending : [];
  const surplus = queued.length - server.length;
  if (surplus <= 0) return server;
  // The OLDEST surplus items: the queue drains front-first, so the ones the server has already
  // accounted for are the earliest, and what is still outstanding is at the back.
  return [...server, ...queued.slice(queued.length - surplus).map(toView)];
};

/** Total photos on a lead including pending, deduped the way each surface counts them. */
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

/**
 * What a queued photo's tile should SAY, given whether it is the item in flight and
 * whether the device has a connection.
 *
 * ⚠️ The honest states matter more than they look. Every queued tile previously read
 * "Waiting to upload", including offline — which invites exactly the reading the client
 * reported: the rep assumes something is stuck or lost. Offline the photo is not waiting
 * on the app at all, it is safely on the handset, so the tile says so; online, only the
 * one actually moving claims to be uploading.
 *
 * `online` is the app-wide connectivity value (`hooks/useIsOnline`), never a per-tile probe.
 */
export type PendingStatus = 'saved-offline' | 'uploading' | 'queued';

export interface PendingStatusView {
  status: PendingStatus;
  /** Tile caption. Short enough for a half-width card. */
  label: string;
  /** MaterialCommunityIcons name. */
  icon: string;
  /** Caption + icon colour. */
  color: string;
  /** Whether to show a small activity spinner beside the caption. */
  spinner: boolean;
}

export const pendingStatusFor = (
  isActiveUpload: boolean,
  online: boolean
): PendingStatusView => {
  if (!online) {
    // Not an error and not a wait — the photo is on the device and will go up by itself.
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

/**
 * Whether a photo tile can show anything at all right now.
 *
 * ⚠️ There are THREE states, not two, and the middle one is the bug this names. A photo that was
 * uploaded ONLINE lives only as a pre-signed S3 url; if the rep never opened that screen while
 * connected, its bytes were never warmed into the local file cache. Offline there is then nothing
 * to draw AND no way to fetch it — so the tile sat on a spinner forever, which reads as "still
 * loading" when the honest answer is "not on this device".
 *
 *   - `ready`        — a local file exists (warmed earlier, or the photo is a queued local shot)
 *   - `unavailable`  — remote-only AND offline: nothing to show, and no way to get it
 *   - `loading`      — remote-only but online: the warm is genuinely in flight
 *
 * `warmedUri` is the value from `hooks/useWarmedImageUris`, which resolves anything already on
 * disk synchronously — so an `undefined` here really does mean "not cached", not "not yet checked".
 */
export type PhotoTileState = 'ready' | 'unavailable' | 'loading';

export const photoTileState = (
  uri: string | undefined | null,
  warmedUri: string | undefined | null,
  online: boolean
): PhotoTileState => {
  if (!uri) return 'unavailable';
  if (warmedUri) return 'ready';
  // A local uri is its own copy; `useWarmedImageUris` seeds it, but don't depend on that here —
  // a `file://` photo must never read as unavailable just because the map has not been consulted.
  if (!/^https?:\/\//i.test(uri)) return 'ready';
  return online ? 'loading' : 'unavailable';
};

// ─── Folding pending photos into the SHARED section map ───────────────────────

/**
 * `sectionImages` holds every lead photo grouped by category, and it is the source the screens
 * BEYOND the Lead Center read: RevRender flattens it into `rawPhotos` (its picker, tab counts and
 * `buildSchemaPickerCards` all derive from that), and the Pitch Book / Roofline Deck feed it to
 * `buildInspectionSections`.
 *
 * ⚠️ It is built from `lead.salesPhotos` alone, so a photo shot at a door with no signal is
 * INVISIBLE on all of them — the rep takes an inspection photo, opens RevRender to render it, and
 * the picker is empty with "No photos for this product yet." The Lead Center shows it (it merges
 * the queue itself, see `mergePendingForSlot`), so the two surfaces disagree about what the lead
 * has, which reads as photos having been lost.
 */
export interface PendingSectionPhoto extends PendingPhotoView {
  /** `sectionImages` entries are addressed by `uri`, not `secureUrl`. */
  uri: string;
  /** No server id yet — views keyed on `id` must tolerate this. */
  id: string;
  index: number;
  category: string;
}

/**
 * Fold the lead's pending uploads into the category map the shared screens read.
 *
 * ⚠️ Grouped by CATEGORY here, not by slot. `sectionImages` is one bucket per category, so the
 * surplus rule is applied per category rather than per subcategory — the same rule, one level up.
 * Comparing per slot would over-add: the category bucket already holds every slot's photos.
 *
 * ⚠️ `categoryName` carries the product scope (`"Gutters/Roofline — HOME"`) while the map's keys
 * are the schema's display names, so the match is on the normalized name with any ` — PRODUCT`
 * suffix stripped. An unmatched category is still added under its own key rather than dropped —
 * being visible in the wrong group beats vanishing.
 *
 * Returns the SAME object when there is nothing pending, so callers can keep their memo identity.
 */
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

  // Category name without its product scope, normalized — what the map is keyed by.
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
    // Same surplus rule as `mergePendingForSlot`: a queue item is not removed until its upload
    // succeeds, and the refetch can land first, so only what the server does not yet account for
    // is added. Otherwise the photo appears twice the moment it uploads.
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
