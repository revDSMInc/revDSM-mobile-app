/**
 * Opening the job submission PDF.
 *
 * The API hands over a bucket-relative key (`submissionPdf.url`), not a URL — the
 * object is private, so it has to be exchanged for a signed URL through
 * `url/v1/secure/multiple` before any viewer can fetch it. Signed URLs live an hour,
 * so a resolved one is reused rather than re-requested on every tap.
 */

import { LeadService } from '../services/api/leads';
import type { JobPacket } from '../config/types/installer';

interface CachedUrl {
  url: string;
  at: number;
}

/** Well inside S3's 1-hour signature TTL, matching `useRepPhotoSections`. */
const URL_TTL_MS = 50 * 60 * 1000;
const cache = new Map<string, CachedUrl>();

/**
 * Resolves a packet to something a PDF viewer can open, or `null` when there is
 * nothing to show. Throws only on a failed network call, so callers can surface it.
 */
export const resolvePacketUrl = async (packet?: JobPacket): Promise<string | null> => {
  if (!packet) return null;

  // Some payloads may serve a ready URL outright; nothing to exchange in that case.
  if (packet.fileUrl) return packet.fileUrl;
  if (!packet.s3url) return null;

  const cached = cache.get(packet.s3url);
  if (cached && Date.now() - cached.at < URL_TTL_MS) return cached.url;

  const res = await LeadService.getSecureUrls([
    { bucketName: packet.bucketName || '', filePath: packet.s3url },
  ]);

  const rows = res.data?.data || res.data || [];
  const match = Array.isArray(rows)
    ? rows.find((r: any) => r?.filePath === packet.s3url || r?.s3url === packet.s3url) ?? rows[0]
    : rows;
  const url: string | undefined = match?.secureUrl;

  if (!url) return null;

  cache.set(packet.s3url, { url, at: Date.now() });
  return url;
};
