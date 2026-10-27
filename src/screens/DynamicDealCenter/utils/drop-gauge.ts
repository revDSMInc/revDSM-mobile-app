/**
 * REVUIUX-584 - the drop-price entry GAUGE (pure rules, no React).
 *
 * Lance's mockup (artifact DPEp77Tmk2wzAzFuCUNG7o) redesigns what a rep sees after `+ Nth Drop`:
 * instead of a bare price field, the tier prices are drawn as tiles over a scale, with a pin that
 * tracks the price being typed. Everything here is the arithmetic behind that picture.
 *
 * ⚠️ THE PIN IS DISPLAY-ONLY. It is NOT a slider. Confirmed by the repo owner: *"pin is display
 * only and it will depend on the drop price and will be changed accordingly"*. The drop price is
 * only ever set by the keypad. Do not add a drag handler - the whole point of the locked rollout
 * (`Do not allow reps to edit their rollout end prices`) is that prices are typed, not dragged.
 *
 * ⚠️ TIERS COME FROM THE SAVED CALCULATOR - the `{ cost, par, retail }` triple the repo owner
 * confirmed: *"it based on the saved value in the calculator like price: { cost, par, retail }"*.
 * The CALLER must pass the same plan-fee-adjusted values the COST / PAR / RETAIL tiles on the
 * rollout screen already show (`withPlanFee(plans, ..., method)` then `floorTier`), NOT the
 * un-fee'd `computeLogTiers` set used for activity logs, and NOT raw schema sums. The gauge
 * renders inches below those tiles; disagreeing with them would print two different COST
 * figures on one screen. Values arrive already rounded, so nothing here re-rounds them.
 */

/** A tier tile on the gauge. `rollout` is the locked end price, never an editable field. */
export type GaugeTierKey = 'cost' | 'par' | 'retail' | 'rollout';

export interface GaugeTier {
  key: GaugeTierKey;
  /** Display label; `rollout` wraps onto two lines when all four tiles are shown. */
  label: string;
  price: number;
}

export interface GaugeBand {
  /** Low/high percent of the band, e.g. 55 and 60. */
  lowPct: number;
  highPct: number;
  /** Dollar window the band covers, inclusive. */
  from: number;
  to: number;
}

export interface TierTotals {
  cost?: number;
  par?: number;
  retail?: number;
}

/** Tile colours, straight from the mockup. */
export const GAUGE_TIER_COLORS: Record<GaugeTierKey, string> = {
  cost: '#C2410C',
  par: '#EAB308',
  retail: '#22C55E',
  rollout: '#3B82F6',
};

/** Commission-band colours (55-60%, then 60-65%). */
export const GAUGE_BAND_COLORS = ['#F97316', '#FDBA74'];

/** A price outside [cost, rollout] is drawn red. */
export const GAUGE_INVALID_COLOR = '#DC2626';

/** The grey a tile label is mixed toward - the prototype's `--muted`. */
export const GAUGE_LABEL_GREY = '#94A3B8';

/**
 * Which tier tiles to show, and at what value.
 *
 * The ticket states the rule in terms of retail only - *"if you have rollout end price under
 * retail then retail doesn't show anymore bc you don't increase your drop price above what you
 * rolled out"* - but the mockup's `dropSet()` cascades the same reasoning through EVERY tier: a
 * drop can never exceed the rollout, so any tier above the rollout is unreachable and is dropped
 * rather than drawn as a target the rep cannot hit.
 *
 * The cascade, highest-information case first:
 *   retail  <  rollout -> COST, PAR, RETAIL, ROLLOUT  (4 tiles)
 *   retail === rollout -> COST, PAR, RETAIL           (3 - a ROLLOUT tile would duplicate RETAIL)
 *   par     <  rollout -> COST, PAR, ROLLOUT          (3 - retail unreachable)
 *   cost    <  rollout -> COST, ROLLOUT               (2 - par unreachable too)
 *   else               -> ROLLOUT                     (1 - rollout at or below cost)
 *
 * Each surviving tier is clamped to the rollout, so no tile ever reads above the locked price.
 */
export function gaugeTiers(totals: TierTotals | null | undefined, rollout: number): GaugeTier[] {
  const ro = Number(rollout) || 0;
  const cost = Number(totals?.cost) || 0;
  const par = Number(totals?.par) || 0;
  const retail = Number(totals?.retail) || 0;
  const clamp = (v: number): number => Math.min(v, ro);
  const rolloutTile: GaugeTier = { key: 'rollout', label: 'ROLLOUT END PRICE', price: ro };

  if (retail < ro) {
    return [
      { key: 'cost', label: 'COST', price: clamp(cost) },
      { key: 'par', label: 'PAR', price: clamp(par) },
      { key: 'retail', label: 'RETAIL', price: clamp(retail) },
      rolloutTile,
    ];
  }
  if (retail === ro) {
    return [
      { key: 'cost', label: 'COST', price: clamp(cost) },
      { key: 'par', label: 'PAR', price: clamp(par) },
      { key: 'retail', label: 'RETAIL', price: clamp(retail) },
    ];
  }
  if (par < ro) {
    return [
      { key: 'cost', label: 'COST', price: clamp(cost) },
      { key: 'par', label: 'PAR', price: clamp(par) },
      rolloutTile,
    ];
  }
  if (cost < ro) {
    return [{ key: 'cost', label: 'COST', price: clamp(cost) }, rolloutTile];
  }
  return [rolloutTile];
}

