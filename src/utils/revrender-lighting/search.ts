import { Look } from './types';

export function normalize(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip accents
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')      // remaining punctuation -> space
    .trim();
}

export function matchesQuery(look: Look, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const haystack = `${normalize(look.name)} ${normalize(look.category)}`;
  return q.split(' ').every((word) => haystack.includes(word));
}

export function searchLooks(looks: Look[], query: string): Look[] {
  if (!normalize(query)) return looks;
  return looks.filter((l) => matchesQuery(l, query));
}
