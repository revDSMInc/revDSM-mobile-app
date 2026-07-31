import type {
  PhotoSection,
  PhotoTag,
  PreInstallPhotos,
} from '../config/types/installer';

/** Best-effort MaterialCommunityIcons glyph for a rep-photo category label. */
const ICON_BY_KEYWORD: Array<[RegExp, string]> = [
  [/ridge|roof|shngl|shingle/i, 'home-roof'],
  [/flash/i, 'weather-lightning'],
  [/soffit|fascia/i, 'home-outline'],
  [/dmg|damage/i, 'alert-outline'],
  [/drain|gutter|downspout/i, 'water-outline'],
  [/meas|plane/i, 'ruler'],
  [/ext|home|front|back|side/i, 'home-outline'],
];

const iconForCategory = (label: string): string => {
  for (const [re, icon] of ICON_BY_KEYWORD) if (re.test(label)) return icon;
  return 'camera-outline';
};

/**
 * Build the Pre-Install tagger's sections directly from the rep's capture set.
 *
 * Each product-category the rep actually shot becomes a section tab; each slot in it
 * becomes a tag whose reference image is the rep's photo — matched by the slot name
 * shown on the tag button (e.g. "Back-Left", "Back"). Slots the rep skipped carry
 * `hasRep: false` and render dimmed as N/A, exactly as the static mock did, so the
 * matching/ghost flow is unchanged — only the data source moves from the mock to the
 * real `preInstallPhotos` payload.
 *
 * The tag carries the rep photo's raw S3 key (`repPhotoS3Url`/`repPhotoBucket`), not a
 * displayable URL — S3 objects are private, so `useRepPhotoSections` swaps in a signed
 * URL (`url/v1/secure/multiple`) before the image renders.
 *
 * Categories with no rep photo at all are omitted (nothing to ghost-match), mirroring
 * the old Rep Photos card. Returns `[]` when there is no usable capture set, letting
 * the caller fall back to the static sections.
 */
export const buildRepPhotoSections = (photos?: PreInstallPhotos): PhotoSection[] => {
  const products = photos?.products ?? [];
  const sections: PhotoSection[] = [];

  products.forEach((prod, pi) => {
    prod.categories.forEach((cat, ci) => {
      const slots = cat.slots ?? [];
      // Only surface categories the rep actually captured something in.
      if (!slots.some((s) => (s.photos?.length ?? 0) > 0)) return;

      const tags: PhotoTag[] = slots.map((slot) => {
        const first = slot.photos?.[0];
        return {
          id: slot.id,
          label: slot.name || slot.storageName || 'Photo',
          hasRep: (slot.photos?.length ?? 0) > 0,
          repPhotoS3Url: first?.s3url,
          repPhotoBucket: first?.bucketName,
          // Carried so the installer's matching shot can be uploaded with
          // `salesPhotoId` + `category` — that pairing is what links the two images.
          repPhotoId: first?._id,
          categoryLabel: cat.label,
        };
      });

      sections.push({
        id: `${pi}-${ci}-${cat.label}`,
        // Prefix the product when there's more than one, so tabs stay unambiguous.
        name: `${products.length > 1 ? `${prod.product} · ` : ''}${(cat.label || 'PHOTOS').toUpperCase()}`,
        icon: iconForCategory(cat.label || ''),
        categoryLabel: cat.label,
        tags,
      });
    });
  });

  return sections;
};

/** Flat list of tag ids the rep captured — the set the installer must ghost-match. */
export const requiredTagIdsFromSections = (sections: PhotoSection[]): string[] =>
  sections.flatMap((s) => s.tags.filter((t) => t.hasRep).map((t) => t.id));
