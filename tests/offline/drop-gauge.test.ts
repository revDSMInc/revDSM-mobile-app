import {
  gaugeTiers,
  gaugeBands,
  shouldShowBands,
  activeBandIndex,
  activeTierIndex,
  isPriceOutOfRange,
  pinFraction,
  tierFractions,
  pinColor,
  gaugeMonthly,
  countUpValue,
  mutedLabelColor,
  gaugeFillStops,
  shouldShowPriceBadge,
  badgeTextColor,
  GAUGE_ENTER,
  GAUGE_LABEL_GREY,
  GAUGE_TIER_COLORS,
  GAUGE_BAND_COLORS,
  GAUGE_INVALID_COLOR,
  GAUGE_FLIP,
  planBlocksDrop,
  planBlocksDropMessage,
  flipStart,
  flipSourceKey,
} from '../../src/screens/DynamicDealCenter/utils/drop-gauge';

/**
 * REVUIUX-584 - the gauge rules, checked against the numbers in Lance's own mockup
 * (cost 1555 / par 3394 / retail 4933 / rollout 5000) so a regression shows up as a
 * disagreement with the thing the client signed off on.
 */
const M = { cost: 1555, par: 3394, retail: 4933 };
const ROLLOUT = 5000;

describe('gaugeTiers - which tiles survive', () => {
  it('shows all four when retail is below the rollout (the mockup default)', () => {
    const t = gaugeTiers(M, ROLLOUT);
    expect(t.map((x) => x.key)).toEqual(['cost', 'par', 'retail', 'rollout']);
    expect(t.map((x) => x.price)).toEqual([1555, 3394, 4933, 5000]);
  });

  it('drops the ROLLOUT tile when retail equals the rollout, to avoid a duplicate tile', () => {
    const t = gaugeTiers(M, 4933);
    expect(t.map((x) => x.key)).toEqual(['cost', 'par', 'retail']);
  });

  it('drops RETAIL once the rollout falls under it - the rule the ticket spells out', () => {
    const t = gaugeTiers(M, 4000);
    expect(t.map((x) => x.key)).toEqual(['cost', 'par', 'rollout']);
    expect(t[2].price).toBe(4000);
  });

  it('drops PAR too once the rollout falls under par', () => {
    expect(gaugeTiers(M, 3000).map((x) => x.key)).toEqual(['cost', 'rollout']);
  });

  it('leaves only ROLLOUT when the rollout is at or below cost', () => {
    expect(gaugeTiers(M, 1555).map((x) => x.key)).toEqual(['rollout']);
    expect(gaugeTiers(M, 900).map((x) => x.key)).toEqual(['rollout']);
  });

  it('never shows a tile above the locked rollout price', () => {
    [900, 1555, 2000, 3394, 4000, 4933, 5000, 9000].forEach((ro) => {
      gaugeTiers(M, ro).forEach((t) => expect(t.price).toBeLessThanOrEqual(ro));
    });
  });

  it('survives missing tiers without throwing', () => {
    expect(() => gaugeTiers(null, 5000)).not.toThrow();
    expect(() => gaugeTiers({}, 0)).not.toThrow();
    expect(gaugeTiers(undefined, 5000).map((x) => x.key)).toEqual(['cost', 'par', 'retail', 'rollout']);
  });
});

