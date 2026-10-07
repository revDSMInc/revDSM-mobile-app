import { useQuery } from '@tanstack/react-query';
import { PitchBookService } from '../services/api/PitchBookService';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';
import { resolveS3Url } from '../utils/s3-utils';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, cachedFetch } from '../utils/offline-query-cache';
import { warmToLocalCache } from '../utils/imageFileCache';
import { useAuth } from './useAuth';
import {
  buildPitchBookDeck,
  collectSlideRefs,
  normalizePitchBookList,
  normalizePitchBookSections,
  PitchBookDeck,
  PitchBookSummary,
  S3Ref,
} from '../utils/pitch-book';

export const PITCH_BOOK_DOCUMENT_TYPE = 'pitch_book';

const SIGNED_URL_STALE_MS = 1000 * 60 * 50;
const SIGNED_URL_GC_MS = 1000 * 60 * 60;

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

const warmDeckSlides = (deck: PitchBookDeck): void => {
  if (!isOnline()) return;
  const uris: string[] = [];
  Object.values(deck?.images || {}).forEach((slides: any) => {
    Object.values(slides || {}).forEach((source: any) => {
      if (source && typeof source === 'object' && typeof source.uri === 'string') {
        uris.push(source.uri);
      }
    });
  });
  uris.forEach((uri) => {
    warmToLocalCache(uri).catch(() => {
    });
  });
};

export function usePitchBooks(
  documentType: string | undefined = PITCH_BOOK_DOCUMENT_TYPE,
  enabled: boolean = true
) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  return useQuery<PitchBookSummary[]>({
    queryKey: ['pitch-books', documentType || 'all'],
    queryFn: () =>
      cachedFetch<PitchBookSummary[]>(
        `${OFFLINE_CACHE.PITCH_BOOK_LIST}:${documentType || 'all'}`,
        () => fetchPitchBookList(documentType),
        { online: isOnline(), userId }
      ),
    enabled,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_GC_MS,
  });
}

async function fetchPitchBookList(documentType?: string): Promise<PitchBookSummary[]> {
  let response;
  try {
    response = await PitchBookService.getPitchBooks(documentType);
  } catch (error: any) {
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

  const withThumbs = books.map((book) => ({
    ...book,
    thumbnailUri: book.thumbnailPath
      ? urlByPath[book.thumbnailPath] || resolveS3Url(book.thumbnailPath)
      : undefined,
  }));

  withThumbs.forEach((book) => {
    if (book.thumbnailUri) warmToLocalCache(book.thumbnailUri).catch(() => {});
  });

  return withThumbs;
}

export function usePitchBookDeck(bookId?: string | null) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  return useQuery<PitchBookDeck>({
    queryKey: ['pitch-book', bookId],
    queryFn: async () => {
      const deck = await cachedFetch<PitchBookDeck>(
        `${OFFLINE_CACHE.PITCH_BOOK_DECK}:${bookId}`,
        () => fetchPitchBookDeck(bookId as string),
        { online: isOnline(), userId }
      );
      warmDeckSlides(deck);
      return deck;
    },
    enabled: !!bookId,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_GC_MS,
  });
}

async function fetchPitchBookDeck(bookId: string): Promise<PitchBookDeck> {
  let response;
  try {
    response = await PitchBookService.getPitchBook(bookId);
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
    urlByPath[slide.filePath] || resolveS3Url(slide.filePath)
  );
}
