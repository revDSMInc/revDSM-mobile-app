import { AxiosResponse } from 'axios';
import api from './index';

/**
 * PitchBookService — sales-side reads for the DYNAMIC (portal-authored) pitch books.
 *
 * The portal lets a manager bulk-upload a multi-page PDF, parse it into slide
 * images, group those slides into sections and publish the result. This service is
 * the rep-facing half of that: it only ever reads PUBLISHED books, scoped to the
 * rep's company by the JWT (there is no company/user id in either path).
 *
 *   GET /pitch-books/sales-rep                 → { data: { books: [...] } }
 *   GET /pitch-books/sales-rep/:bookId         → { data: { book, sections: [...] } }
 *
 * `documentType` (e.g. `pitch_book`) narrows the list — the same endpoint backs
 * other deck types, so a caller that wants only pitch books must pass it.
 *
 * Slides come back as `{ filePath, bucketName }` pairs, NOT urls. They must be
 * exchanged for pre-signed urls via `LeadService.getSecureUrls` before an <Image>
 * can render them — `usePitchBookDeck` does that in one batch call.
 */
export const PitchBookEndpoints = {
  salesRep: '/pitch-books/sales-rep',
  salesRepDetail: (bookId: string) => `/pitch-books/sales-rep/${encodeURIComponent(bookId)}`,
} as const;

export const PitchBookService = {
  /** Published books for the rep's company. `documentType` is optional server-side. */
  getPitchBooks: (documentType?: string): Promise<AxiosResponse<any>> =>
    api.get(
      documentType
        ? `${PitchBookEndpoints.salesRep}?documentType=${encodeURIComponent(documentType)}`
        : PitchBookEndpoints.salesRep
    ),

  /** One book: published slides only, grouped into sections. */
  getPitchBook: (bookId: string): Promise<AxiosResponse<any>> =>
    api.get(PitchBookEndpoints.salesRepDetail(bookId)),
};

export default PitchBookService;
