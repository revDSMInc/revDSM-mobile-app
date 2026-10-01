import { Look } from './types';

/**
 * Team search (483 §5): matches name, city, nickname and school, ignoring case,
 * punctuation and accents — "virginia" must return Virginia, Virginia Tech and
 * West Virginia.
 *
 * City, nickname and school are not separate fields in the catalogue; they are
 * all inside `name` ("Tampa Bay Buccaneers" carries both city and nickname), so
 * matching the normalised name covers every case the spec names. The league is
 * searched too, so "SEC" finds that conference's teams.
 */
export function normalize(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip accents
    .toLowerCase()
    // Apostrophes vanish rather than becoming a space: a rep types "st johns",
    // and splitting "St. John's" into "st john s" would never match that.
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')      // remaining punctuation -> space
    .trim();
}

/**
 * Every word in the query must appear. "notre dame" matches "Notre Dame";
 * "dame notre" does too, which is forgiving in the right direction for a rep
 * typing one-handed on a doorstep.
 */
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