/**
 * The 55-60% and 60-65% commission bands.
 *
 * From the ticket: *"reps can make 2% commission and 5% commission at these tiers respectively so
 * if they're under par it'll be good to know those tiers as a rep"*. These are NOT extra tiers -
 * they subdivide the COST->PAR gap, the under-par region where a rep still earns something.
 *
 * ⚠️ The base is `min(retail, rollout)`, NOT retail. On a deal rolled out below retail the
 * percentages follow what was actually rolled out, matching the clamped tiles.
 *
 * ⚠️ The upper band stops at `par - 1`, not at 65% of base. The bands exist to describe
 * BELOW-par pricing; letting the top band cross par would overlap the PAR tile and tell the rep
 * they are earning a reduced commission on a price that is actually at or above par.
 *
 * A band is omitted when it starts at/above the rollout, or when it has collapsed to nothing.
 */
export function gaugeBands(totals: TierTotals | null | undefined, rollout: number): GaugeBand[] {
  const ro = Number(rollout) || 0;
  const par = Number(totals?.par) || 0;
  const base = Math.min(Number(totals?.retail) || 0, ro);
  const out: GaugeBand[] = [];
  ([[55, 60], [60, 65]] as Array<[number, number]>).forEach(([lowPct, highPct]) => {
    const from = Math.round((base * lowPct) / 100);
    const to = highPct === 65 ? Math.min(ro, par - 1) : Math.min(ro, Math.round((base * highPct) / 100));
    if (from >= ro || to <= from) return;
    out.push({ lowPct, highPct, from, to });
  });
  return out;
}

/** Should the commission bands be shown? They open on their own once a below-par price is typed. */
export function shouldShowBands(price: number, totals: TierTotals | null | undefined): boolean {
  const p = Number(price) || 0;
  const par = Number(totals?.par) || 0;
  return p > 0 && p < par;
}

/** Index of the band containing `price`, or -1. Used to highlight one band and tint the pin. */
export function activeBandIndex(price: number, bands: GaugeBand[]): number {
  const p = Number(price) || 0;
  if (p <= 0) return -1;
  return bands.findIndex((b) => p >= b.from && p <= b.to);
}

/**
 * Index of the highest tier the price has reached, or -1 when it is below the first tile.
 * Drives which tile reads as "current" and how far the fill bar is drawn.
 */
export function activeTierIndex(price: number, tiers: GaugeTier[]): number {
  const p = Number(price) || 0;
  if (p <= 0) return -1;
  let idx = -1;
  tiers.forEach((t, i) => {
    if (p >= t.price) idx = i;
  });
  return idx;
}

/**
 * Is the typed price outside the drawable range?
 *
 * Above the rollout is impossible by the locked-rollout rule; below the lowest tile is off the
 * left end of the scale. Either way the mockup paints the pin and fill red rather than clamping
 * silently, so the rep sees that the number is wrong instead of seeing a plausible position.
 */
export function isPriceOutOfRange(price: number, tiers: GaugeTier[], rollout: number): boolean {
  const p = Number(price) || 0;
  if (p <= 0 || !tiers.length) return false;
  return p > (Number(rollout) || 0) || p < tiers[0].price;
}

/**
 * Where the pin sits, as a 0..1 fraction of the scale.
 *
 * ⚠️ The scale is PIECEWISE-LINEAR between tiles, not linear in dollars. Each tile sits at an
 * even fraction of the width, so the COST->PAR gap gets the same room as PAR->RETAIL even when
 * the dollar gaps differ wildly. That is deliberate: the dollar distances between tiers are
 * arbitrary, and a dollar-linear scale would crush the low tiers - where the commission bands
 * live, and where a rep most needs to read their position - into a sliver.
 *
 * With bands open, the COST->PAR segment is subdivided at the mockup's 0.22 / 0.5 / 0.78 stops so
 * each band gets visible width.
 *
 * Returns a value clamped to 0..1; a single-tile scale always reports 0.
 */