describe('gaugeBands - the 2% / 5% commission windows', () => {
  it('builds both bands off retail', () => {
    const b = gaugeBands(M, ROLLOUT);
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual({ lowPct: 55, highPct: 60, from: 2713, to: 2960 });
    // upper band is capped at par - 1, NOT at 65% of base (which would be 3206)
    expect(b[1]).toEqual({ lowPct: 60, highPct: 65, from: 2960, to: 3393 });
  });

  it('caps the upper band just below par so it can never overlap the PAR tile', () => {
    const b = gaugeBands(M, ROLLOUT);
    expect(b[1].to).toBe(M.par - 1);
    expect(b[1].to).toBeLessThan(M.par);
  });

  it('stays on retail when the deal is rolled out BELOW retail (client: "should be greater than cost")', () => {
    const b = gaugeBands(M, 4000);
    expect(b[0].from).toBe(Math.round(M.retail * 0.55));
    expect(b[0].to).toBe(Math.round(M.retail * 0.6));
  });

  it('the reported deal: rollout $11,663 under retail no longer puts the bands under cost', () => {
    // Light+Light Misc on device: COST 7,613 / PAR 10,397 / ROLLOUT 11,663, retail above it.
    // The old min(retail, rollout) base gave 55-60% = $6,415-$6,998, below the COST tile.
    const t = { cost: 7613, par: 10397, retail: 15226 };
    const b = gaugeBands(t, 11663);
    expect(b).toEqual([
      { lowPct: 55, highPct: 60, from: 8374, to: 9136 },
      { lowPct: 60, highPct: 65, from: 9136, to: 10396 },
    ]);
    b.forEach((x) => expect(x.from).toBeGreaterThan(t.cost));
  });

  it('a LeafFilter-style deal with cost under 50% keeps both bands above cost', () => {
    const t = { cost: 4000, par: 6500, retail: 10000 };
    expect(gaugeBands(t, 10000)).toEqual([
      { lowPct: 55, highPct: 60, from: 5500, to: 6000 },
      { lowPct: 60, highPct: 65, from: 6000, to: 6499 },
    ]);
  });

  it('floors a band at cost + 1 when cost sits above 55% of retail, and drops one it empties', () => {
    // 55-60% of 15,000 is 8,250-9,000, entirely at or below cost 9,000 -> gone.
    const b = gaugeBands({ cost: 9000, par: 11000, retail: 15000 }, 15000);
    expect(b).toEqual([{ lowPct: 60, highPct: 65, from: 9001, to: 10999 }]);
  });

  it('never returns a band that starts at or below cost', () => {
    const sets = [M, { cost: 7613, par: 10397, retail: 15226 }, { cost: 9000, par: 11000, retail: 15000 }];
    sets.forEach((t) =>
      [500, 3000, 5000, 9000, 11663, 15226, 20000].forEach((ro) =>
        gaugeBands(t, ro).forEach((x) => expect(x.from).toBeGreaterThan(t.cost))
      )
    );
  });

  it('caps the lower band below par too', () => {
    // 60% of retail (7,200) is above par (7,000): the lower band must stop at par - 1.
    const b = gaugeBands({ cost: 5000, par: 7000, retail: 12000 }, 12000);
    expect(b[0]).toEqual({ lowPct: 55, highPct: 60, from: 6600, to: 6999 });
    expect(b).toHaveLength(1);
  });

  it('omits a band that starts at or above the rollout', () => {
    expect(gaugeBands(M, 2000).every((b) => b.from < 2000)).toBe(true);
  });

  it('builds no band on a rollout below cost - there is no under-par price left to describe', () => {
    // The prototype rebased onto a $500 rollout and drew 275-300 / 300-500, all below COST 1,555,
    // which the drop field refuses. Retail-based windows start above cost, so none survive.
    expect(gaugeBands(M, 500)).toEqual([]);
  });

  it('never returns an inverted window', () => {
    [500, 1555, 2000, 3000, 3394, 4000, 4933, 5000].forEach((ro) => {
      gaugeBands(M, ro).forEach((b) => expect(b.to).toBeGreaterThan(b.from));
    });
  });
});

describe('shouldShowBands', () => {
  it('opens only for a below-par price', () => {
    expect(shouldShowBands(2800, M)).toBe(true);
    expect(shouldShowBands(M.par - 1, M)).toBe(true);
  });

  it('stays shut at or above par, and before anything is typed', () => {
    expect(shouldShowBands(M.par, M)).toBe(false);
    expect(shouldShowBands(4500, M)).toBe(false);
    expect(shouldShowBands(0, M)).toBe(false);
  });
});

