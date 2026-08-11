import { useQuery } from '@tanstack/react-query';
import { PitchBookService } from '../services/api/PitchBookService';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';
import { resolveS3Url } from '../utils/s3-utils';
import {
  buildPitchBookDeck,
  collectSlideRefs,
  normalizePitchBookList,
  normalizePitchBookSections,
  PitchBookDeck,
  PitchBookSummary,
  S3Ref,
} from '../utils/pitch-book';

/** Default `documentType` filter — the Lead Center card only wants pitch books. */
export const PITCH_BOOK_DOCUMENT_TYPE = 'pitch_book';

// Pre-signed S3 urls expire after an hour, so a deck is refetched a little before
// that — same window `useSecureUrls` uses for the lead photo grid.
const SIGNED_URL_STALE_MS = 1000 * 60 * 50;
const SIGNED_URL_GC_MS = 1000 * 60 * 60;

/**
 * Exchange `{ filePath, bucketName }` refs for pre-signed urls, keyed by BOTH the
 * `filePath` and `s3url` the endpoint may echo back (it is not consistent across
 * callers — `useSecureUrls` matches on either too).
 */
async function resolveSecureUrlMap(refs: S3Ref[]): Promise<Record<string, string>> {
  if (!refs.length) return {};
  const response = await LeadService.getSecureUrls(
    refs.map((ref) => ({
      bucketName: ref.bucketName || ENV.S3_BUCKET,
      filePath: ref.filePath,
    }))
  );
  const rows = response.data?.data || response.data || [];
  const map: Record<string, string> = {};
  (Array.isArray(rows) ? rows : []).forEach((row: any) => {
    const url = row?.secureUrl;
    if (!url) return;
    if (row?.filePath) map[row.filePath] = url;
    if (row?.s3url) map[row.s3url] = url;
  });
  return map;
}

/**
 * Published pitch books for the rep's company — the list behind the Lead Center
 * "Pitch Book" card's expander.
 *
 * Thumbnails are resolved in ONE batched secure-url call. A failure there is
 * swallowed: the list is still perfectly usable without cover images, and losing
 * the whole card because a thumbnail could not be signed would be a bad trade.
 */
export function usePitchBooks(
  documentType: string | undefined = PITCH_BOOK_DOCUMENT_TYPE,
  enabled: boolean = true
) {
  return useQuery<PitchBookSummary[]>({
    queryKey: ['pitch-books', documentType || 'all'],
    queryFn: async () => {
      let response;
      try {
        response = await PitchBookService.getPitchBooks(documentType);
      } catch (error: any) {
        // Logged because the card's fallback is deliberately quiet (it drops back to
        // the bundled deck), which would otherwise make a 404/403 look identical to
        // "this company hasn't published any book".
        if (__DEV__) {
          console.log(
            '[pitchBooks] list FAILED',
            error?.response?.status,
            error?.response?.data || error?.message
          );
        }
        throw error;
      }
      const payload = response.data?.data || response.data || {};
      const books = normalizePitchBookList(payload?.books || payload);
      if (__DEV__) console.log('[pitchBooks] list ok —', books.length, 'book(s)');
      if (!books.length) return books;

      const refs: S3Ref[] = books
        .filter((b) => !!b.thumbnailPath)
        .map((b) => ({ filePath: b.thumbnailPath as string, bucketName: b.thumbnailBucket }));

      let urlByPath: Record<string, string> = {};
      try {
        urlByPath = await resolveSecureUrlMap(refs);
      } catch {
        urlByPath = {};
      }

      return books.map((book) => ({
        ...book,
        thumbnailUri: book.thumbnailPath
          ? urlByPath[book.thumbnailPath] || resolveS3Url(book.thumbnailPath)
          : undefined,
      }));
    },
    enabled,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_GC_MS,
  });
}

/**
 * One published book, projected into the same `{ categories, images }` shape the
 * bundled static decks use so the Pitchbook screen can render either.
 *
 * Disabled (and returns `undefined`) without a `bookId`, which is how the screen
 * keeps its existing behaviour when opened the old way.
 */
export function usePitchBookDeck(bookId?: string | null) {
  return useQuery<PitchBookDeck>({
    queryKey: ['pitch-book', bookId],
    queryFn: async () => {
      let response;
      try {
        response = await PitchBookService.getPitchBook(bookId as string);
      } catch (error: any) {
        if (__DEV__) {
          console.log(
            '[pitchBooks] deck FAILED',
            bookId,
            error?.response?.status,
            error?.response?.data || error?.message
          );
        }
        throw error;
      }
      const payload = response.data?.data || response.data || {};
      const sections = normalizePitchBookSections(payload?.sections);
      const urlByPath = await resolveSecureUrlMap(collectSlideRefs(sections));
      return buildPitchBookDeck(payload?.book, sections, (slide) =>
        // The bare S3 url is a deliberate fallback: it renders for a public bucket
        // and, when it doesn't, an image that fails to load is still better than a
        // slide silently dropped from the deck the rep is presenting.
        urlByPath[slide.filePath] || resolveS3Url(slide.filePath)
      );
    },
    enabled: !!bookId,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_GC_MS,
  });
}
