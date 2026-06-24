import React, { useRef, useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  PanResponder,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Dimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { LeadService } from '../../../services/api/leads';
import { ENV } from '../../../config/env';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


// ─── Types ────────────────────────────────────────────────────────────────────

export interface AmendmentChange {
  key: string;
  label: string;
  oldValue: any;
  newValue: any;
}

interface ContractAmendmentModalProps {
  visible: boolean;
  onClose: () => void;
  onSendSuccess?: (args: { mode: 'sms' | 'email'; to: string }) => void;
  changes?: AmendmentChange[];
  onSubmitAmendment: (args: { signature: string }) => Promise<void>;
  submitting?: boolean;
  leadId: string;
  defaultPhone?: string;
  defaultEmail?: string;
  customerFirstName?: string;
  customerLastName?: string;
  draftId?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatValue(v: any): string {
  if (v == null || v === '') return '—';
  return String(v);
}



// ─── Component ────────────────────────────────────────────────────────────────

export const ContractAmendmentModal: React.FC<ContractAmendmentModalProps> = ({
  visible,
  onClose,
  onSendSuccess,
  changes = [],
  onSubmitAmendment,
  submitting = false,
  leadId,
  defaultPhone = '',
  defaultEmail = '',
  customerFirstName = '',
  customerLastName = '',
  draftId = null,
}) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // ── Signature state — same pattern as ConsentFormModal ────────────────────
  const [showSigPad, setShowSigPad] = useState(false);
  const [savedPaths, setSavedPaths] = useState<string[]>([]);
  const [livePaths, setLivePaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const currentPathRef = useRef('');
  const [padLayout, setPadLayout] = useState({ width: Dimensions.get('window').width - 64, height: 260 });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const path = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          currentPathRef.current = path;
          setCurrentPath(path);
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const next = `${currentPathRef.current} L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          currentPathRef.current = next;
          setCurrentPath(next);
        },
        onPanResponderRelease: () => {
          const finished = currentPathRef.current;
          if (finished) setLivePaths((prev) => [...prev, finished]);
          currentPathRef.current = '';
          setCurrentPath('');
        },
        onPanResponderTerminationRequest: () => false,
      }),
    []
  );

  const openSigPad = () => {
    setLivePaths([...savedPaths]);
    setCurrentPath('');
    setShowSigPad(true);
  };
  const closeSigPad = () => setShowSigPad(false);
  const saveSig = () => {
    setSavedPaths([...livePaths]);
    setShowSigPad(false);
  };
  const clearSig = () => {
    setLivePaths([]);
    setCurrentPath('');
  };

  // ── Send sub-view state ────────────────────────────────────────────────────
  type SendMode = 'sms' | 'email';
  const [sendView, setSendView] = useState<SendMode | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sendSubject, setSendSubject] = useState('Contract Amendment Signature Required');
  const [sending, setSending] = useState(false);

  // Reset on open
  React.useEffect(() => {
    if (visible) {
      setSavedPaths([]);
      setLivePaths([]);
      setCurrentPath('');
      currentPathRef.current = '';
      setShowSigPad(false);
      setSendView(null);
    }
  }, [visible]);

  // ── Public link ───────────────────────────────────────────────────────────
  const publicLink = useMemo(() => {
    if (!leadId) return '';
    let base: string = ENV.API_URL || '';

    // Clean up trailing slash
    if (base.endsWith('/')) {
      base = base.slice(0, -1);
    }

    // Map backend server URL to its corresponding web app frontend client URL
    if (base.includes('dev-api.revdsm.com')) {
      base = 'https://dev-sales.revdsm.com';
    } else if (base.includes('staging-api.revdsm.com')) {
      base = 'https://staging-app.revdsm.com';
    } else if (base.includes('api.revdsm.com')) {
      base = 'https://sales.revdsm.com';
    } else {
      // General regex fallback: replace -api with -app or remove api prefix
      base = base.replace('-api', '-app').replace('api.', 'app.').replace('/api', '');
    }

    return `${base}/lead-drafts/${encodeURIComponent(leadId)}`;
  }, [leadId]);

  const smsBody = useMemo(
    () => `Contract amendment requires your signature.\n\n${publicLink}`,
    [publicLink]
  );
  const emailBody = useMemo(
    () =>
      JSON.stringify({
        url: publicLink,
        docTitle: 'Contract Amendment Required',
        firstName: customerFirstName.trim(),
        lastName: customerLastName.trim(),
      }),
    [publicLink, customerFirstName, customerLastName]
  );

  // ── Helpers ───────────────────────────────────────────────────────────────
  /** Formats only the local 10-digit part as (XXX) XXX-XXXX, no +1 prefix. */
  const formatLocalPhone = (text: string): string => {
    const digits = text.replace(/\D/g, '').slice(-10).substring(0, 10);
    if (!digits) return '';
    if (digits.length <= 3) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.substring(0, 3)}) ${digits.substring(3)}`;
    return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleOpenSend = (mode: SendMode) => {
    setSendView(mode);
    if (mode === 'sms') {
      // Strip country code and format only the local part
      const digits = defaultPhone.replace(/\D/g, '').replace(/^1/, '').slice(-10);
      setSendTo(formatLocalPhone(digits));
    } else {
      setSendTo(defaultEmail);
    }
    setSendSubject('Contract Amendment Signature Required');
  };

  const handleSend = async () => {
    let to = sendTo.trim();
    if (!to) {
      Alert.alert('Missing', 'Please enter a recipient.');
      return;
    }

    // Clean and format phone number for Twilio (enforce US format: +1 followed by 10 digits)
    if (sendView === 'sms') {
      const digits = to.replace(/\D/g, '');
      if (digits.length >= 10) {
        const last10 = digits.slice(-10);
        to = `+1${last10}`;
      } else {
        to = `+1${digits}`;
      }
    }

    setSending(true);
    try {
      if (sendView === 'sms') {
        await LeadService.sendSms({ body: smsBody, to, leadId });
      } else {
        await LeadService.sendEmail({
          body: emailBody,
          is_html: true,
          subject: sendSubject.trim() || 'Contract Amendment Signature Required',
          to,
          leadId,
        });
      }

      Alert.alert(
        'Sent',
        sendView === 'sms' ? 'Text message sent successfully.' : 'Email sent successfully.'
      );
      setSendView(null);
      onSendSuccess?.({ mode: sendView!, to });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async () => {
    if (savedPaths.length === 0) {
      Alert.alert('Signature Required', 'Please draw the customer signature first.');
      return;
    }
    const svgPaths = savedPaths.join(' ');
    await onSubmitAmendment({ signature: svgPaths });
  };

  const canSubmit = !submitting && savedPaths.length > 0;

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderChangeRow = (c: AmendmentChange) => (
    <View key={c.key} style={{ marginBottom: 8 }}>
      <Text style={styles.changeLabel}>{c.label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={styles.changeOld}>{formatValue(c.oldValue)}</Text>
        <Icon name="arrow-right" size={14} color="#4CBB17" />
        <Text style={styles.changeNew}>{formatValue(c.newValue)}</Text>
      </View>
    </View>
  );

  // ── Send sub-modal ─────────────────────────────────────────────────────────
  if (visible && sendView) {
    const cleanDigits = sendTo.replace(/\D/g, '');
    const canSend = sendView === 'sms' ? cleanDigits.length === 10 : sendTo.trim().length > 0;

    return (
      <Modal visible animationType="slide" transparent onRequestClose={() => setSendView(null)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <View style={styles.overlay}>
            <View style={[styles.sheetCard, { backgroundColor: isDark ? colors.card : '#FFFFFF' }]}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: 24, paddingBottom: Math.max(insets.bottom, 24) }}
              >
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetTitle, { color: isDark ? '#FFF' : '#1C252E' }]}>
                    {sendView === 'sms' ? 'Send via Text' : 'Send via Email'}
                  </Text>
                  <TouchableOpacity onPress={() => setSendView(null)}>
                    <Icon name="close" size={24} color="#637381" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.sheetSub}>
                  Customer will receive a link to sign the amendment
                </Text>

                {/* Recipient input */}
                <Text style={styles.fieldLabel}>
                  {sendView === 'sms' ? 'Customer Phone Number' : 'Email Address'}
                </Text>
                <View style={[styles.inputRow, { borderColor: isDark ? '#FFFFFF20' : '#919EAB33', backgroundColor: isDark ? '#FFFFFF05' : '#F9FAFB' }]}>
                  <Icon
                    name={sendView === 'sms' ? 'phone' : 'email-outline'}
                    size={16}
                    color="#637381"
                    style={{ marginRight: 8 }}
                  />
                  {sendView === 'sms' && (
                    <Text
                      style={[
                        styles.inputText,
                        {
                          color: isDark ? '#FFFFFF80' : '#637381',
                          flex: 0,
                          fontWeight: '700',
                          marginRight: 4,
                          includeFontPadding: false,
                        },
                      ]}
                    >
                      +1
                    </Text>
                  )}
                  <TextInput
                    value={sendTo}
                    onChangeText={(text) => {
                      if (sendView === 'sms') {
                        setSendTo(formatLocalPhone(text));
                      } else {
                        setSendTo(text);
                      }
                    }}
                    placeholder={sendView === 'sms' ? '(555) 123-4567' : 'customer@email.com'}
                    placeholderTextColor="#919EAB"
                    keyboardType={sendView === 'sms' ? 'phone-pad' : 'email-address'}
                    autoCapitalize="none"
                    style={[styles.inputText, { color: isDark ? '#FFF' : '#1C252E' }]}
                    editable={!sending}
                  />
                </View>

                {sendView === 'email' && (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Subject</Text>
                    <View style={[styles.inputRow, { borderColor: isDark ? '#FFFFFF20' : '#919EAB33', backgroundColor: isDark ? '#FFFFFF05' : '#F9FAFB' }]}>
                      <TextInput
                        value={sendSubject}
                        onChangeText={setSendSubject}
                        style={[styles.inputText, { color: isDark ? '#FFF' : '#1C252E' }]}
                        editable={!sending}
                      />
                    </View>
                  </>
                )}

                {/* Message preview */}
                <View style={[styles.previewBox, { backgroundColor: isDark ? '#FFFFFF08' : '#F4F6F8' }]}>
                  <Text style={styles.previewLabel}>Message (read-only)</Text>
                  <Text style={[styles.previewText, { color: isDark ? '#FFFFFF80' : '#637381' }]}>
                    {sendView === 'sms' ? smsBody : publicLink}
                  </Text>
                </View>

                <View style={styles.sendBtns}>
                  <TouchableOpacity
                    onPress={() => setSendView(null)}
                    disabled={sending}
                    style={[styles.cancelBtn, { flex: 1, borderColor: isDark ? '#FFFFFF20' : '#E2E8F0' }]}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSend}
                    disabled={sending || !canSend}
                    style={[
                      styles.sendBtn,
                      { backgroundColor: !sending && canSend ? '#4CBB17' : '#919EAB33' },
                    ]}
                  >
                    {sending ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text style={styles.sendBtnText}>
                        {sendView === 'sms' ? 'Send Text' : 'Send Email'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  // ── Main modal ─────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheetCard, { backgroundColor: isDark ? colors.card : '#FFFFFF' }]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!showSigPad}
            contentContainerStyle={{ padding: 24, paddingBottom: Math.max(insets.bottom, 24) }}
          >
            {/* Title */}
            <View style={styles.titleRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.sheetTitle, { color: isDark ? '#FFF' : '#1C252E' }]}>
                  Contract Amendment Required
                </Text>
                <Text style={styles.sheetSub}>Customer signature needed</Text>
              </View>
              <TouchableOpacity onPress={onClose} disabled={submitting}>
                <Icon name="close" size={24} color="#637381" />
              </TouchableOpacity>
            </View>

            {/* Warning banner */}
            <View style={[styles.warningBanner, { backgroundColor: isDark ? '#F59E0B15' : '#FFF8E6', borderColor: isDark ? '#F59E0B40' : '#F59E0B60' }]}>
              <Icon name="alert" size={18} color="#D97706" style={{ marginTop: 1 }} />
              <Text style={[styles.warningText, { color: isDark ? '#F59E0B' : '#92400E' }]}>
                Changes to contract terms require customer acknowledgment and signature
              </Text>
            </View>

            {/* Changes list */}
            {changes.length > 0 && (
              <View style={[styles.changesCard, { backgroundColor: isDark ? '#FFFFFF08' : '#F4F6F8' }]}>
                <View style={styles.changesHeader}>
                  <Text style={[styles.changesTitle, { color: isDark ? '#FFF' : '#1C252E' }]}>
                    Changes
                  </Text>
                </View>
                <View style={[styles.changesDivider, { backgroundColor: isDark ? '#FFFFFF10' : '#E2E8F0' }]} />
                <View style={{ padding: 16 }}>{changes.map(renderChangeRow)}</View>
              </View>
            )}

            {/* ── Signature section — same pattern as ConsentFormModal ── */}
            <View style={{ marginBottom: 16 }}>
              <Text style={[styles.sigSectionTitle, { color: isDark ? '#FFF' : '#1C252E' }]}>
                Customer Signature
              </Text>

              {/* Tap-to-open thumbnail (same as ConsentFormModal) */}
              <TouchableOpacity
                onPress={openSigPad}
                activeOpacity={0.8}
                style={[
                  styles.sigThumbnail,
                  { borderColor: savedPaths.length > 0 ? '#4CBB17' : '#919EAB52' },
                ]}
              >
                {savedPaths.length === 0 ? (
                  <View style={{ alignItems: 'center' }}>
                    <Icon
                      name="fountain-pen-tip"
                      size={32}
                      color="#919EAB"
                      style={{ opacity: 0.3 }}
                    />
                    <Text style={styles.sigPlaceholderText}>Tap to Draw Signature</Text>
                  </View>
                ) : (
                  <View style={{ flex: 1, width: '100%', backgroundColor: '#F8FAFC' }}>
                    <Svg width="100%" height="100%" viewBox={`0 0 ${padLayout.width} ${padLayout.height}`} preserveAspectRatio="xMidYMid meet">
                      {savedPaths.map((p, i) => (
                        <Path
                          key={i}
                          d={p}
                          stroke="#1C252E"
                          strokeWidth={3}
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}
                    </Svg>
                  </View>
                )}
              </TouchableOpacity>

              {savedPaths.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 10 }}>
                  <View style={styles.sigBadge}>
                    <Icon name="check" size={12} color="white" style={{ marginRight: 4 }} />
                    <Text style={styles.sigBadgeText}>Signature saved</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setSavedPaths([]); }}
                    style={styles.sigClearLink}
                  >
                    <Icon name="eraser" size={13} color="#FF5630" style={{ marginRight: 3 }} />
                    <Text style={styles.sigClearLinkText}>Clear</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={styles.sigHint}>Tap the box above to draw signature</Text>
            </View>

            {/* OR divider */}
            <View style={styles.orRow}>
              <View style={[styles.orLine, { backgroundColor: isDark ? '#FFFFFF15' : '#E2E8F0' }]} />
              <Text style={styles.orText}>OR</Text>
              <View style={[styles.orLine, { backgroundColor: isDark ? '#FFFFFF15' : '#E2E8F0' }]} />
            </View>

            {/* Send via Text / Email */}
            <View style={styles.sendRow}>
              <TouchableOpacity
                onPress={() => handleOpenSend('sms')}
                disabled={!leadId}
                style={[styles.sendChip, { opacity: !leadId ? 0.4 : 1 }]}
              >
                <Icon name="message-text-outline" size={16} color="#4CBB17" />
                <Text style={styles.sendChipText}>Send via Text</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleOpenSend('email')}
                disabled={!leadId}
                style={[styles.sendChip, { opacity: !leadId ? 0.4 : 1 }]}
              >
                <Icon name="email-send-outline" size={16} color="#4CBB17" />
                <Text style={styles.sendChipText}>Send via Email</Text>
              </TouchableOpacity>
            </View>

            {/* Footer buttons */}
            <View style={{ gap: 10 }}>
              <TouchableOpacity
                onPress={onClose}
                disabled={submitting}
                style={[styles.cancelBtn, { borderColor: isDark ? '#FFFFFF20' : '#E2E8F0', opacity: submitting ? 0.5 : 1 }]}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={[
                  styles.submitBtn,
                  {
                    backgroundColor: canSubmit ? '#4CBB17' : '#919EAB33',
                    shadowColor: canSubmit ? '#4CBB17' : 'transparent',
                  },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={[styles.submitBtnText, { color: canSubmit ? 'white' : '#919EABCC' }]}>
                    Submit Amendment
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* ── Inline signature pad overlay — same as ConsentFormModal ── */}
          {showSigPad && (
            <View style={styles.sigOverlay}>
              <View style={styles.sigCard}>
                {/* Header */}
                <View style={[styles.sigHeader, { backgroundColor: colors.primary.main }]}>
                  <View>
                    <Text style={styles.sigHeaderTitle}>Draw Your Signature</Text>
                    <Text style={styles.sigHeaderSub}>
                      Use your finger or stylus to sign below.
                    </Text>
                  </View>
                  <TouchableOpacity onPress={closeSigPad}>
                    <Icon name="close" size={20} color="white" />
                  </TouchableOpacity>
                </View>

                {/* Drawing canvas */}
                <View style={styles.sigPadWrap}>
                  <View
                    style={styles.sigPad}
                    {...panResponder.panHandlers}
                    onStartShouldSetResponder={() => true}
                    onLayout={(e) => setPadLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
                  >
                    <Svg width="100%" height="100%" pointerEvents="none">
                      {livePaths.map((p, i) => (
                        <Path
                          key={i}
                          d={p}
                          stroke="#1C252E"
                          strokeWidth={3}
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}
                      {currentPath !== '' && (
                        <Path
                          d={currentPath}
                          stroke="#1C252E"
                          strokeWidth={3}
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}
                    </Svg>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.sigActions}>
                  <TouchableOpacity onPress={clearSig} style={styles.clearBtn}>
                    <Icon name="eraser" size={16} color="#FF5630" style={{ marginRight: 6 }} />
                    <Text style={styles.clearBtnText}>Clear</Text>
                  </TouchableOpacity>
                  <View style={styles.sigRightBtns}>
                    <TouchableOpacity onPress={closeSigPad} style={styles.sigCancelBtn}>
                      <Text style={styles.sigCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={saveSig}
                      style={[
                        styles.sigSaveBtn,
                        {
                          backgroundColor:
                            livePaths.length > 0 ? colors.primary.main : '#919EAB33',
                        },
                      ]}
                    >
                      <Icon
                        name="check"
                        size={16}
                        color={livePaths.length > 0 ? 'white' : '#919EABCC'}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.sigSaveText,
                          { color: livePaths.length > 0 ? 'white' : '#919EABCC' },
                        ]}
                      >
                        Save Signature
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '95%',
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  sheetTitle: { fontSize: 18, fontWeight: '900' },
  sheetSub: { fontSize: 13, color: '#637381', marginBottom: 16 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },

  // Warning
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    marginBottom: 16,
  },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18 },

  // Changes card
  changesCard: { borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  changesHeader: { paddingHorizontal: 16, paddingVertical: 12 },
  changesTitle: { fontWeight: '700', fontSize: 13 },
  changesDivider: { height: 1 },
  changeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#637381',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  changeOld: {
    fontSize: 13,
    color: '#919EAB',
    textDecorationLine: 'line-through',
  },
  changeNew: { fontSize: 13, fontWeight: '800', color: '#4CBB17' },

  // Signature section
  sigSectionTitle: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  sigThumbnail: {
    width: '100%',
    height: 176,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sigPlaceholderText: {
    color: '#4D4D4D',
    fontSize: 13,
    marginTop: 8,
  },
  sigBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#22C55E',
    borderRadius: 99,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  sigBadgeText: { color: 'white', fontSize: 11, fontWeight: '700' },
  sigClearLink: { flexDirection: 'row', alignItems: 'center' },
  sigClearLinkText: { color: '#FF5630', fontWeight: '700', fontSize: 12 },
  sigHint: { fontSize: 11, color: '#919EAB', marginTop: 6 },

  // OR
  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  orLine: { flex: 1, height: 1 },
  orText: {
    marginHorizontal: 12,
    fontSize: 11,
    fontWeight: '700',
    color: '#919EAB',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Send chips
  sendRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  sendChip: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#4CBB17',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sendChipText: { fontWeight: '800', color: '#4CBB17', fontSize: 13 },

  // Footer
  cancelBtn: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontWeight: '700', color: '#637381', fontSize: 14 },
  submitBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  submitBtnText: { fontWeight: '900', fontSize: 15, letterSpacing: 0.3 },

  // Send sub-view inputs
  fieldLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#637381',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
  },
  inputText: { flex: 1, fontSize: 14, fontWeight: '600' },
  previewBox: { borderRadius: 12, padding: 14, marginTop: 12, marginBottom: 20 },
  previewLabel: { fontSize: 11, color: '#637381', fontWeight: '700', marginBottom: 4 },
  previewText: { fontSize: 12, lineHeight: 18 },
  sendBtns: { flexDirection: 'row', gap: 12 },
  sendBtn: {
    flex: 1.5,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { fontWeight: '900', color: 'white', fontSize: 14 },

  // ── Inline signature pad overlay (identical to ConsentFormModal) ──
  sigOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
    zIndex: 999,
  },
  sigCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 20,
  },
  sigHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    marginBottom: 12,
  },
  sigHeaderTitle: { color: 'white', fontSize: 14, fontWeight: '600' },
  sigHeaderSub: { color: 'white', fontSize: 11, marginTop: 2, opacity: 0.85 },
  sigPadWrap: { paddingHorizontal: 16, marginBottom: 16 },
  sigPad: {
    width: '100%',
    height: 260,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E3E7',
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  sigActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF5630',
  },
  clearBtnText: { color: '#FF5630', fontWeight: '700', fontSize: 13 },
  sigRightBtns: { flexDirection: 'row', gap: 10 },
  sigCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#919EAB52',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sigCancelText: { color: '#637381', fontWeight: '600', fontSize: 13 },
  sigSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  sigSaveText: { fontWeight: '700', fontSize: 13 },
});
