/**
 * The ONE answer to "how many photos does this lead have?".
 *
 * Reported from a device: the download modal said "Successfully downloaded all 3 photos" while
 * Manage Photos and Download Images both read "(1)", and the progress row read "1/46 slots".
 * Three surfaces, three different numbers, for the same lead.
 *
 * The cause was that each counted a different THING:
 *
 *   - the buttons counted `filledSlots` - configured slots with at least one photo in them;
 *   - the progress row's "N photos" counted slot photos only, dropping annotated ones outright;
 *   - the download walked every image in `sectionImages`, which includes extras AND annotated.
 *
 * ⚠️ An EXTRA has no configured slot, so it could never raise `filledSlots`. An ANNOTATED photo
 * was skipped by an explicit `return`. Both are real photos the rep took and can see, so both must
 * count - a rep who adds one and watches the number stay still assumes the app lost it.
 *
 * The rule, and it is the one a rep would state: every distinct photo counts once, wherever it
 * sits. Slots, extras and annotations are all photos; the denominator grows as extras are added,
 * which is why it is "3/48" and not "3/46" after one extra and one annotation.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

export interface PhotoLike {
  s3url?: string | null;
  uri?: string | null;
  _id?: string | null;
  category?: string | null;
  subcategory?: string | null;
}

export interface LeadPhotoCounts {
  /** Every distinct photo: slot, extra and annotated alike. The number on both buttons. */
  photos: number;
  /** Configured slots plus one per extra, so an extra never overflows the denominator. */
  slots: number;
  /** Photos that are annotations of another shot. */
  annotated: number;
  /** Photos with no configured slot of their own. */
  extras: number;
}

const ANNOTATED_RE = /\(annotated\)/i;

export const isAnnotatedPhoto = (photo: PhotoLike | null | undefined): boolean =>
  ANNOTATED_RE.test(String(photo?.subcategory ?? ''));

/** The id a photo is deduped by. Falls back through the shapes the API and the queue use. */
export const photoIdentity = (photo: PhotoLike | null | undefined): string =>
  String(photo?.s3url || photo?.uri || photo?._id || '');

const keyOf = (category: unknown, subcategory: unknown): string =>
  `${String(category ?? '').trim().toLowerCase()}||${String(subcategory ?? '').trim().toLowerCase()}`;

/**
 * Count a lead's photos against the slots its schema configures.
 *
 * `configuredSlotKeys` is every `category||subcategory` the schema defines; anything outside it is
 * an extra. Pass an empty set when the lead has no dynamic schema - every photo is then its own
 * slot, which is what the static flow already showed.
 */
export const countLeadPhotos = (
  photos: Array<PhotoLike | null | undefined> | null | undefined,
  configuredSlotKeys: ReadonlySet<string>,
  configuredSlotCount: number
): LeadPhotoCounts => {
  const seen = new Set<string>();
  let annotated = 0;
  let extras = 0;
  let total = 0;

  (Array.isArray(photos) ? photos : []).forEach((photo) => {
    if (!photo) return;
    const id = photoIdentity(photo);
    // ⚠️ Dedupe by identity, not by slot: the same shot appears in both the server list and the
    // upload queue for one refetch after it lands, and would otherwise be counted twice.
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    total += 1;
    if (isAnnotatedPhoto(photo)) {
      annotated += 1;
      return;
    }
    if (configuredSlotKeys.size > 0 && !configuredSlotKeys.has(keyOf(photo.category, photo.subcategory))) {
      extras += 1;
    }
  });

  return {
    photos: total,
    // Each extra and each annotation brings its own slot, so the denominator never reads as full
    // while photos are still being added.
    slots: Math.max(configuredSlotCount, 0) + extras + annotated,
    annotated,
    extras,
  };
};

/** The one-line explanation behind the info icon. */
export const PHOTO_COUNT_HINT =
  'Extras and annotated photos are included in this total, so the count grows as you add them.';
