import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, LayoutChangeEvent, Pressable, Easing, Animated } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
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
  GAUGE_TIER_COLORS,
  GAUGE_BAND_COLORS,
  GAUGE_ENTER,
  GAUGE_FLIP,
  flipSourceKey,
  type FlipRect,
  type TierTotals,
} from '../utils/drop-gauge';
import { FlipFromRect } from './FlipFromRect';

/**
 * REVUIUX-584 - the drop-price gauge shown while a rep types a drop.
 *
 * Lance: *"We want to redesign what the drop interface looks like for a rep. Do not change
 * anything else."* So this component ONLY draws; it owns no price state, fires no callbacks and
 * writes nothing. The price arrives as a prop from the keypad field beside it.
 *
 * ⚠️ THE PIN IS DISPLAY-ONLY - not a slider. Confirmed by the repo owner. There is deliberately
 * no `PanResponder` and no gesture handler on the scale: a rep must not be able to set a price by
 * dragging, because the rollout it is measured against is itself locked. The ONLY touch target in
 * here is the chevron on the COST tile, which hides/shows the commission bands.
 *
 * ⚠️ PURE-RULES SPLIT. Every number comes from `utils/drop-gauge.ts`, which imports no React
 * Native and is unit-tested in `tests/offline/drop-gauge.test.ts` against the exact figures in
 * Lance's prototype. Keep arithmetic OUT of this file - a component here cannot be tested at all
 * (see CLAUDE.md: `render` returns no queries under React 19).
 *
 * ⚠️ OFFLINE: nothing to do. The gauge is a projection of `tiers` + `rollout`, both already
 * computed locally from the calculator entries, so it behaves identically with no connection -
 * animations included, since they are driven by local state and not by a response. Do not add a
 * fetch here to "enrich" the tiers; that would make the gauge the one part of the drop flow that
 * needs a network.
 */

const fmtMoney = (v: number): string => `$${Math.round(v).toLocaleString('en-US')}`;

/** Fixed width for the pin's price badge, so it can be centred on the pin and clamped to the row. */
const BADGE_W = 80;

export interface DropPriceGaugeProps {
  /** The price being typed. 0 / NaN before the rep enters anything. */
  price: number;
  /** Plan-fee-adjusted tier totals - the SAME values as the COST/PAR/RETAIL tiles above. */
  tiers: TierTotals;
  /** The locked rollout end price. Never editable here. */
  rollout: number;
  /** Monthly for a given price under the selected plan (`monthlyForPlan`), or omitted for cash. */
  monthlyFor?: (price: number) => number;
  /**
   * The price field itself. The gauge RENDERS it, rather than sitting above an input the caller
   * draws, because the prototype puts the field and the live per-month side by side on one row
   * (field 176px at x=16, readout at x=206, both 56px tall). Owning the row is the only way to
   * get that pairing without the caller duplicating the layout.
   */
  children?: React.ReactNode;
  /**
   * Window rects of the rollout card's COST / PAR / RETAIL tiles, captured as `+ Nth Drop` was
   * tapped. When given, each tile MORPHS out of its rollout twin (the prototype's `flip()`), and
   * the tiles skip the rise - in the prototype only the scale, field and readout rise; the tiles
   * fly. Omitted, the gauge enters exactly as before.
   */
  flipFrom?: Partial<Record<'cost' | 'par' | 'retail', FlipRect>> | null;
}

/**
 * The per-tile monthly, counting up from $0 on entry.
 *
 * Mirrors the prototype's `countUp`: ease-out-cubic over 700ms, starting at `300 + i * 80` ms so
 * the tiles cascade left to right. The figure is TEXT, so it cannot be animated on the UI thread
 * by Reanimated - this drives a JS-thread `Animated.Value` and formats each frame. That is cheap
 * (one short-lived timer per tile, at most four tiles) and only runs on entry.
 */