describe('activeBandIndex', () => {
  const bands = gaugeBands(M, ROLLOUT);

  it('finds the band holding the price, inclusive at both edges', () => {
    expect(activeBandIndex(2713, bands)).toBe(0);
    expect(activeBandIndex(2800, bands)).toBe(0);
    expect(activeBandIndex(2960, bands)).toBe(0); // shared edge resolves to the lower band
    expect(activeBandIndex(3000, bands)).toBe(1);
    expect(activeBandIndex(3393, bands)).toBe(1);
  });

  it('returns -1 outside every band', () => {
    expect(activeBandIndex(2000, bands)).toBe(-1);
    expect(activeBandIndex(M.par, bands)).toBe(-1);
    expect(activeBandIndex(0, bands)).toBe(-1);
  });
});

describe('activeTierIndex', () => {
  const tiers = gaugeTiers(M, ROLLOUT);

  it('reports the highest tier reached', () => {
    expect(activeTierIndex(1555, tiers)).toBe(0);
    expect(activeTierIndex(3000, tiers)).toBe(0);
    expect(activeTierIndex(3394, tiers)).toBe(1);
    expect(activeTierIndex(4933, tiers)).toBe(2);
    expect(activeTierIndex(5000, tiers)).toBe(3);
  });

  it('is -1 below the first tile or with nothing typed', () => {
    expect(activeTierIndex(1000, tiers)).toBe(-1);
    expect(activeTierIndex(0, tiers)).toBe(-1);
  });
});

describe('isPriceOutOfRange', () => {
  const tiers = gaugeTiers(M, ROLLOUT);

  it('flags a price above the locked rollout', () => {
    expect(isPriceOutOfRange(5001, tiers, ROLLOUT)).toBe(true);
  });

  it('flags a price below the lowest tile', () => {
    expect(isPriceOutOfRange(1000, tiers, ROLLOUT)).toBe(true);
  });

  it('accepts the whole drawable range, edges included', () => {
    [1555, 2500, 3394, 4933, 5000].forEach((p) =>
      expect(isPriceOutOfRange(p, tiers, ROLLOUT)).toBe(false),
    );
  });

  it('is quiet before anything is typed', () => {
    expect(isPriceOutOfRange(0, tiers, ROLLOUT)).toBe(false);
  });
});

