/**
 * Grouping logic behind the "Property Inspection Photos" accordion (Pitchbook +
 * Roofline Deck). Port of web `src/sections/pitch-book/components/pb-inspection-photos.js`.
 *
 * Pure — no RN imports — so it stays unit-testable. The renderer lives in
 * `widgets/components/InspectionPhotosPanel.tsx`, which pulls in reanimated via
 * PhotoPeekPressable and therefore cannot be imported from a plain jest suite.
 *
 * ⚠️ Sections are derived from each photo's OWN `category`, never matched against a
 * fixed list. Both screens previously did
 * `IMAGE_CATEGORIES.filter((s) => secureImages[s.name]?.length > 0)`, which only ever
 * matched the four static names ("Home", "Inspection", "Measurements",
 * "Miscellaneous"). The dynamic capture flow scopes a photo's category to its product
 * — `useDynamicInspectionCapture.scopeCat` stores `"Gutters/Roofline — HOME"` — so
 * NOTHING matched and the tab rendered empty. Worse, the old empty-state test
 * (`Object.keys(secureImages).length === 0`) was false, so not even "No inspection
 * photos available" appeared: the rep just saw a heading over blank space.
 */

// Annotated copies are presented elsewhere — never in the inspection grid.
const isAnnotatedPhoto = (p: any) =>
  (p?.category || '').toLowerCase() === 'annotated' ||
  (p?.subcategory || '').toLowerCase().includes('(annotated)');

// Title-case a label so an all-caps tab name ("HOME") reads nicely while an
// already-cased legacy name ("Roofline Observation") survives intact.
const prettify = (s: string) =>
  (s || '')
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
    .trim();

/**
 * Derive a display section from a photo's `category`, covering BOTH storage formats:
 *   • dynamic capture — `"Gutters/Roofline — HOME"` → "Home"
 *   • legacy capture  — `"Home"` / `"Roofline Observation"` → as-is
 *
 * The FULL category string is the section id, so two products that share a tab name
 * (both have a "HOME") stay separate rather than merging into one accordion.
 */
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

/**
 * "01:05 PM" — the capture time web prints in the caption bar.
 *
 * Formatted by hand rather than via `toLocaleTimeString('en-US', …)` (what web
 * uses) so it cannot depend on Intl being compiled into the JS engine.
 */
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

/** `useSecureUrls` output: signed urls grouped by the photo's category. */
export type SecureImageMap = Record<string, Array<{ uri: string; s3url: string; subcategory: string }>>;

export function buildInspectionSections(
  photos: any[],
  secureImages: SecureImageMap
): InspectionSection[] {
  // `useSecureUrls` groups by category — the very axis that is unreliable here — so
  // flatten it back into a plain s3url → signed-url lookup and re-group from the
  // photo records themselves, which carry the metadata the grouping needs.
  const uriByS3: Record<string, string> = {};
  /**
   * ⚠️ `Array.isArray`, not `list || []` — a non-array TRUTHY value sails through that guard and
   * `.forEach` is then undefined. This crashed the whole Roofline Deck with "undefined is not a
   * function" the moment a wrongly-shaped entry reached the offline cache.
   *
   * ⚠️ This function renders a rep's PRESENTATION in front of a customer, so it must degrade to
   * "no photos" rather than take the screen down. Anything unrecognised is skipped.
   */
  Object.values(secureImages || {}).forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((img) => {
      if (img?.s3url && typeof img.uri === 'string') uriByS3[img.s3url] = img.uri;
    });
  });

  const secMap = new Map<string, { id: string; name: string; slots: Map<string, SectionPhoto[]> }>();

  // ⚠️ Same reason as `uriByS3` above: a truthy non-array would pass `|| []` and then throw.
  (Array.isArray(photos) ? photos : []).forEach((p: any) => {
    if (!p || p.deletedAt || isAnnotatedPhoto(p)) return;
    /**
     * ⚠️ `p.uri` is the third source, and leaving it out is what hid every photo shot at a door
     * with no signal. A pending upload has NO `s3url` (the server has not issued one) and NO
     * `secureUrl` (there is nothing to sign) — it carries only the local `file://` copy. Both
     * lookups above miss, `uri` came back undefined, and the photo was dropped from the section
     * entirely: the Roofline Deck's Inspection tab showed empty frames for photos the Lead
     * Center was displaying on the screen beneath it.
     */
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
    // Grouped by slot so repeat shots of one subcategory sit together, oldest first
    // within the slot. Unlike web this renders EVERY photo rather than one card per
    // slot with a "+N" badge — mobile's preview modal shows a single image and cannot
    // page through a slot, so a badge would make the extra shots unreachable.
    photos: [...s.slots.values()].flatMap((slotPhotos) =>
      [...slotPhotos].sort((a, b) => tsValue(a.timestamp) - tsValue(b.timestamp))
    ),
  }));
}