const CountUpMonthly: React.FC<{ to: number; index: number; runKey: number }> = ({
  to,
  index,
  runKey,
}) => {
  const [shown, setShown] = useState(to);
  const driver = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (to <= 0) {
      setShown(0);
      return undefined;
    }
    driver.setValue(0);
    setShown(0);
    const sub = driver.addListener(({ value }) => setShown(countUpValue(to, value)));
    const anim = Animated.timing(driver, {
      toValue: 1,
      duration: GAUGE_ENTER.COUNT_UP_MS,
      delay: GAUGE_ENTER.COUNT_UP_DELAY_MS + index * GAUGE_ENTER.COUNT_UP_STAGGER_MS,
      // ⚠️ LINEAR on purpose. `countUpValue` applies the ease-out-cubic itself, matching the
      // prototype, which eases the VALUE rather than the clock. Easing here too would apply the
      // curve twice and make the last third of the count crawl.
      easing: Easing.linear,
      // Formatting text each frame has to happen in JS.
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) setShown(to);
    });
    return () => {
      anim.stop();
      driver.removeListener(sub);
    };
  }, [to, index, runKey, driver]);

  if (to <= 0) return null;
  return (
    <>
      <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: '#EDF0F2', marginVertical: 5 }} />
      <Text style={{ fontSize: 15, fontWeight: '900', color: '#16A34A' }}>{fmtMoney(shown)}</Text>
      <Text style={{ fontSize: 9, fontWeight: '700', color: '#94A3B8', marginTop: 1 }}>per month</Text>
    </>
  );
};