describe('pinFraction - display-only pin position', () => {
  const tiers = gaugeTiers(M, ROLLOUT);

  it('seats each tier price exactly on its own tile', () => {
    const fr = tierFractions(tiers.length);
    tiers.forEach((t, i) => {
      expect(pinFraction(t.price, tiers)).toBeCloseTo(fr[i], 5);
    });
  });

  it('stays within 0..1 for everything, in range or not', () => {
    [0, 500, 1555, 2000, 3394, 4933, 5000, 99999].forEach((p) => {
      const f = pinFraction(p, tiers);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    });
  });

  it('rises monotonically with the price', () => {
    let prev = -1;
    for (let p = 1500; p <= 5000; p += 50) {
      const f = pinFraction(p, tiers);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('interpolates linearly inside a segment', () => {
    const mid = (M.cost + M.par) / 2;
    expect(pinFraction(mid, tiers)).toBeCloseTo(1 / 6, 5); // half of the first of three segments
  });

  it('subdivides the cost->par segment at 0.22/0.5/0.78 when bands are open', () => {
    const bands = gaugeBands(M, ROLLOUT);
    const step = 1 / (tiers.length - 1);
    expect(pinFraction(bands[0].from, tiers, bands, true)).toBeCloseTo(step * 0.22, 5);
    expect(pinFraction(bands[0].to, tiers, bands, true)).toBeCloseTo(step * 0.5, 5);
    expect(pinFraction(bands[1].to, tiers, bands, true)).toBeCloseTo(step * 0.78, 5);
  });

  it('pulls a band-region price back onto the band stops when the bands open', () => {
    /**
     * The subdivision does NOT widen the band region - it COMPRESSES it, so the band edges land
     * on fixed, legible stops (0.22 / 0.5 / 0.78 of the first segment) instead of wherever the
     * dollar maths happens to put them. Checked against the mockup's own keypoint scheme:
     * $2,800 reads 0.2257 closed and 0.1062 open.
     */
    const bands = gaugeBands(M, ROLLOUT);
    expect(pinFraction(2800, tiers, bands, false)).toBeCloseTo(0.2257, 3);
    expect(pinFraction(2800, tiers, bands, true)).toBeCloseTo(0.1062, 3);
  });

  it('keeps the band stops in order and inside the first segment when open', () => {
    const bands = gaugeBands(M, ROLLOUT);
    const step = 1 / (tiers.length - 1);
    const at = (p: number) => pinFraction(p, tiers, bands, true);
    expect(at(bands[0].from)).toBeLessThan(at(bands[0].to));
    expect(at(bands[0].to)).toBeLessThan(at(bands[1].to));
    expect(at(bands[1].to)).toBeLessThan(step);
  });

  it('reports 0 for a single-tile scale', () => {
    expect(pinFraction(900, gaugeTiers(M, 900))).toBe(0);
  });

  it('does not divide by zero when two tiers share a price', () => {
    const flat = [
      { key: 'cost' as const, label: 'COST', price: 2000 },
      { key: 'par' as const, label: 'PAR', price: 2000 },
      { key: 'rollout' as const, label: 'ROLLOUT END PRICE', price: 3000 },
    ];
    expect(Number.isFinite(pinFraction(2000, flat))).toBe(true);
    expect(Number.isFinite(pinFraction(2500, flat))).toBe(true);
  });
});

describe('pinColor', () => {
  const tiers = gaugeTiers(M, ROLLOUT);
  const bands = gaugeBands(M, ROLLOUT);

  it('is grey before a price is typed', () => {
    expect(pinColor(0, tiers, bands, false, ROLLOUT)).toBe('#94A3B8');
  });

  it('is red outside the drawable range', () => {
    expect(pinColor(5001, tiers, bands, false, ROLLOUT)).toBe(GAUGE_INVALID_COLOR);
    expect(pinColor(1000, tiers, bands, false, ROLLOUT)).toBe(GAUGE_INVALID_COLOR);
  });

  it('takes the band colour under par with bands open', () => {
    expect(pinColor(2800, tiers, bands, true, ROLLOUT)).toBe(GAUGE_BAND_COLORS[0]);
    expect(pinColor(3100, tiers, bands, true, ROLLOUT)).toBe(GAUGE_BAND_COLORS[1]);
  });

  it('takes the tier colour at and above par', () => {
    expect(pinColor(M.par, tiers, bands, true, ROLLOUT)).toBe(GAUGE_TIER_COLORS.par);
    expect(pinColor(M.retail, tiers, bands, false, ROLLOUT)).toBe(GAUGE_TIER_COLORS.retail);
    expect(pinColor(ROLLOUT, tiers, bands, false, ROLLOUT)).toBe(GAUGE_TIER_COLORS.rollout);
  });

  it('falls back to the cost colour in the cost band with no band hit', () => {
    expect(pinColor(2000, tiers, bands, true, ROLLOUT)).toBe(GAUGE_TIER_COLORS.cost);
  });
});

describe('gaugeMonthly', () => {
  /**
   * Takes the monthly the PLAN produced (via `monthlyForPlan`) and ceils it. The mockup's flat
   * 2% rate is deliberately not reproduced - see the note on the function.
   */
  it('ceils a fractional plan monthly, so a quote is never a cent light', () => {
    expect(gaugeMonthly(59.32)).toBe(60);
    expect(gaugeMonthly(31.1)).toBe(32);
  });

  it('leaves a whole figure alone rather than adding a floating-point cent', () => {
    expect(gaugeMonthly(100)).toBe(100);
    expect(gaugeMonthly(5000 * 0.02)).toBe(100);
  });

  it('is 0 when the plan produced no monthly (cash, or no plan selected)', () => {
    expect(gaugeMonthly(0)).toBe(0);
    expect(gaugeMonthly(-5)).toBe(0);
  });
});

describe('countUpValue - the per-tile monthly animation', () => {
  it('starts at $0 and lands exactly on the target', () => {
    expect(countUpValue(100, 0)).toBe(0);
    expect(countUpValue(100, 1)).toBe(100);
  });

  it('eases OUT - past halfway by a third of the way through', () => {
    // ease-out-cubic at k=1/3 is 1-(2/3)^3 = 0.7037, NOT 0.333. This is the property that breaks
    // if a caller also eases the driver, so it is asserted rather than left implied.
    expect(countUpValue(100, 1 / 3)).toBe(70);
    expect(countUpValue(100, 0.5)).toBe(88);
  });

  it('never overshoots the target or goes negative', () => {
    for (let k = 0; k <= 1.0001; k += 0.01) {
      const v = countUpValue(250, k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(250);
    }
  });

  it('rises monotonically', () => {
    let prev = -1;
    for (let k = 0; k <= 1; k += 0.02) {
      const v = countUpValue(999, k);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('clamps a progress value outside 0..1', () => {
    expect(countUpValue(100, -5)).toBe(0);
    expect(countUpValue(100, 99)).toBe(100);
  });

  it('returns whole dollars, never a fractional frame value', () => {
    for (let k = 0; k <= 1; k += 0.07) {
      expect(Number.isInteger(countUpValue(59, k))).toBe(true);
    }
  });

  it('is 0 for a missing target', () => {
    expect(countUpValue(0, 0.5)).toBe(0);
  });
});

describe('GAUGE_ENTER - timings carried over from the prototype', () => {
  it('matches the prototype CSS and replay() figures', () => {
    expect(GAUGE_ENTER.RISE_PX).toBe(20);
    expect(GAUGE_ENTER.RISE_MS).toBe(500);
    expect(GAUGE_ENTER.RISE_DELAY_MS).toBe(320);
    expect(GAUGE_ENTER.COUNT_UP_MS).toBe(700);
    expect(GAUGE_ENTER.COUNT_UP_DELAY_MS).toBe(300);
    expect(GAUGE_ENTER.COUNT_UP_STAGGER_MS).toBe(80);
    expect(GAUGE_ENTER.PIN_MS).toBe(280);
  });

  it('stages the ring pulse in the cascade the spec intends, not as the mockup behaves', () => {
    /**
     * The mockup never plays this - duplicate `style` attributes leave `--i` unset, so every ring
     * fires at 0ms. The client's animation spec (§2.4) calls that out as a bug to FIX in the
     * port, so the intended 520 / 590 / 660 / 730 cascade is asserted here.
     */
    expect(GAUGE_ENTER.RING_MS).toBe(900);
    const delays = [0, 1, 2, 3].map(
      (i) => GAUGE_ENTER.RING_DELAY_MS + i * GAUGE_ENTER.RING_STAGGER_MS,
    );
    expect(delays).toEqual([520, 590, 660, 730]);
  });

  it('overlaps the rings with the tail of the count-up cascade, as the mockup does', () => {
    // The first ring (520ms) lands between the 3rd count-up (460ms) and the 4th (540ms): the two
    // cascades interleave rather than running in series, which keeps the entry under a second.
    const firstRing = GAUGE_ENTER.RING_DELAY_MS;
    const lastCountUp = GAUGE_ENTER.COUNT_UP_DELAY_MS + 3 * GAUGE_ENTER.COUNT_UP_STAGGER_MS;
    expect(firstRing).toBeGreaterThan(GAUGE_ENTER.COUNT_UP_DELAY_MS);
    expect(firstRing).toBeLessThan(lastCountUp);
  });

  it('staggers four tiles inside the entry window, so none starts after the rise ends', () => {
    const last = GAUGE_ENTER.COUNT_UP_DELAY_MS + 3 * GAUGE_ENTER.COUNT_UP_STAGGER_MS;
    expect(last).toBe(540);
    expect(last).toBeLessThan(GAUGE_ENTER.RISE_DELAY_MS + GAUGE_ENTER.RISE_MS);
  });
});

describe('mutedLabelColor - tile labels read in their own tier colour', () => {
  /**
   * Reproduces the prototype's `color-mix(in srgb, var(--tc) 62%, #94a3b8)`, which React Native
   * has no equivalent for. Expected values computed from that formula.
   */
  it('mixes each tier colour 62% toward grey', () => {
    expect(mutedLabelColor(GAUGE_TIER_COLORS.cost)).toBe('#b1664d');
    expect(mutedLabelColor(GAUGE_TIER_COLORS.par)).toBe('#c9ad4b');
    expect(mutedLabelColor(GAUGE_TIER_COLORS.retail)).toBe('#4db880');
    expect(mutedLabelColor(GAUGE_TIER_COLORS.rollout)).toBe('#5d8fde');
  });

  it('always returns a valid 6-digit hex colour', () => {
    Object.values(GAUGE_TIER_COLORS).forEach((c) => {
      expect(mutedLabelColor(c)).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  it('lands between the tier colour and grey, never outside', () => {
    const chan = (hex: string, i: number) => parseInt(hex.replace('#', '').slice(i * 2, i * 2 + 2), 16);
    const grey = GAUGE_LABEL_GREY;
    Object.values(GAUGE_TIER_COLORS).forEach((c) => {
      const out = mutedLabelColor(c);
      [0, 1, 2].forEach((i) => {
        const lo = Math.min(chan(c, i), chan(grey, i));
        const hi = Math.max(chan(c, i), chan(grey, i));
        expect(chan(out, i)).toBeGreaterThanOrEqual(lo);
        expect(chan(out, i)).toBeLessThanOrEqual(hi);
      });
    });
  });

  it('falls back to grey on malformed input rather than producing NaN', () => {
    expect(mutedLabelColor('')).toBe(GAUGE_LABEL_GREY);
    expect(mutedLabelColor('#abc')).toBe(GAUGE_LABEL_GREY);
    expect(mutedLabelColor(undefined as unknown as string)).toBe(GAUGE_LABEL_GREY);
  });
});

describe('badgeTextColor - the price badge stays readable on every fill', () => {
  it('uses dark text on the light fills, matching the prototype', () => {
    expect(badgeTextColor(GAUGE_TIER_COLORS.par)).toBe('#422006');
    expect(badgeTextColor(GAUGE_BAND_COLORS[1])).toBe('#7C2D12');
  });

  it('uses white on the dark fills', () => {
    expect(badgeTextColor(GAUGE_TIER_COLORS.cost)).toBe('#FFFFFF');
    expect(badgeTextColor(GAUGE_TIER_COLORS.retail)).toBe('#FFFFFF');
    expect(badgeTextColor(GAUGE_TIER_COLORS.rollout)).toBe('#FFFFFF');
    expect(badgeTextColor(GAUGE_BAND_COLORS[0])).toBe('#FFFFFF');
    expect(badgeTextColor('#DC2626')).toBe('#FFFFFF');
  });

  it('is case-insensitive, so a lower-cased fill still gets dark text', () => {
    expect(badgeTextColor(GAUGE_TIER_COLORS.par.toLowerCase())).toBe('#422006');
    expect(badgeTextColor(GAUGE_TIER_COLORS.par.toUpperCase())).toBe('#422006');
  });
});

describe('gaugeFillStops - the fill is a gradient through every tier passed', () => {
  const tiers = gaugeTiers(M, ROLLOUT);
  const bands = gaugeBands(M, ROLLOUT);

  it('runs red -> orange -> yellow -> green -> blue at the rollout', () => {
    const stops = gaugeFillStops(ROLLOUT, tiers, bands, false, ROLLOUT);
    expect(stops.map((s) => s.color)).toEqual([
      GAUGE_TIER_COLORS.cost,
      GAUGE_TIER_COLORS.par,
      GAUGE_TIER_COLORS.retail,
      GAUGE_TIER_COLORS.rollout,
      GAUGE_TIER_COLORS.rollout,
    ]);
  });

  it('only includes tiers actually passed', () => {
    const atPar = gaugeFillStops(M.par, tiers, bands, false, ROLLOUT);
    expect(atPar.map((s) => s.color)).toEqual([
      GAUGE_TIER_COLORS.cost,
      GAUGE_TIER_COLORS.par,
      GAUGE_TIER_COLORS.par,
    ]);
    expect(atPar.some((s) => s.color === GAUGE_TIER_COLORS.retail)).toBe(false);
  });

  it('offsets are a fraction of the FILL, so the last tier sits at its share of the bar', () => {
    const stops = gaugeFillStops(ROLLOUT, tiers, bands, false, ROLLOUT);
    // At the rollout the fill spans the whole track, so each tier sits on its own tile fraction.
    expect(stops[0].offset).toBeCloseTo(0, 5);
    expect(stops[1].offset).toBeCloseTo(1 / 3, 5);
    expect(stops[2].offset).toBeCloseTo(2 / 3, 5);
    expect(stops[3].offset).toBeCloseTo(1, 5);
  });

  it('re-spaces the stops as the bar grows, rather than pinning them to the track', () => {
    // At retail the fill is 2/3 of the track, so PAR (1/3 of the track) sits at HALF the fill.
    const atRetail = gaugeFillStops(M.retail, tiers, bands, false, ROLLOUT);
    expect(atRetail[1].offset).toBeCloseTo(0.5, 5);
  });

  it('always ends at the pin colour', () => {
    [M.cost, 2500, M.par, M.retail, ROLLOUT].forEach((p) => {
      const stops = gaugeFillStops(p, tiers, bands, false, ROLLOUT);
      expect(stops[stops.length - 1].offset).toBe(1);
      expect(stops[stops.length - 1].color).toBe(pinColor(p, tiers, bands, false, ROLLOUT));
    });
  });

  it('uses the BAND colours while in the cost band with bands open', () => {
    const stops = gaugeFillStops(3100, tiers, bands, true, ROLLOUT);
    expect(stops.map((s) => s.color)).toEqual([
      GAUGE_TIER_COLORS.cost,
      GAUGE_BAND_COLORS[0],
      GAUGE_BAND_COLORS[1],
      GAUGE_BAND_COLORS[1],
    ]);
  });

  it('collapses to flat red when the price is out of range', () => {
    expect(gaugeFillStops(9999, tiers, bands, false, ROLLOUT)).toEqual([
      { color: '#DC2626', offset: 1 },
    ]);
  });

  it('is empty before a price is typed', () => {
    expect(gaugeFillStops(0, tiers, bands, false, ROLLOUT)).toEqual([]);
  });

  it('keeps offsets inside 0..1 and non-decreasing, as SVG requires', () => {
    for (let p = 1555; p <= 5000; p += 37) {
      const stops = gaugeFillStops(p, tiers, bands, p < M.par, ROLLOUT);
      let prev = -1;
      stops.forEach((st) => {
        expect(st.offset).toBeGreaterThanOrEqual(0);
        expect(st.offset).toBeLessThanOrEqual(1);
        expect(st.offset).toBeGreaterThanOrEqual(prev);
        prev = st.offset;
      });
    }
  });

  it('does not divide by zero at the very first tier, where the fill has no width', () => {
    const stops = gaugeFillStops(M.cost, tiers, bands, false, ROLLOUT);
    stops.forEach((st) => expect(Number.isFinite(st.offset)).toBe(true));
  });
});

describe('shouldShowPriceBadge - the badge and the bands never share the strip', () => {
  /**
   * `.dscl.rngon .sl-pin u { display: none }` - both sit directly under the track, so showing
   * both stacks the badge over the band pills.
   */
  it('shows the badge when the bands are closed', () => {
    expect(shouldShowPriceBadge(4000, false)).toBe(true);
  });

  it('hides the badge while the bands are open', () => {
    expect(shouldShowPriceBadge(2800, true)).toBe(false);
  });

  it('never shows it before a price is typed, either way', () => {
    expect(shouldShowPriceBadge(0, false)).toBe(false);
    expect(shouldShowPriceBadge(0, true)).toBe(false);
  });

  it('is exclusive with the bands for every price on the scale', () => {
    const tiers = gaugeTiers(M, ROLLOUT);
    const bands = gaugeBands(M, ROLLOUT);
    for (let p = M.cost; p <= ROLLOUT; p += 53) {
      const open = shouldShowBands(p, M);
      const badge = shouldShowPriceBadge(p, open);
      // Exactly one of the two may occupy the strip under the track.
      expect(badge && open).toBe(false);
      if (!open) expect(badge).toBe(true);
    }
    expect(bands.length).toBe(2);
    expect(tiers.length).toBe(4);
  });
});

describe('planBlocksDrop - a plan whose cost leaves no possible drop', () => {
  it('allows a plan with room between cost and rollout (the video: $682 under $686)', () => {
    expect(planBlocksDrop(682, 686)).toBe(false);
  });

  it('blocks a plan whose fee lifts cost past the rollout', () => {
    expect(planBlocksDrop(697, 686)).toBe(true);
  });

  it('blocks cost EQUAL to the rollout: a drop must be below the rollout and at least cost', () => {
    expect(planBlocksDrop(686, 686)).toBe(true);
  });

  it('compares unrounded, as openDrop does', () => {
    expect(planBlocksDrop(685.6, 686)).toBe(false);
  });

  it('blocks nothing before there is a rollout, and is safe on junk', () => {
    expect(planBlocksDrop(697, 0)).toBe(false);
    expect(planBlocksDrop(NaN, 686)).toBe(false);
    expect(planBlocksDrop(697, NaN)).toBe(false);
  });

  it('agrees with the gauge: a blocked plan is exactly one with no COST tile', () => {
    [[682, 686], [686, 686], [697, 686]].forEach(([cost, ro]) => {
      const keys = gaugeTiers({ cost, par: cost + 500, retail: cost + 900 }, ro).map((t) => t.key);
      expect(keys.includes('cost')).toBe(!planBlocksDrop(cost, ro));
    });
  });

  it('names both figures, rounded', () => {
    expect(planBlocksDropMessage(696.6, 686)).toBe('Cost on this plan is $697, at or above your $686 rollout.');
  });
});

describe('the full-screen swap - flipStart / flipSourceKey', () => {
  it('pairs every gauge tile with the rollout tile it flies out of', () => {
    expect(flipSourceKey('cost')).toBe('cost');
    expect(flipSourceKey('par')).toBe('par');
    expect(flipSourceKey('retail')).toBe('retail');
    expect(flipSourceKey('rollout')).toBe('retail');
  });

  it('is the identity when the view is already where it started', () => {
    const r = { x: 10, y: 20, width: 100, height: 60 };
    expect(flipStart(r, r)).toEqual({ translateX: 0, translateY: 0, scale: 1 });
  });

  it('lands the scaled view exactly on the source rect, despite RN scaling about the centre', () => {
    const from = { x: 20, y: 400, width: 120, height: 50 };
    const to = { x: 16, y: 120, width: 90, height: 80 };
    const s = flipStart(from, to)!;
    // Top-left of the transformed view = centre - k*size/2 + translation.
    const left = to.x + to.width / 2 - (s.scale * to.width) / 2 + s.translateX;
    const top = to.y + to.height / 2 - (s.scale * to.height) / 2 + s.translateY;
    expect(left).toBeCloseTo(from.x, 6);
    expect(top).toBeCloseTo(from.y, 6);
    expect(s.scale * to.width).toBeCloseTo(from.width, 6);
  });

  it('returns null rather than a wild transform when a rect is missing or empty', () => {
    const r = { x: 0, y: 0, width: 100, height: 50 };
    expect(flipStart(null, r)).toBeNull();
    expect(flipStart(r, undefined)).toBeNull();
    expect(flipStart({ ...r, width: 0 }, r)).toBeNull();
    expect(flipStart(r, { ...r, height: 0 })).toBeNull();
  });

  it('carries the prototype timings', () => {
    expect(GAUGE_FLIP).toEqual({ MS: 640, STAGGER_MS: 45, PLAN_DELAY_MS: 60, RETURN_MS: 400, RETURN_PX: 14 });
  });
});
