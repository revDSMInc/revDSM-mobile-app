import type {
  PhotoSection,
  PhotoSlot,
  PhotoTag,
  PreInstallPhotos,
  RepPhoto,
} from '../config/types/installer';

export const isAnnotatedRepPhoto = (photo?: RepPhoto | null): boolean => {
  if (!photo) return false;
  if (photo.isAnnotated === true) return true;
  const raw = photo as unknown as { category?: unknown; subcategory?: unknown };
  return (
    String(raw.category ?? '').trim().toLowerCase() === 'annotated' ||
    String(raw.subcategory ?? '').toLowerCase().includes('(annotated)')
  );
};

const actualPhotosOf = (slot: PhotoSlot): RepPhoto[] =>
  (slot.photos ?? []).filter((photo) => !isAnnotatedRepPhoto(photo));

const repPhotoOf = (slot: PhotoSlot): RepPhoto | undefined =>
  actualPhotosOf(slot).find((photo) => (photo.source ?? '').trim().toLowerCase() !== 'installer');

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

export const buildRepPhotoSections = (photos?: PreInstallPhotos): PhotoSection[] => {
  const products = photos?.products ?? [];
  const sections: PhotoSection[] = [];

  products.forEach((prod, pi) => {
    prod.categories.forEach((cat, ci) => {
      const slots = cat.slots ?? [];
      if (!slots.some((slot) => !!repPhotoOf(slot))) return;

      const tags: PhotoTag[] = slots.map((slot) => {
        const rep = repPhotoOf(slot);
        const reference = rep ?? actualPhotosOf(slot)[0];
        return {
          id: slot.id,
          label: slot.name || slot.storageName || 'Photo',
          hasRep: !!rep,
          repPhotoS3Url: rep?.s3url,
          repPhotoBucket: rep?.bucketName,
          repPhotoId: reference?._id,
          repPhotoSource: reference?.source,
          categoryLabel: cat.label,
        };
      });

      sections.push({
        id: `${pi}-${ci}-${cat.label}`,
        name: `${products.length > 1 ? `${prod.product} · ` : ''}${(cat.label || 'PHOTOS').toUpperCase()}`,
        icon: iconForCategory(cat.label || ''),
        categoryLabel: cat.label,
        tags,
      });
    });
  });

  return sections;
};

export const requiredTagIdsFromSections = (sections: PhotoSection[]): string[] =>
  sections.flatMap((s) => s.tags.filter((t) => t.hasRep).map((t) => t.id));