/** One tier tile. The COST tile alone carries the chevron that hides/shows the bands. */
const TierTile: React.FC<{
  label: string;
  price: number;
  color: string;
  monthly: number;
  index: number;
  runKey: number;
  isCurrent: boolean;
  bandsToggle?: { open: boolean; onToggle: () => void };
}> = ({ label, price, color, monthly, index, runKey, isCurrent, bandsToggle }) => {
  /**
   * The ring pulse - a green halo that expands out of each tile and fades, cascading left to
   * right. See `GAUGE_ENTER.RING_*`: the mockup's own markup bug stops this ever playing there,
   * so the stagger is implemented as the client's animation spec intends.
   *
   * Drawn as a sibling overlay because React Native has no spreading `box-shadow`.
   */
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    ring.setValue(0);
    const anim = Animated.timing(ring, {
      toValue: 1,
      duration: GAUGE_ENTER.RING_MS,
      delay: GAUGE_ENTER.RING_DELAY_MS + index * GAUGE_ENTER.RING_STAGGER_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [runKey, index, ring]);

  const body = (
    <View
      style={{
        flex: 1,
        flexBasis: 0,
        minWidth: 0,
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 8,
        paddingHorizontal: 4,
        borderRadius: 12,
        backgroundColor: '#fff',
        borderWidth: isCurrent ? 2 : 1,
        borderColor: isCurrent ? color : '#DFE3E7',
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: 'rgba(75,160,84,0.45)',
          opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
        }}
      />
      {/* The coloured cap: how a tile says which tier it is even before a price is typed. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          width: 22,
          height: 3,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
          backgroundColor: color,
        }}
      />
      {bandsToggle && (
        <View style={{ position: 'absolute', top: 6, right: 6 }}>
          <Ionicons
            name={bandsToggle.open ? 'chevron-up' : 'chevron-down'}
            size={11}
            color={color}
            style={{ opacity: 0.65 }}
          />
        </View>
      )}
      {/* The label reads in a MUTED version of its own tier colour, not flat grey - the
          prototype's `color-mix(in srgb, var(--tc) 62%, #94a3b8)`. It is how a tile is
          identifiable before any price is typed. */}
      <Text
        numberOfLines={2}
        style={{
          fontSize: 8,
          fontWeight: '900',
          letterSpacing: 0.8,
          textAlign: 'center',
          marginBottom: 3,
          color: isCurrent ? color : mutedLabelColor(color),
        }}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={{
          alignSelf: 'stretch',
          textAlign: 'center',
          fontSize: 15,
          fontWeight: '900',
          color: '#212B36',
        }}
      >
        {fmtMoney(price)}
      </Text>
      <CountUpMonthly to={monthly} index={index} runKey={runKey} />
    </View>
  );

  if (!bandsToggle) return body;
  return (
    /* The ONLY touch target on the gauge. `hitSlop` because the chevron itself is 11px. */
    <Pressable
      onPress={bandsToggle.onToggle}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={{ flex: 1, flexBasis: 0, minWidth: 0 }}
      accessibilityRole="button"
      accessibilityLabel={bandsToggle.open ? 'Hide commission ranges' : 'Show commission ranges'}
    >
      {body}
    </Pressable>
  );
};

const DropPriceGauge: React.FC<DropPriceGaugeProps> = ({ price, tiers, rollout, monthlyFor, children, flipFrom }) => {
  /**
   * The scale is laid out in PIXELS, so it needs its own measured width. `onLayout` fires after
   * the first paint; until then the track renders at zero width and only the tiles show.
   */
  const [trackWidth, setTrackWidth] = useState(0);
  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - trackWidth) > 0.5) setTrackWidth(w);
  };

  const p = Number(price) || 0;
  const tileSet = useMemo(() => gaugeTiers(tiers, rollout), [tiers, rollout]);
  const bands = useMemo(() => gaugeBands(tiers, rollout), [tiers, rollout]);

  /**
   * Band visibility: `null` means "follow the price" (open below par), and a boolean is the rep's
   * own choice, which wins until the gauge is re-entered. This is the prototype's `rngOpen`
   * tri-state exactly - *"when rep write it will down by default but he can hide it as well"*.
   */
  const [bandsOverride, setBandsOverride] = useState<boolean | null>(null);
  const autoOpen = shouldShowBands(p, tiers);
  const bandsOpen = bandsOverride !== null ? bandsOverride : autoOpen;
  const toggleBands = useCallback(() => setBandsOverride(!bandsOpen), [bandsOpen]);

  /**
   * Tile centres. The tiles are evenly sized with a 6px gap, so the first centre sits half a tile
   * in from the left and the last the same distance from the right; the track spans between them.
   */
  const tileGap = 6;
  const tileW =
    tileSet.length > 0 ? (trackWidth - tileGap * (tileSet.length - 1)) / tileSet.length : 0;
  const trackInset = trackWidth > 0 ? tileW / 2 : 0;
  const trackSpan = Math.max(0, trackWidth - tileW);

  const fractions = useMemo(() => tierFractions(tileSet.length), [tileSet.length]);
  const tierIdx = activeTierIndex(p, tileSet);
  const bandIdx = bandsOpen ? activeBandIndex(p, bands) : -1;
  const outOfRange = isPriceOutOfRange(p, tileSet, rollout);
  const pinPct = pinFraction(p, tileSet, bands, bandsOpen);
  const pinHue = pinColor(p, tileSet, bands, bandsOpen, rollout);
  /** Current fill width in px. The Svg, the gradient's x2 and the rect all take THIS one value. */
  const fillW = Math.max(1, trackSpan * pinPct);
  const fillStops = useMemo(
    () => gaugeFillStops(p, tileSet, bands, bandsOpen, rollout),
    [p, tileSet, bands, bandsOpen, rollout],
  );
  const hasPrice = p > 0;
  const liveMonthly = gaugeMonthly(monthlyFor && hasPrice ? monthlyFor(p) : 0);

  /**
   * The entry animation, mirroring the prototype's `.enter` class: the whole block rises 20px and
   * fades in, and the per-tile monthlies count up from $0. `runKey` restarts the count-up, and is
   * bumped only when the gauge re-enters - NOT on every keystroke, which would re-trigger the
   * cascade while the rep is still typing.
   */
  const enter = useRef(new Animated.Value(0)).current;
  const [runKey, setRunKey] = useState(0);
  useEffect(() => {
    enter.setValue(0);
    setRunKey((k) => k + 1);
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: GAUGE_ENTER.RISE_MS,
      delay: GAUGE_ENTER.RISE_DELAY_MS,
      easing: Easing.bezier(0.2, 0.9, 0.25, 1),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    // Mount only: re-entry unmounts this component, so there is nothing else to key on.
  }, [enter]);

  /** The pin slides rather than jumping between keystrokes. */
  const pinAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!trackSpan) return undefined;
    const anim = Animated.timing(pinAnim, {
      toValue: trackSpan * pinPct,
      duration: GAUGE_ENTER.PIN_MS,
      easing: Easing.bezier(0.3, 1.25, 0.4, 1),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [pinPct, trackSpan, pinAnim]);

  if (!tileSet.length) return null;

  const costToggle =
    tileSet[0]?.key === 'cost' && bands.length > 0
      ? { open: bandsOpen, onToggle: toggleBands }
      : undefined;

  const riseStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };
  const flipping = !!flipFrom;

  return (
    <View style={{ marginBottom: 14 }}>
      {/* Tier tiles. With `flipFrom` each one flies out of its rollout-card twin, staggered 45ms,
          and the row does NOT rise - the prototype animates the tiles by FLIP alone. */}
      <Animated.View style={[{ flexDirection: 'row', gap: 6, marginBottom: 10 }, flipping ? null : riseStyle]}>
        {tileSet.map((t, i) => (
          <FlipFromRect
            key={t.key}
            from={flipFrom ? flipFrom[flipSourceKey(t.key)] : undefined}
            delay={i * GAUGE_FLIP.STAGGER_MS}
            style={{ flex: 1, flexBasis: 0, minWidth: 0 }}
          >
            <TierTile
              label={t.label}
              price={t.price}
              color={GAUGE_TIER_COLORS[t.key]}
              monthly={gaugeMonthly(monthlyFor ? monthlyFor(t.price) : 0)}
              index={i}
              runKey={runKey}
              isCurrent={hasPrice && !outOfRange && i === tierIdx}
              bandsToggle={i === 0 ? costToggle : undefined}
            />
          </FlipFromRect>
        ))}
      </Animated.View>

      <Animated.View style={riseStyle}>

      {/* Scale: track, per-tier dots, fill up to the pin, and the pin itself.

          ⚠️ The track spans CENTRE-TO-CENTRE of the first and last tiles, not edge to edge
          (prototype `paintScale`: `ln.style.left = L; width = Rr - L`, where L/Rr are tile
          centres). Running it the full width pushes the end dots half off each side - the
          ROLLOUT dot was clipped by the Done button on a real device.

          ⚠️ THE ROW HEIGHT FOLLOWS THE BADGE, which is the only thing needing space below the
          track (it sits at `top: 22`). With the bands open the badge is hidden - see
          `shouldShowPriceBadge` - so reserving its height leaves a dead gap above the band pills.
          The prototype sizes this block at 52u and places the pills at `top: 25u` INSIDE it, i.e.
          tight under the track, not stacked below a badge-sized row. */}
      {tileSet.length > 1 && (
        <View
          style={{ height: shouldShowPriceBadge(p, bandsOpen) ? 50 : 20 }}
          onLayout={onTrackLayout}
        >
          {/* Track */}
          <View
            style={{
              position: 'absolute',
              left: trackInset,
              width: Math.max(0, trackSpan),
              top: 8.5,
              height: 3,
              borderRadius: 2,
              backgroundColor: '#E2E8F0',
            }}
          />
          {/* Fill, up to the pin.

              ⚠️ A GRADIENT through every tier already passed (red -> orange -> yellow -> green ->
              blue at the rollout), not a flat bar - the prototype's `linear-gradient(90deg, ...)`.
              It shows the whole journey rather than only where the price landed. Rendered with
              `react-native-svg` because React Native has no gradient primitive; the stop maths is
              in `gaugeFillStops` and is unit-tested.

              ⚠️ The Svg is sized to the CURRENT FILL, not to the full span, because the stop
              offsets are fractions OF THE FILL. Drawing them across the full span and clipping
              would put every colour at the wrong place - the gradient has to be re-laid out as
              the bar grows, which is exactly what the prototype does when it recomputes the
              stops against `fw` on each keystroke. */}
          {hasPrice && trackWidth > 0 && fillStops.length > 0 && (
            <Animated.View
              style={{
                position: 'absolute',
                left: trackInset,
                top: 8.5,
                // Animated in step with the pin: a jumping bar beside a gliding pin visibly
                // separates the two mid-keystroke.
                width: pinAnim,
                height: 3,
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <Svg width={fillW} height={3}>
                <Defs>
                  {/* ⚠️ `gradientUnits="userSpaceOnUse"` with x2 = the fill's PIXEL width.
                      The default is `objectBoundingBox`, where x1/x2 are 0..1 fractions - but
                      react-native-svg resolves bare numbers in USER SPACE, so `x2="1"` squeezes
                      the whole gradient into the first pixel and paints the rest in the last
                      stop's colour. That is exactly how this first shipped: a flat blue bar. */}
                  <LinearGradient
                    id="gaugeFill"
                    gradientUnits="userSpaceOnUse"
                    x1={0}
                    y1={0}
                    x2={fillW}
                    y2={0}
                  >
                    {fillStops.map((st, i) => (
                      <Stop
                        key={`${st.color}-${i}`}
                        offset={st.offset}
                        stopColor={st.color}
                        stopOpacity={1}
                      />
                    ))}
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={fillW} height={3} fill="url(#gaugeFill)" />
              </Svg>
            </Animated.View>
          )}
          {/* ⚠️ COMMISSION BANDS DRAWN ON THE TRACK ITSELF.

              The prototype's `.sl-band` is `top: 6u; height: 10u` - a thick segment sitting ON
              the line, between the track and the dots. Reported by the client as *"Missing 55-60
              and 60-65 on timeline"*: the pills below carry the dollar ranges, but on their own
              they read as a legend, and the segment that shows WHERE on the scale those ranges
              fall was absent.

              ⚠️ Unhit band = its colour at 38% (`color-mix(... 38%, transparent)`); the band
              holding the price = the solid colour. A single flat opacity loses the "which band am
              I in" signal the bands exist for. */}
          {bandsOpen && trackWidth > 0 &&
            bands.map((b, k) => {
              const from = trackInset + pinFraction(b.from, tileSet, bands, true) * trackSpan;
              const to = trackInset + pinFraction(b.to, tileSet, bands, true) * trackSpan;
              return (
                <View
                  key={`band-${b.lowPct}-${b.highPct}`}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: 5,
                    left: from,
                    width: Math.max(3, to - from),
                    height: 10,
                    borderRadius: 5,
                    backgroundColor:
                      bandIdx === k ? GAUGE_BAND_COLORS[k] : `${GAUGE_BAND_COLORS[k]}61`,
                  }}
                />
              );
            })}
          {/* Tier dots */}
          {trackWidth > 0 &&
            tileSet.map((t, i) => (
              <View
                key={`dot-${t.key}`}
                style={{
                  position: 'absolute',
                  top: 5,
                  left: trackInset + fractions[i] * trackSpan - 5,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  borderWidth: 2,
                  borderColor: GAUGE_TIER_COLORS[t.key],
                  backgroundColor:
                    hasPrice && !outOfRange && p >= t.price ? GAUGE_TIER_COLORS[t.key] : '#fff',
                }}
              />
            ))}
          {/* The pin: a filled dot with a white ring, and the price badge beneath it.
              Display-only - no gesture handler anywhere on the scale.

              ⚠️ The badge is SHOWN here although the prototype's CSS carries
              `.sl-pin u { display: none }`. Its JS still writes the figure into the badge on
              every keystroke, and the client's screenshots show it visible, so the hide rule is
              treated as a leftover rather than as intent. Requested directly by the repo owner:
              *"price badge also showing in the mockup but not showing on my ui"*. */}
          {hasPrice && trackWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 1,
                left: Animated.subtract(Animated.add(pinAnim, trackInset), 9),
                width: 18,
                height: 18,
                borderRadius: 9,
                borderWidth: 3,
                borderColor: '#fff',
                backgroundColor: pinHue,
                shadowColor: '#0F172A',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.28,
                shadowRadius: 5,
                elevation: 3,
              }}
            />
          )}
          {/* Price badge. Tracks the pin, and is clamped to the row so it stays readable at either
              end instead of running off the edge.

              ⚠️ HIDDEN WHILE THE COMMISSION BANDS ARE OPEN, and shown otherwise - the prototype's
              `.dscl.rngon .sl-pin u { display: none }`. The two occupy the same strip directly
              under the track, so showing both stacks the badge on top of the band pills. The
              price is never lost by hiding it: it is in the field the rep is typing into, and the
              highlighted band already says which range it falls in.

              ⚠️ The rule is SCOPED TO `rngon`, not a blanket hide. An earlier read of an older
              copy of the mockup saw only an unconditional `.sl-pin u { display: none }` and took
              it for a leftover, so the badge was shown always. It is conditional. */}
          {trackWidth > 0 && shouldShowPriceBadge(p, bandsOpen) && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 22,
                left: Animated.subtract(Animated.add(pinAnim, trackInset), BADGE_W / 2).interpolate(
                  {
                    inputRange: [0, Math.max(1, trackWidth - BADGE_W)],
                    outputRange: [0, Math.max(1, trackWidth - BADGE_W)],
                    extrapolate: 'clamp',
                  },
                ),
                width: BADGE_W,
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                  borderRadius: 9,
                  backgroundColor: pinHue,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 12, fontWeight: '900', color: badgeTextColor(pinHue) }}
                >
                  {fmtMoney(p)}
                </Text>
              </View>
            </Animated.View>
          )}
        </View>
      )}

      {/* Commission-range pills. The ticket's reason for them: *"reps can make 2% commission and
          5% commission at these tiers respectively so if they're under par it'll be good to know
          those tiers as a rep"*. Open by default on a below-par price; the COST chevron hides them. */}
      {bandsOpen && bands.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          {bands.map((b, k) => (
            <View
              key={`lg-${b.lowPct}-${b.highPct}`}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                height: 26,
                borderRadius: 9,
                backgroundColor: bandIdx === k ? `${GAUGE_BAND_COLORS[k]}1F` : '#F8FAFC',
                borderWidth: 1,
                borderColor: bandIdx === k ? GAUGE_BAND_COLORS[k] : '#E2E8F0',
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: '900', color: GAUGE_BAND_COLORS[k] }}>
                {`${b.lowPct}–${b.highPct}%`}
              </Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#637280' }}>
                {`${fmtMoney(b.from)}–${fmtMoney(b.to)}`}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* The price field and its live per-month, side by side - the prototype's `dentry` + `dread`.
          The field keeps the flexible width so it still fits a 6-figure price on a narrow phone;
          the readout takes only what it needs and vanishes before a price is typed. */}
      {!!children && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
          {hasPrice && liveMonthly > 0 && (
            <View style={{ alignItems: 'flex-start', justifyContent: 'center' }}>
              <Text style={{ fontSize: 21, fontWeight: '900', color: '#16A34A', lineHeight: 23 }}>
                {fmtMoney(liveMonthly)}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#637280' }}>per month</Text>
            </View>
          )}
        </View>
      )}

      {/* Out-of-range note. The pin already went red; this says why, because a red pin alone
          reads as a styling glitch rather than as "that price is not allowed". */}
      {outOfRange && (
        <Text style={{ fontSize: 10, fontWeight: '800', color: '#DC2626', marginTop: 6 }}>
          {p > rollout
            ? `A drop cannot be above the rollout end price (${fmtMoney(rollout)}).`
            : `Below cost (${fmtMoney(tileSet[0].price)}).`}
        </Text>
      )}
      </Animated.View>
    </View>
  );
};

export default React.memo(DropPriceGauge);
