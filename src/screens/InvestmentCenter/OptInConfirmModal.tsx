import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../theme/ThemeProvider';
import {
  MODAL_BLUR_AMOUNT,
  MODAL_SCRIM,
  MODAL_CARD_SHADOW,
} from '../DynamicDealCenter/components/modal-chrome';

/**
 * "Secure This Price" confirmation (web parity: `opt-in-confirm-modal.js`), styled
 * to match the dynamic deal center's centered modals (`DropOutcomeModal`): a frosted
 * BlurView backdrop + scrim, a `rounded-40` white card with `shadow-2xl`, a green
 * check header, the price with CK/CC (or ACH/CC) method badges, and the
 * Decline / Secure-This-Price actions. Shown when the customer opts into the In-Home
 * Pre-Order program; confirming proceeds to the Result Lead (Sale) flow.
 */

const fmt = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;

interface Props {
  visible: boolean;
  price: number;
  monthly?: number;
  planLabel?: string;
  downPayment?: number;
  /** In-Home selected plan key — highlights the matching basic method badge. */
  method?: string;
  isLowesLead?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function OptInConfirmModal({ visible, price, monthly, planLabel, downPayment, method, isLowesLead = false, onConfirm, onClose }: Props) {
  const { isDark } = useTheme();
  const badges = isLowesLead
    ? [{ key: 'lowes_ach', label: 'ACH' }, { key: 'lowes_cc', label: 'CC' }]
    : [{ key: 'check', label: 'CK' }, { key: 'mcVisaDscvr', label: 'CC' }];
  const balance = Math.max(0, (price || 0) - (downPayment || 0));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }} onPress={onClose}>
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType={isDark ? 'dark' : 'light'}
          blurAmount={MODAL_BLUR_AMOUNT}
          reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
          pointerEvents="none"
        />
        <View style={MODAL_SCRIM} pointerEvents="none" />
        <Pressable style={{ backgroundColor: '#fff', borderRadius: 40, padding: 24, ...MODAL_CARD_SHADOW }}>
          {/* Header — green check + SECURE THIS PRICE + price + method badges */}
          <View style={{ alignItems: 'center', marginBottom: 22 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#F0FDF4', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Ionicons name="shield-checkmark" size={24} color="#31D076" />
            </View>
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#94A3B8', letterSpacing: 2, marginBottom: 8 }}>SECURE THIS PRICE</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 34, fontWeight: '900', color: '#1C252E' }}>{fmt(price)}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {badges.map((b) => {
                  const sel = method === b.key;
                  return (
                    <View key={b.key} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 2, borderColor: sel ? '#31D076' : '#E2E8F0', backgroundColor: sel ? '#31D076' : '#fff' }}>
                      <Text style={{ fontSize: 11, fontWeight: '900', color: sel ? '#fff' : '#94A3B8' }}>{b.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Down Payment + Balance (only when a down payment was set) */}
          {(downPayment ?? 0) > 0 && (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              <View style={{ flex: 1, backgroundColor: '#fff', borderWidth: 2, borderColor: '#0F172A', borderRadius: 16, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 }}>
                <Text style={{ position: 'absolute', top: -8, left: 12, backgroundColor: '#fff', paddingHorizontal: 4, fontSize: 10, fontWeight: '900', color: '#0F172A' }}>Down Payment</Text>
                <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A' }}>{fmt(downPayment!)}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: '#F8FAFC', borderWidth: 2, borderColor: '#F1F5F9', borderRadius: 16, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, opacity: 0.7 }}>
                <Text style={{ position: 'absolute', top: -8, left: 12, backgroundColor: '#F8FAFC', paddingHorizontal: 4, fontSize: 10, fontWeight: '900', color: '#94A3B8' }}>Balance</Text>
                <Text style={{ fontSize: 16, fontWeight: '900', color: '#94A3B8' }}>{fmt(balance)}</Text>
              </View>
            </View>
          )}

          {/* Selected plan + monthly */}
          {(monthly ?? 0) > 0 && (
            <View style={{ borderWidth: 2, borderColor: '#31D076', borderRadius: 16, padding: 16, marginBottom: 20, backgroundColor: '#F0FDF4', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text numberOfLines={2} style={{ fontSize: 12, fontWeight: '900', color: '#0F172A' }}>{planLabel || 'Selected Plan'}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#0F172A' }}>{fmt(monthly!)}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginLeft: 2 }}>/mo</Text>
              </View>
            </View>
          )}

          {/* Actions — Decline / Secure This Price */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: '#FF5630', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff' }}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onConfirm} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: '#31D076', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff' }}>Secure This Price</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
