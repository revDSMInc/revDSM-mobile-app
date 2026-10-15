/**
 * Idempotency keys for photo uploads.
 *
 * ⚠️ The bug these exist for: **an upload that times out is not an upload that failed.**
 *
 * A 2-5 MB photo on a weak cell routinely takes longer than the client timeout while the server
 * stores it perfectly. The queue saw a transport error, burned a retry, and sent the same photo
 * again - up to `MAX_PHOTO_ATTEMPTS` times. A rep who took 4 photos ended up with 9, then 7
 * (the count kept moving because retries were still draining while they looked).
 *
 * Two defences, and they are not alternatives:
 *   1. A longer timeout makes the ambiguous window rare.
 *   2. This key makes a retry inside that window HARMLESS.
 * Only (2) actually closes the hole, and it needs the server to honour the key.
 *
 * Scope: the inspection-photo queue (`utils/uploadQueue.ts`) only. The installer queue has the
 * same defect and can adopt these helpers unchanged when the backend is ready to cover its
 * endpoint too - deliberately left alone for now so one endpoint ships at a time.
 *
 * Pure on purpose: the queue imports react-native / blob-util and cannot load under jest
 * (CLAUDE.md §6).
 */

/** The header the server reads. Standard name, so proxies and logs treat it sensibly. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * Also sent as a form field, because the body is the only place a *per-file* key can live and
 * because a multipart proxy is more likely to drop an unexpected header than a form field.
 */
export const IDEMPOTENCY_FIELD = 'idempotencyKey';

const SAFE = /[^a-zA-Z0-9_-]/g;

/** Keys travel in an HTTP header: keep them to a conservative, bounded charset. */
const sanitize = (raw: string, max = 128): string =>
  String(raw ?? '').replace(SAFE, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, max);

/**
 * The key for one queued photo.
 *
 * ⚠️ It MUST be derived from the item's own stable identity, never from the attempt, the clock
 * or a random value - a key regenerated per attempt is not an idempotency key at all, it is
 * just a slower duplicate. `item.id` is minted once when the photo is enqueued and is persisted
 * to MMKV with it, so it survives retries, app restarts and a cold drain days later.
 */
export const photoIdempotencyKey = (item: {
  id?: string | null;
  leadId?: string | null;
  subcategory?: string | null;
}): string | null => {
  const id = sanitize(String(item?.id ?? ''), 80);
  if (!id) return null; // never send an empty or fabricated key
  const lead = sanitize(String(item?.leadId ?? ''), 40);
  return lead ? `photo-${lead}-${id}` : `photo-${id}`;
};

/**
 * The key for one ANNOTATED image save (`screens/ImageAnnotation`).
 *
 * ⚠️ Different problem from the queue's. There is no retry loop here - the risk is an
 * axios-level retransmit or a double-tap of Save. The key must therefore be stable for one
 * save of one rendered image, and ⚠️ MUST change when the rep annotates the same source photo
 * again: that is a deliberate new upload, not a duplicate.
 *
 * `renderUri` satisfies both. It is a temp path minted once per render
 * (`annotated_<ts>_<index>.jpg`), so it is fixed for the save and different for the next one.
 */
export const annotatedPhotoIdempotencyKey = (input: {
  leadId?: string | null;
  renderUri?: string | null;
}): string | null => {
  const raw = String(input?.renderUri ?? '').trim();
  if (!raw) return null;
  const base = sanitize(raw.split('/').pop() || '', 80);
  if (!base) return null;
  const lead = sanitize(String(input?.leadId ?? ''), 40);
  return lead ? `annot-${lead}-${base}` : `annot-${base}`;
};

/**
 * ⚠️ A replayed key is a SUCCESS, not an error.
 *
 * If the server chooses to answer a duplicate with 409 rather than replaying the original 200,
 * the queue must still treat the item as delivered and drop it - otherwise the photo is parked
 * as "failed" when in truth it is safely stored, and the rep is told to retake it.
 */
export const isDuplicateUploadResponse = (err: unknown): boolean => {
  const e = err as any;
  const status = e?.httpStatus ?? e?.response?.status ?? e?.status;
  if (status !== 409) return false;
  const body = e?.response?.data ?? e?.data ?? {};

  /**
   * ⚠️ The backend's response envelope is `{ code, message, data }` where **`code` is the HTTP
   * status as a NUMBER** - it is not free for a string marker. The machine-readable marker
   * therefore lives at `data.code`, and that is what we prefer.
   *
   * `body.code` is still read for a non-enveloped reply, but a numeric one is ignored: an
   * envelope carrying `code: 409` must not be mistaken for a marker.
   */
  const marker = String(body?.data?.code ?? '').toUpperCase();
  if (marker.includes('IDEMPOT') || marker === 'DUPLICATE') return true;

  const rawCode = body?.code ?? body?.error;
  if (typeof rawCode === 'string') {
    const code = rawCode.toUpperCase();
    if (code.includes('IDEMPOT') || code === 'DUPLICATE') return true;
  }

  // Last resort: the human-readable message. Kept so a server that ships before we do is still
  // understood, but ⚠️ never the only thing we match on - message text is not a contract.
  const message = String(body?.message ?? e?.message ?? '');
  return /idempoten|duplicate/i.test(message);
};

/**
 * Was this response a replay of an earlier identical request?
 *
 * The server is asked to echo `idempotentReplay: true`. It is advisory only - used for logging
 * and to skip a redundant cache adopt; correctness must not depend on the server setting it.
 */
export const isIdempotentReplay = (response: unknown): boolean => {
  const r = response as any;
  const body = r?.data?.data ?? r?.data ?? r ?? {};
  return body?.idempotentReplay === true || body?.replayed === true;
};
