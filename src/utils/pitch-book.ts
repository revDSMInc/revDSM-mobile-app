/**
 * Pure normalization for the DYNAMIC (portal-authored) pitch books.
 *
 * Kept out of the hook/screen deliberately: everything here is plain data, so it
 * can be reasoned about (and tested) without pulling in React Native — the same
 * split as `utils/inspection-photos.ts`.
 *
 * The goal of this module is to hand the Pitchbook screen a deck in EXACTLY the
 * shape the bundled static decks already use:
 *
 *     categories: [{ id, label }]
 *     images:     { [categoryId]: { [slideName]: ImageSource } }
 *
 * `<Image source>` accepts both a `require()` number and `{ uri }`, so once the
 * remote book is projected into that shape every downstream read on the screen
 * (slide count, global page number, analytics slide names, fullscreen viewer)
 * works unchanged against either deck.
 */

export interface PitchBookSlide {
  id: string;
  /** Display name, unique within its section — used as the images-map key. */
  name: string;
  filePath: string;
  bucketName?: string;
  caption?: string | null;
}

export interface PitchBookSection {
  id: string;
  label: string;
  slides: PitchBookSlide[];
}

export interface PitchBookSummary {
  bookId: string;
  bookName: string;
  documentType?: string;
  slideCount: number;
  createdAt?: string;
  thumbnailPath?: string;
  thumbnailBucket?: string;
  /** Resolved pre-signed url, filled in by `usePitchBooks`. */
  thumbnailUri?: string;
}

export interface PitchBookDeck {
  bookId: string;
  bookName: string;
  categories: { id: string; label: string }[];
  images: Record<string, Record<string, { uri: string }>>;
  slideCount: number;
}

/** A `{ filePath, bucketName }` pair as the secure-url endpoint expects it. */
export interface S3Ref {
  filePath: string;
  bucketName?: string;
}

const asArray = (v: any): any[] => (Array.isArray(v) ? v : []);

const sortByOrder = <T extends Record<string, any>>(rows: T[], key: string): T[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = Number(a.row?.[key]);
      const bv = Number(b.row?.[key]);
      const an = Number.isFinite(av) ? av : Number.MAX_SAFE_INTEGER;
      const bn = Number.isFinite(bv) ? bv : Number.MAX_SAFE_INTEGER;
      // Ties keep the server's order rather than being reshuffled arbitrarily.
      return an - bn || a.index - b.index;
    })
    .map((e) => e.row);

/**
 * Make `name` unique within `taken`. Two slides in one section CAN carry the same
 * `slotDisplayName` (the portal derives it from the uploaded file name, and two
 * PDFs can both yield "Page 1.jpg"). The images map is keyed by name, so a
 * collision would silently swallow a slide — the rep would present a deck missing
 * a page with no error anywhere.
 */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  let n = 2;
  while (taken.has(`${name} (${n})`)) n += 1;
  const out = `${name} (${n})`;
  taken.add(out);
  return out;
}

/**
 * `GET /pitch-books/sales-rep/:bookId` → ordered sections of ordered slides.
 *
 * Sections with no renderable slide are DROPPED: an empty section is a legitimate
 * portal state (created but not filled yet), and rendering it as a tab would give
 * the rep a blank slide mid-pitch with no way to tell it apart from a broken image.
 */
export function normalizePitchBookSections(rawSections: any): PitchBookSection[] {
  const sections = sortByOrder(asArray(rawSections), 'sectionSortOrder');

  return sections
    .map((section: any) => {
      const sectionId = String(section?.sectionId || '').trim();
      if (!sectionId) return null;

      const taken = new Set<string>();
      const slides = sortByOrder(asArray(section?.slides), 'sortOrder')
        .map((slide: any, idx: number) => {
          const filePath = String(slide?.filePath || '').trim();
          if (!filePath) return null;
          const rawName =
            String(slide?.slotDisplayName || '').trim() ||
            String(slide?.slotKey || '').trim() ||
            `Slide ${idx + 1}`;
          return {
            id: String(slide?._id || slide?.slotKey || `${sectionId}-${idx}`),
            name: uniqueName(rawName, taken),
            filePath,
            bucketName: slide?.bucketName || undefined,
            caption: slide?.caption ?? null,
          } as PitchBookSlide;
        })
        .filter(Boolean) as PitchBookSlide[];

      if (!slides.length) return null;

      return {
        id: sectionId,
        label: String(section?.sectionDisplayName || '').trim() || sectionId,
        slides,
      } as PitchBookSection;
    })
    .filter(Boolean) as PitchBookSection[];
}

/** Every distinct S3 ref in a deck, ready for one batched secure-url call. */
export function collectSlideRefs(sections: PitchBookSection[]): S3Ref[] {
  const seen = new Set<string>();
  const refs: S3Ref[] = [];
  sections.forEach((section) =>
    section.slides.forEach((slide) => {
      if (seen.has(slide.filePath)) return;
      seen.add(slide.filePath);
      refs.push({ filePath: slide.filePath, bucketName: slide.bucketName });
    })
  );
  return refs;
}

/**
 * Project normalized sections into the static-deck shape.
 *
 * `resolveUri` maps a slide's `filePath` to a renderable url. A slide whose url
 * cannot be resolved is skipped rather than rendered as a blank frame; if that
 * empties a section, the section goes too, for the same reason as above.
 */
export function buildPitchBookDeck(
  book: { bookId?: string; bookName?: string } | null | undefined,
  sections: PitchBookSection[],
  resolveUri: (slide: PitchBookSlide) => string
): PitchBookDeck {
  const categories: { id: string; label: string }[] = [];
  const images: Record<string, Record<string, { uri: string }>> = {};
  let slideCount = 0;

  sections.forEach((section) => {
    const bySlide: Record<string, { uri: string }> = {};
    section.slides.forEach((slide) => {
      const uri = resolveUri(slide);
      if (!uri) return;
      bySlide[slide.name] = { uri };
      slideCount += 1;
    });
    if (!Object.keys(bySlide).length) return;
    categories.push({ id: section.id, label: section.label });
    images[section.id] = bySlide;
  });

  return {
    bookId: String(book?.bookId || ''),
    bookName: String(book?.bookName || '').trim() || 'Pitch Book',
    categories,
    images,
    slideCount,
  };
}

/** `GET /pitch-books/sales-rep` → the list rendered under the Lead Center card. */
export function normalizePitchBookList(rawBooks: any): PitchBookSummary[] {
  return asArray(rawBooks)
    .map((book: any) => {
      const bookId = String(book?.bookId || book?._id || '').trim();
      if (!bookId) return null;
      const thumb = book?.thumbnail || {};
      return {
        bookId,
        bookName: String(book?.bookName || '').trim() || 'Untitled Pitch Book',
        documentType: book?.documentType || undefined,
        slideCount: Number(book?.slideCount) || 0,
        createdAt: book?.createdAt || undefined,
        thumbnailPath: String(thumb?.filePath || '').trim() || undefined,
        thumbnailBucket: thumb?.bucketName || undefined,
      } as PitchBookSummary;
    })
    .filter(Boolean) as PitchBookSummary[];
}
