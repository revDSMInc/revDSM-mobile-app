import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { FS, FUND, PS } from './funding-theme';
import { scopeSwitchOptions } from '../../utils/funding';

export type ScopePrompt =
  | { kind: 'decision'; settledAmount: number; overage?: number }
  | { kind: 'approval'; message: string }
  | { kind: 'refundFirst'; message: string; settledAmount?: number };

interface Props {
  prompt: ScopePrompt;
  busy: boolean;
  onReuse: () => void;
  onRefund: () => void;
  onConfirmRefund: () => void;
  onClose: () => void;
}

// In-card overlay, never a nested Modal: the Result sheet is itself a native Modal and a second one
// is silently dropped on iOS. Rendered as an absolute child of the sheet card.
export function ScopeSwitchPrompt({ prompt, busy, onReuse, onRefund, onConfirmRefund, onClose }: Props) {
  const opts = prompt.kind === 'decision' ? scopeSwitchOptions(prompt.settledAmount, prompt.overage) : null;

  const option = (label: string, note: string, onPress: () => void, tone: 'ok' | 'warn') => (
    <TouchableOpacity
      key={label}
      activeOpacity={0.85}
      disabled={busy}
      onPress={onPress}
      style={{ borderWidth: 1.5, borderRadius: 14, padding: 14, marginTop: 10, opacity: busy ? 0.6 : 1, borderColor: tone === 'ok' ? FUND.GREEN : FUND.AMBER, backgroundColor: tone === 'ok' ? '#F0FBEC' : FUND.AMBER_BG }}
    >
      <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: FUND.TEXT, lineHeight: 20 }}>{label}</Text>
      {!!note && <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.AMBER_TEXT, lineHeight: 17, marginTop: 6 }}>{note}</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,20,24,0.45)', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 18 }}>
        {prompt.kind === 'decision' && opts && (
          <>
            <Text style={{ fontSize: FS.LEAD, fontFamily: PS.extrabold, color: FUND.TEXT }}>Money is already collected on this job</Text>
            <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, lineHeight: 17, marginTop: 6 }}>
              Choose what happens to it before this calculator takes over.
            </Text>
            {option(opts.reuse, opts.reuseNote, onReuse, 'ok')}
            {option(opts.refund, '', onRefund, 'warn')}
          </>
        )}
        {prompt.kind === 'approval' && (
          <>
            <Text style={{ fontSize: FS.LEAD, fontFamily: PS.extrabold, color: FUND.TEXT }}>Refund approval needed</Text>
            <Text style={{ fontSize: FS.BODY, fontFamily: PS.semibold, color: FUND.SUBTEXT, lineHeight: 20, marginTop: 8 }}>{prompt.message}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <TouchableOpacity activeOpacity={0.85} disabled={busy} onPress={onClose} style={{ flex: 1, borderWidth: 1.5, borderColor: FUND.BORDER, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: FUND.SUBTEXT }}>No</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.85} disabled={busy} onPress={onConfirmRefund} style={{ flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: FUND.GREEN }}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#fff' }}>Yes, proceed</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
        {prompt.kind === 'refundFirst' && (
          <>
            <Text style={{ fontSize: FS.LEAD, fontFamily: PS.extrabold, color: FUND.TEXT }}>Refund first</Text>
            <Text style={{ fontSize: FS.BODY, fontFamily: PS.semibold, color: FUND.SUBTEXT, lineHeight: 20, marginTop: 8 }}>{prompt.message}</Text>
            <TouchableOpacity activeOpacity={0.85} onPress={onClose} style={{ marginTop: 14, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: FUND.GREEN }}>
              <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#fff' }}>OK</Text>
            </TouchableOpacity>
          </>
        )}
        {prompt.kind === 'decision' && (
          <TouchableOpacity activeOpacity={0.7} disabled={busy} onPress={onClose} style={{ marginTop: 14, alignItems: 'center', paddingVertical: 6 }}>
            <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.MUTED }}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
