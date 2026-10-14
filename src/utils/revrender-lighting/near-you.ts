import { Look } from './types';

/**
 * REVUIUX-483 §10 — "Near you". Pure, no React Native imports so jest can load it.
 * Computed on device against the catalogue's own team rows; nothing is sent anywhere.
 */

export interface NearYouConfig {
  proRadiusMi: number;
  collegeRadiusMi: number;
  slots: number;
  maxPerLeague: number;
  /** A 2nd team in one league only counts as a "multi-team market" inside this many miles of the 1st. */
  metroRadiusMi: number;
  proCap: number;
  collegeCap: number;
}

export const NEAR_YOU_CONFIG: NearYouConfig = {
  proRadiusMi: 75,
  collegeRadiusMi: 150,
  slots: 6,
  maxPerLeague: 2,
  metroRadiusMi: 30,
  proCap: 3,
  collegeCap: 3,
};

export interface NearYouOrigin {
  latitude: number;
  longitude: number;
  /** Two-letter code when known; without it the college rule uses its radius only. */
  state?: string;
}

export interface NearYouResult {
  looks: Look[];
  label: 'Near you' | 'Nearest to you';
}

const EARTH_RADIUS_MI = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "Has a lat" is the test (backend handoff §1) — never `group === 'team'`. */
export const isLocatable = (l: Look): boolean =>
  Number.isFinite(l.lat) && Number.isFinite(l.lng);

const validOrigin = (o?: NearYouOrigin | null): o is NearYouOrigin =>
  !!o && Number.isFinite(o.latitude) && Number.isFinite(o.longitude) &&
  Math.abs(o.latitude) <= 90 && Math.abs(o.longitude) <= 180 &&
  !(o.latitude === 0 && o.longitude === 0);

type Ranked = { look: Look; mi: number };

const byDistance = (a: Ranked, b: Ranked) => a.mi - b.mi || a.look.name.localeCompare(b.look.name);

export function nearYou(
  origin: NearYouOrigin | null | undefined,
  looks: Look[],
  config: NearYouConfig = NEAR_YOU_CONFIG,
): NearYouResult | null {
  if (!validOrigin(origin)) return null;

  const ranked: Ranked[] = looks
    .filter(isLocatable)
    .map((look) => ({ look, mi: haversineMiles(origin.latitude, origin.longitude, look.lat!, look.lng!) }))
    .sort(byDistance);
  if (!ranked.length) return null;

  const state = origin.state?.trim().toUpperCase();
  const sameState = (r: Ranked) => !!state && r.look.state?.toUpperCase() === state;

  // 1. Pro: nearest per league within the radius; a 2nd only in a genuine metro.
  const proInRange = ranked.filter((r) => r.look.tier === 'pro' && r.mi <= config.proRadiusMi);
  const perLeague = new Map<string, Ranked[]>();
  for (const r of proInRange) {
    const list = perLeague.get(r.look.category) ?? [];
    const first = list[0];
    if (!first || (list.length < config.maxPerLeague && r.mi - first.mi <= config.metroRadiusMi)) {
      list.push(r);
    }
    perLeague.set(r.look.category, list);
  }
  const pro = [...perLeague.values()].flat().sort(byDistance);

  // 2. College: in the job's state, else within the college radius.
  const colleges = ranked.filter((r) => r.look.tier === 'college');
  const inState = colleges.filter(sameState);
  const college = inState.length ? inState : colleges.filter((r) => r.mi <= config.collegeRadiusMi);

  // 3. Fill to SLOTS — unused pro slots go to college and vice versa.
  const proN = Math.min(pro.length, config.proCap);
  const colN = Math.min(college.length, config.collegeCap);
  let spare = config.slots - proN - colN;
  const extraPro = Math.max(0, Math.min(pro.length - proN, spare));
  spare -= extraPro;
  const extraCol = Math.max(0, Math.min(college.length - colN, spare));

  const picked = [...pro.slice(0, proN + extraPro), ...college.slice(0, colN + extraCol)];
  const inRange = picked.length;
  const seen = new Set(picked.map((r) => r.look.id));

  // 4. Backfill — same-state by distance, then nearest overall.
  const backfill = (pool: Ranked[]) => {
    for (const r of pool) {
      if (picked.length >= config.slots) return;
      if (!seen.has(r.look.id)) {
        seen.add(r.look.id);
        picked.push(r);
      }
    }
  };
  backfill(ranked.filter(sameState));
  backfill(ranked);

  // 5. Order: pro first, then college, then anything else; each by distance.
  const rank = (r: Ranked) => (r.look.tier === 'pro' ? 0 : r.look.tier === 'college' ? 1 : 2);
  picked.sort((a, b) => rank(a) - rank(b) || byDistance(a, b));

  return {
    looks: picked.map((r) => r.look),
    label: inRange === 0 ? 'Nearest to you' : 'Near you',
  };
}

/** GeoJSON order is [lng, lat]; the lead also exposes flat latitude/longitude on some paths. */
export function leadCoords(lead: any): { latitude: number; longitude: number } | null {
  const num = (v: any) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const c = lead?.location?.coordinates;
  let latitude = Array.isArray(c) ? num(c[1]) : NaN;
  let longitude = Array.isArray(c) ? num(c[0]) : NaN;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    latitude = num(lead?.latitude);
    longitude = num(lead?.longitude);
  }
  return validOrigin({ latitude, longitude }) ? { latitude, longitude } : null;
}

/** "…, Tampa, FL 33602" / "…, FL, 33602" / "…, FL" → "FL". Text only, no network. */
export function stateFromAddress(address?: string | null): string | undefined {
  const text = String(address ?? '');
  const m = text.match(/,\s*([A-Z]{2})\s*,?\s*\d{5}/) ?? text.match(/,\s*([A-Z]{2})\s*(?:,\s*(?:USA|US|United States))?\s*$/);
  return m?.[1];
}

/**
 * §10 location order: job address → rep device (cached fix only, never prompts) →
 * rep's office → none (the row is hidden; no fake default).
 */
export function resolveOrigin(args: {
  lead: any;
  device?: { latitude: number; longitude: number } | null;
  office?: { latitude: number; longitude: number } | null;
}): NearYouOrigin | null {
  const state = stateFromAddress(args.lead?.fullAddress);
  const job = leadCoords(args.lead);
  if (job) return { ...job, state };
  for (const c of [args.device, args.office]) {
    if (c && validOrigin(c)) return { latitude: c.latitude, longitude: c.longitude, state };
  }
  return null;
}
