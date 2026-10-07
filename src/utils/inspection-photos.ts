const isAnnotatedPhoto = (p: any) =>
  (p?.category || '').toLowerCase() === 'annotated' ||
  (p?.subcategory || '').toLowerCase().includes('(annotated)');

const prettify = (s: string) =>
  (s || '')
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
    .trim();

function sectionFromCategory(category: string) {
  const raw = (category || '').trim();
  if (!raw) return { id: '__other__', name: 'Other' };
  const dashIdx = raw.indexOf('—'); // em dash separates "{product} — {TAB}"
  if (dashIdx !== -1) {
    const tab = raw.slice(dashIdx + 1).trim();
    return { id: raw, name: prettify(tab) || prettify(raw) };
  }
  return { id: raw, name: prettify(raw) };
}

const tsValue = (t: any) => {
  if (!t) return 0;
  const n = new Date(t).getTime();
  return Number.isNaN(n) ? 0 : n;
};

export const formatCaptureTime = (t: any) => {
  if (!t) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const suffix = d.getHours() >= 12 ? 'PM' : 'AM';
  const hour12 = d.getHours() % 12 || 12;
  return `${String(hour12).padStart(2, '0')}:${minutes} ${suffix}`;
};

export interface SectionPhoto {
  uri: string;
  label: string;
  timestamp: any;
}
export interface InspectionSection {
  id: string;
  name: string;
  photos: SectionPhoto[];
}

export type SecureImageMap = Record<string, Array<{ uri: string; s3url: string; subcategory: string }>>;

export function buildInspectionSections(
  photos: any[],
  secureImages: SecureImageMap
): InspectionSection[] {
  const uriByS3: Record<string, string> = {};
  Object.values(secureImages || {}).forEach((list) =>
    (list || []).forEach((img) => {
      if (img?.s3url) uriByS3[img.s3url] = img.uri;
    })
  );

  const secMap = new Map<string, { id: string; name: string; slots: Map<string, SectionPhoto[]> }>();

  (photos || []).forEach((p: any) => {
    if (!p || p.deletedAt || isAnnotatedPhoto(p)) return;
    const uri = uriByS3[p.s3url] || p.secureUrl || p.uri;
    if (!uri) return;

    const sec = sectionFromCategory(p.category);
    if (!secMap.has(sec.id)) secMap.set(sec.id, { id: sec.id, name: sec.name, slots: new Map() });
    const slots = secMap.get(sec.id)!.slots;

    const label = (p.subcategory || '').trim() || 'Photo';
    if (!slots.has(label)) slots.set(label, []);
    slots.get(label)!.push({ uri, label, timestamp: p.timestampTaken || p.timestamp || null });
  });

  return [...secMap.values()].map((s) => ({
    id: s.id,
    name: s.name,
    photos: [...s.slots.values()].flatMap((slotPhotos) =>
      [...slotPhotos].sort((a, b) => tsValue(a.timestamp) - tsValue(b.timestamp))
    ),
  }));
}
