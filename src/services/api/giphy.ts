import { ENV } from '../../config/env';

// ⚠️ Plain `fetch`, NOT the axios wrapper in ./index.ts — that one attaches the revDSM bearer token to every
// request and must never be sent to a third party.
const BASE = 'https://api.giphy.com/v1/gifs';
export const GIF_PAGE_SIZE = 24;

export interface GifItem {
  id: string;
  title: string;
  /** Small rendition for the picker grid. */
  previewUrl: string;
  /** What is sent in the chat message. */
  url: string;
  width: number;
  height: number;
}

export interface GifPage {
  items: GifItem[];
  nextOffset: number | null;
}

const pick = (images: any, keys: string[]) => {
  for (const k of keys) if (images?.[k]?.url) return images[k];
  return null;
};

const toItem = (g: any): GifItem | null => {
  const full = pick(g?.images, ['downsized', 'fixed_height', 'original']);
  const small = pick(g?.images, ['fixed_width_small', 'fixed_width', 'downsized_small']) || full;
  if (!g?.id || !full?.url || !small?.url) return null;
  return {
    id: String(g.id),
    title: g.title || '',
    // Rendition URLs carry tracking query params; the bare media path is what the bubble matches on.
    url: String(full.url).split('?')[0],
    previewUrl: String(small.url),
    width: Number(full.width) || 0,
    height: Number(full.height) || 0,
  };
};

export const isGiphyConfigured = () => !!ENV.GIPHY_API_KEY;

export async function fetchGifs(query: string, offset = 0, signal?: AbortSignal): Promise<GifPage> {
  const q = query.trim();
  const params = new URLSearchParams({
    api_key: ENV.GIPHY_API_KEY,
    limit: String(GIF_PAGE_SIZE),
    offset: String(offset),
    rating: 'pg-13',
    bundle: 'messaging_non_clips',
  });
  if (q) params.set('q', q);
  const res = await fetch(`${BASE}/${q ? 'search' : 'trending'}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`GIPHY request failed (${res.status})`);
  const json = await res.json();
  const items = ((json?.data as any[]) || []).map(toItem).filter(Boolean) as GifItem[];
  const total = Number(json?.pagination?.total_count) || 0;
  const next = offset + (json?.data?.length || 0);
  return { items, nextOffset: items.length && next < total ? next : null };
}
