import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { FS, FUND, PS } from './funding-theme';
import {
  FLOW,
  connectorTones,
  ownerOf,
  stateOf,
  type ConnectorTone,
  type FundingPayment,
  type StepState,
} from '../../utils/funding';

/**
 * The progress rail on a funding card — one dot per step of the payment's life
 * cycle, connected by a rule that fills in green behind the rep.
 *
 * The state that matters most here is **locked**: a step somebody else posts
 * (the bank, the processor, the install crew). It draws as a dashed, empty dot
 * captioned with its owner so it reads as "not yours", never as an unfinished
 * task — a rep who thinks they still owe a deposit will sit on a job that is
 * already done.
 */

const DOT = 26;
const RING = 34;
/** Vertical centre of the dot, so the connectors meet it. */
const LINE_TOP = RING / 2 - 1;

function dotColors(state: StepState): { bg: string; border: string; fg: string } {
  switch (state) {
    case 'done':
      return { bg: FUND.GREEN, border: FUND.GREEN, fg: '#fff' };
    case 'now':
      return { bg: '#fff', border: FUND.GREEN, fg: FUND.GREEN };
    case 'warn':
      return { bg: FUND.AMBER, border: FUND.AMBER, fg: '#fff' };
    case 'bad':
      return { bg: FUND.RED, border: FUND.RED, fg: '#fff' };
    case 'locked':
      return { bg: 'transparent', border: FUND.LOCKED_LINE, fg: 'transparent' };
    default:
      return { bg: '#fff', border: FUND.BORDER, fg: FUND.MUTED };
  }
}

function labelColor(state: StepState): string {
  if (state === 'done' || state === 'now') return FUND.TEXT;
  if (state === 'warn') return FUND.AMBER;
  if (state === 'bad') return FUND.RED;
  if (state === 'locked') return FUND.FAINT;
  return FUND.MUTED;
}

function markFor(state: StepState, index: number): string {
  if (state === 'done') return '✓';
  if (state === 'bad') return '✕';
  if (state === 'warn') return '!';
  if (state === 'locked') return '';
  return String(index + 1);
}

/**
 * A connector half.
 *
 * ⚠️ The dashed variant is drawn with `react-native-svg`, NOT `borderStyle:
 * 'dashed'` — Android silently renders a dashed border as SOLID on a view that has
 * a border radius or a single-sided width, which would erase the one cue that says
 * "nobody here has to do this".
 */
function Connector({ side, tone }: { side: 'left' | 'right'; tone: ConnectorTone }) {
  const base = {
    position: 'absolute' as const,
    top: LINE_TOP,
    width: '50%' as const,
    height: 2.5,
    ...(side === 'left' ? { left: 0 } : { right: 0 }),
  };
  if (tone === 'dashed') {
    return (
      <View style={base}>
        <Svg width="100%" height={2.5}>
          <Line x1="0" y1="1.25" x2="100%" y2="1.25" stroke={FUND.LOCKED_LINE} strokeWidth={2} strokeDasharray="4,4" />
        </Svg>
      </View>
    );
  }
  return <View style={{ ...base, backgroundColor: tone === 'green' ? FUND.GREEN : FUND.BORDER }} />;
}

/** The empty dashed ring of a step nobody on this screen performs. Same Android
 *  caveat as `Connector` — a `borderStyle: 'dashed'` circle draws solid there. */
function DashedDot() {
  const r = (DOT - 2.5) / 2;
  return (
    <Svg width={DOT} height={DOT}>
      <Circle cx={DOT / 2} cy={DOT / 2} r={r} stroke={FUND.LOCKED_LINE} strokeWidth={2.5} strokeDasharray="4,3" fill="none" />
    </Svg>
  );
}

export function FundingStepper({ payment, covered }: { payment: FundingPayment; covered: boolean }) {
  const steps = FLOW[payment.type] || [];
  const st = stateOf(payment, covered);
  const owner = ownerOf(payment);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {steps.map((label, i) => {
        const state = st[i] || 'next';
        const colors = dotColors(state);
        const tones = connectorTones(state);

        // Step 2 of a bank flow shows what was actually approved, which is the one
        // number the rep is asked about at the table.
        const approvedSub = i === 1 && payment.type === 'bank' && payment.approvedAmt != null;
        const displayLabel = i === 1 && payment.type === 'bank' && payment.decision === 'declined' ? 'Declined' : label;

        return (
          <View key={`${label}-${i}`} style={{ flex: 1, alignItems: 'center' }}>
            {i > 0 && <Connector side="left" tone={tones.left} />}
            {i < steps.length - 1 && <Connector side="right" tone={tones.right} />}

            <View
              style={{
                width: RING,
                height: RING,
                borderRadius: RING / 2,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 5,
                // The "you are here" halo. Only the active step gets it.
                backgroundColor: state === 'now' ? 'rgba(76,187,23,0.18)' : 'transparent',
              }}
            >
              {state === 'locked' ? (
                <DashedDot />
              ) : (
                <View
                  style={{
                    width: DOT,
                    height: DOT,
                    borderRadius: DOT / 2,
                    borderWidth: 2.5,
                    borderColor: colors.border,
                    backgroundColor: colors.bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: FS.TINY, fontFamily: PS.extrabold, color: colors.fg }}>{markFor(state, i)}</Text>
                </View>
              )}
            </View>

            <Text
              style={{ fontSize: FS.TINY, fontFamily: PS.bold, lineHeight: 13, textAlign: 'center', color: labelColor(state) }}
              numberOfLines={2}
            >
              {displayLabel}
            </Text>
            {approvedSub && (
              <Text style={{ fontSize: FS.MICRO, fontFamily: PS.bold, color: labelColor(state), marginTop: 2 }}>
                ${(payment.approvedAmt || 0).toLocaleString()}
              </Text>
            )}
            {state === 'locked' && (
              <Text style={{ fontSize: FS.MICRO, fontFamily: PS.extrabold, letterSpacing: 0.5, textTransform: 'uppercase', color: FUND.FAINT, marginTop: 3, textAlign: 'center' }}>
                {owner}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}