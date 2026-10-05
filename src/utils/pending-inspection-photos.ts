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