export function pinFraction(
  price: number,
  tiers: GaugeTier[],
  bands: GaugeBand[] = [],
  showBands = false,
): number {
  const p = Number(price) || 0;
  const n = tiers.length;
  if (n <= 1 || p <= 0) return 0;

  // Key points: tier prices, plus the band edges when the bands are expanded.
  const prices: number[] = [tiers[0].price];
  const stops: number[] = [0];
  const bandsOpen =
    showBands &&
    bands.length === 2 &&
    tiers[0].key === 'cost' &&
    tiers[1]?.key === 'par' &&
    bands[0].from > tiers[0].price &&
    bands[1].to < tiers[1].price;

  const step = 1 / (n - 1);
  if (bandsOpen) {
    prices.push(bands[0].from, bands[0].to, bands[1].to);
    stops.push(step * 0.22, step * 0.5, step * 0.78);
  }
  for (let i = 1; i < n; i += 1) {
    prices.push(tiers[i].price);
    stops.push(step * i);
  }

  const m = prices.length;
  if (p <= prices[0]) return 0;
  for (let i = 0; i < m - 1; i += 1) {
    if (p <= prices[i + 1]) {
      const span = prices[i + 1] - prices[i];
      if (span <= 0) return stops[i];
      return stops[i] + ((p - prices[i]) / span) * (stops[i + 1] - stops[i]);
    }
  }
  return 1;
}

/** Even horizontal position of each tile, as a 0..1 fraction. Pairs with `pinFraction`. */
export function tierFractions(count: number): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, i) => i / (count - 1));
}

/**
 * Colour for the pin at `price`: red when out of range, else the active band's colour (below par)
 * or the active tier's colour, falling back to grey before anything is typed.
 */
export function pinColor(
  price: number,
  tiers: GaugeTier[],
  bands: GaugeBand[],
  showBands: boolean,
  rollout: number,
): string {
  const p = Number(price) || 0;
  if (p <= 0) return '#94A3B8';
  if (isPriceOutOfRange(p, tiers, rollout)) return GAUGE_INVALID_COLOR;
  const tierIdx = activeTierIndex(p, tiers);
  if (tierIdx === 0 && showBands) {
    const b = activeBandIndex(p, bands);
    if (b >= 0) return GAUGE_BAND_COLORS[b] || GAUGE_TIER_COLORS[tiers[0].key];
  }
  if (tierIdx < 0) return '#94A3B8';
  return GAUGE_TIER_COLORS[tiers[tierIdx].key];
}

/**
 * Monthly figure under each tile.
 *
 * ⚠️ The MOCKUP hardcodes `rate: 0.02` (the 1/50th plan) and ceils. That is a stand-in for the
 * prototype only - do NOT ship it. The real figure must come from `monthlyForPlan`, which honours
 * the selected plan's payment factor, its duration fallback and the per-plan minimum payments
 * (`1148` / `1019` / `3198` / `1529`). Quoting a flat 2% here would contradict the monthly shown
 * everywhere else on the same screen for the same price.
 *
 * This wrapper exists only to ceil the plan's figure: a monthly quoted a cent under what the
 * lender actually charges is a number the rep has to walk back in front of the customer. The
 * epsilon keeps an exact multiple (a $5,000 price at a 2% factor) from ceiling to $101.
 */
export function gaugeMonthly(planMonthly: number): number {
  const m = Number(planMonthly) || 0;
  if (m <= 0) return 0;
  return Math.ceil(m - 1e-9);
}

/**
 * Entry-animation timings, taken from the prototype's CSS and `replay()` so the feel matches
 * what the client approved rather than being re-guessed:
 *   `.enter .dentry { animation: rise .5s cubic-bezier(.2,.9,.25,1); delay: 320ms }`
 *   `countUp(el, monthly, 300 + i*80, 700)`
 *   `.sl-pin { transition: left .28s cubic-bezier(.3,1.25,.4,1) }`
 */
export const GAUGE_ENTER = {
  /** The block rises this far (px) as it fades in - prototype `@keyframes rise`. */
  RISE_PX: 20,
  RISE_MS: 500,
  RISE_DELAY_MS: 320,
  /** Per-tile monthly count-up. */
  COUNT_UP_MS: 700,
  COUNT_UP_DELAY_MS: 300,
  COUNT_UP_STAGGER_MS: 80,
  /** Pin slide between keystrokes. */
  PIN_MS: 280,
} as const;

/**
 * The value to display part-way through a count-up, for `progress` in 0..1.
 *
 * ⚠️ The EASING IS APPLIED HERE, not by the driver. The prototype eases the VALUE
 * (`to * (1 - (1-k)^3)`, ease-out-cubic) rather than the clock, so the figure sprints and then
 * settles. Feeding this an already-eased driver would apply the curve twice and make the last
 * third crawl. The caller must drive it LINEARLY.
 *
 * Rounded, because a monthly payment is only ever shown in whole dollars - and because an
 * un-rounded frame value would render as `$59.4173828125`.
 */
