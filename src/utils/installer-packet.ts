import { LeadService } from '../services/api/leads';
import type { JobPacket } from '../config/types/installer';

interface CachedUrl {
  url: string;
  at: number;
}

const URL_TTL_MS = 50 * 60 * 1000;
const cache = new Map<string, CachedUrl>();

export const resolvePacketUrl = async (packet?: JobPacket): Promise<string | null> => {
  if (!packet) return null;

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
