import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { FS, FUND, PS } from './funding-theme';
import { connectorTones, type ConnectorTone, type StepState } from '../../utils/funding';

export interface RailStep {
  label: string;
  state: StepState;
  sub?: string;
  caption?: string;
}

const DOT = 26;
const RING = 34;
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

function DashedDot() {
  const r = (DOT - 2.5) / 2;
  return (
    <Svg width={DOT} height={DOT}>
      <Circle cx={DOT / 2} cy={DOT / 2} r={r} stroke={FUND.LOCKED_LINE} strokeWidth={2.5} strokeDasharray="4,3" fill="none" />
    </Svg>
  );
}

export function StepRail({ steps }: { steps: RailStep[] }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {steps.map((step, i) => {
        const state = step.state || 'next';
        const colors = dotColors(state);
        const tones = connectorTones(state);

        return (
          <View key={`${step.label}-${i}`} style={{ flex: 1, alignItems: 'center' }}>
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
              {step.label}
            </Text>
            {!!step.sub && (
              <Text style={{ fontSize: FS.MICRO, fontFamily: PS.bold, color: labelColor(state), marginTop: 2 }}>{step.sub}</Text>
            )}
            {!!step.caption && (
              <Text style={{ fontSize: FS.MICRO, fontFamily: PS.extrabold, letterSpacing: 0.5, textTransform: 'uppercase', color: FUND.FAINT, marginTop: 3, textAlign: 'center' }}>
                {step.caption}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