export function countUpValue(to: number, progress: number): number {
  const target = Number(to) || 0;
  const k = Math.min(1, Math.max(0, Number(progress) || 0));
  return Math.round(target * (1 - Math.pow(1 - k, 3)));
}

/**
 * Mix a tier colour 62% of the way toward grey, for the tile LABEL.
 *
 * The prototype does this in CSS - `color-mix(in srgb, var(--tc) 62%, #94a3b8)` - which React
 * Native has no equivalent for, so it is computed here. The effect is that COST / PAR / RETAIL /
 * ROLLOUT END PRICE each read in a muted version of their own colour rather than in flat grey,
 * which is how a tile is identifiable before any price is typed.
 */
export function mutedLabelColor(tierColor: string): string {
  const hex = String(tierColor || '').replace('#', '');
  if (hex.length !== 6) return GAUGE_LABEL_GREY;
  const mix = (start: number, end: number): number => Math.round(start * 0.62 + end * 0.38);
  const grey = [0x94, 0xa3, 0xb8];
  const rgb = [0, 2, 4].map((i, k) => mix(parseInt(hex.slice(i, i + 2), 16), grey[k]));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Text colour for the price badge under the pin.
 *
 * ⚠️ Dark text on the light fills, white on the dark ones. The prototype picks `#422006` on PAR
 * (yellow) and `#7c2d12` on the upper commission band (pale orange), because white on either is
 * unreadable. Everything else takes white.
 */
export function badgeTextColor(fill: string): string {
  const f = String(fill || '').toLowerCase();
  if (f === GAUGE_TIER_COLORS.par.toLowerCase()) return '#422006';
  if (f === GAUGE_BAND_COLORS[1].toLowerCase()) return '#7C2D12';
  return '#FFFFFF';
}

export interface GaugeFillStop {
  /** Colour at this stop. */
  color: string;
  /** Position along the FILL (0..1), not along the whole track. */
  offset: number;
}

/**
 * Colour stops for the fill bar left of the pin.
 *
 * ⚠️ THE FILL IS A GRADIENT THROUGH EVERY TIER ALREADY PASSED, not a flat colour. The
 * prototype builds `linear-gradient(90deg, ...)` with one stop per passed tier - so at the
 * rollout the bar runs red -> orange -> yellow -> green -> blue, showing the whole journey rather
 * than only where the price landed. A solid bar loses that and was reported from a device.
 *
 * ⚠️ Offsets are a fraction of the FILL WIDTH, not of the track. The prototype divides by `fw`
 * (the pin's distance from the start), so the stops re-space as the bar grows. Dividing by the
 * track width instead would bunch every colour at the left end.
 *
 * Three cases, mirroring the prototype:
 *   - out of range  -> a single flat red
 *   - in the cost band with bands open -> the BAND colours, since that is what the pin shows
 *   - otherwise -> one stop per passed tier
 * The current pin colour is always appended at 1.0 so the bar meets the pin in its own colour.
 */
export function gaugeFillStops(
  price: number,
  tiers: GaugeTier[],
  bands: GaugeBand[],
  showBands: boolean,
  rollout: number,
): GaugeFillStop[] {
  const p = Number(price) || 0;
  const current = pinColor(p, tiers, bands, showBands, rollout);
  if (p <= 0 || !tiers.length) return [];
  if (isPriceOutOfRange(p, tiers, rollout)) return [{ color: GAUGE_INVALID_COLOR, offset: 1 }];

  const pinAt = pinFraction(p, tiers, bands, showBands);
  if (pinAt <= 0) return [{ color: current, offset: 1 }];

  const tierIdx = activeTierIndex(p, tiers);
  const stops: GaugeFillStop[] = [];
  const at = (v: number): number => pinFraction(v, tiers, bands, showBands) / pinAt;

  const inCostBandWithBands =
    tierIdx === 0 && showBands && bands.length === 2 && tiers[0]?.key === 'cost';

  if (inCostBandWithBands) {
    stops.push({ color: GAUGE_TIER_COLORS[tiers[0].key], offset: 0 });
    if (p >= bands[0].from) stops.push({ color: GAUGE_BAND_COLORS[0], offset: at(bands[0].from) });
    if (p >= bands[1].from) stops.push({ color: GAUGE_BAND_COLORS[1], offset: at(bands[1].from) });
  } else {
    for (let i = 0; i <= tierIdx; i += 1) {
      stops.push({ color: GAUGE_TIER_COLORS[tiers[i].key], offset: at(tiers[i].price) });
    }
  }

  stops.push({ color: current, offset: 1 });
  // Clamp and keep offsets non-decreasing: an SVG gradient renders nothing useful otherwise.
  let last = 0;
  return stops.map((st) => {
    const offset = Math.min(1, Math.max(last, Number.isFinite(st.offset) ? st.offset : 0));
    last = offset;
    return { color: st.color, offset };
  });
}
