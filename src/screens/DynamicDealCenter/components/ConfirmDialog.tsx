import React from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FS, FUND, PS } from './funding/funding-theme';

export type ConfirmTone = 'danger' | 'warn' | 'neutral';

const TONE: Record<ConfirmTone, { bg: string; fg: string; button: string; icon: string }> = {
  danger: { bg: FUND.RED_BG, fg: FUND.RED_TEXT, button: '#DC2626', icon: 'alert-circle-outline' },
  warn: { bg: FUND.AMBER_BG, fg: FUND.AMBER_TEXT, button: FUND.AMBER, icon: 'warning-outline' },
  neutral: { bg: FUND.FILL, fg: FUND.SUBTEXT, button: FUND.GREEN, icon: 'help-circle-outline' },
};

interface Props {
  visible: boolean;
  title: string;
  message: string;
  note?: string;
  hideCancel?: boolean;
  tone?: ConfirmTone;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  inline?: boolean;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  note,
  hideCancel,
  tone = 'danger',
  confirmLabel,
  cancelLabel = 'Go Back',
  busy,
  onConfirm,
  onCancel,
  inline,
}: Props) {
  const t = TONE[tone];
  const body = (
      <View style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }, inline && StyleSheet.absoluteFill]}>
        <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 340 }}>
          <View style={{ alignSelf: 'center', width: 42, height: 42, borderRadius: 21, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Ionicons name={t.icon} size={20} color={t.fg} />
          </View>

          <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, textAlign: 'center' }}>{title}</Text>
          <Text style={{ fontSize: FS.BODY, fontFamily: PS.semibold, color: FUND.SUBTEXT, textAlign: 'center', lineHeight: 18, marginTop: 8 }}>
            {message}
          </Text>

          {!!note && (
            <View style={{ backgroundColor: t.bg, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14 }}>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: t.fg, lineHeight: 16 }}>{note}</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
            {!hideCancel && (
            <TouchableOpacity
              onPress={onCancel}
              disabled={busy}
              style={{ flex: 1, minHeight: 44, borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#3A4048' }}>{cancelLabel}</Text>
            </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onConfirm}
              disabled={busy}
              style={{ flex: 1.2, minHeight: 44, backgroundColor: t.button, borderRadius: 11, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#fff' }}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
  );
  if (inline) return visible ? body : null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {body}
    </Modal>
  );
}

export default ConfirmDialog;
