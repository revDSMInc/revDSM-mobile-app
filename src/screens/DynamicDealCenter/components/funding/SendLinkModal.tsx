import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Linking, Platform } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import { FUND } from './funding-theme';
import { FlashMessage } from '../../../../config/message';
import { formatLocalUSPhone, toE164USPhone } from '../../../../utils/phone-util';
import type { FundingPayment } from '../../utils/funding';

/**
 * "Send application/payment link" — the sheet that gets the homeowner onto their
 * own phone to finish a card or a loan application.
 *
 * Three ways out, in the order a rep actually uses them at a kitchen table:
 * **scan the QR** (the homeowner is sitting right there), **text it**, **email it**.
 *
 * ⚠️ Text and Email hand off to the DEVICE composer via `Linking` rather than
 * posting to a backend — there is no messaging endpoint, and a "Send text" button
 * that quietly does nothing is worse than no button. The rep sees the real SMS /
 * mail app, so the message genuinely goes out.
 *
 * Rendered as an in-sheet overlay, not a nested `<Modal>`: this already lives
 * inside the Result Lead modal, and stacked native modals are unreliable on both
 * platforms.
 */

/**
 * `react-native-qrcode-svg` is pure JS over `react-native-svg`, but it is a fresh
 * dependency — a missed `yarn install` would otherwise white-screen the whole
 * Result Lead sheet on a step the rep can't skip. Degrade to text/email instead.
 */
let QRCode: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  QRCode = require('react-native-qrcode-svg').default;
} catch {
  QRCode = null;
}

type Stage = 'choose' | 'text' | 'email' | 'done';

interface Props {
  payment: FundingPayment | null;
  /** The URL the homeowner opens. See `buildApplicationLink`. */
  link: string;
  onClose: () => void;
  /** Fired once the rep confirms the link is out — records who it went to. */
  onSent: (sentTo: string) => void;
}

function ModalButton({ label, onPress, alt, disabled }: { label: string; onPress: () => void; alt?: boolean; disabled?: boolean }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        borderRadius: 11,
        paddingVertical: 13,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
        backgroundColor: alt ? '#fff' : FUND.GREEN,
        borderWidth: alt ? 1.6 : 0,
        borderColor: FUND.BORDER,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '700', color: alt ? '#3A4048' : '#fff' }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function SendLinkModal({ payment, link, onClose, onSent }: Props) {
  const [stage, setStage] = useState<Stage>('choose');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');

  const isBank = payment?.type === 'bank';
  const title = isBank ? 'Send application link' : 'Send payment link';
  const message = useMemo(
    () =>
      isBank
        ? `Here is your financing application: ${link}`
        : `Here is your secure payment link: ${link}`,
    [isBank, link]
  );

  if (!payment) return null;

  const reset = () => {
    setStage('choose');
    setPhone('');
    setEmail('');
    setSentTo('');
  };

  const close = () => {
    reset();
    onClose();
  };

  /** Hand off to the device composer; only mark it sent if the app actually opened. */
  const openComposer = async (url: string, who: string) => {
    try {
      await Linking.openURL(url);
      setSentTo(who);
      setStage('done');
    } catch {
      FlashMessage.error('Could not open', 'No app on this device can send that. Try the QR code instead.');
    }
  };

  const sendText = () => {
    const e164 = toE164USPhone(phone);
    if (e164.length !== 12) {
      FlashMessage.warning('Phone number', 'Enter the homeowner’s 10-digit mobile number.');
      return;
    }
    // iOS wants `&body=`, Android wants `?body=` — the separator is not portable.
    const sep = Platform.OS === 'ios' ? '&' : '?';
    openComposer(`sms:${e164}${sep}body=${encodeURIComponent(message)}`, `Texted to ${formatLocalUSPhone(phone)}`);
  };

  const sendEmail = () => {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      FlashMessage.warning('Email address', 'Enter a valid email address for the homeowner.');
      return;
    }
    const subject = encodeURIComponent(isBank ? 'Your financing application' : 'Your payment link');
    openComposer(`mailto:${to}?subject=${subject}&body=${encodeURIComponent(message)}`, `Emailed to ${to}`);
  };

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,20,24,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 22, maxHeight: '92%' }}>
        <ScrollView contentContainerStyle={{ padding: 22, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
          {stage === 'choose' && (
            <>
              <Text style={{ fontSize: 19, fontWeight: '700', color: FUND.TEXT, marginBottom: 4, textAlign: 'center' }}>{title}</Text>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: FUND.MUTED, marginBottom: 16, textAlign: 'center' }}>
                ${payment.amount.toLocaleString()} · {payment.methodLabel}
              </Text>

              {QRCode ? (
                <>
                  <View style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: FUND.BORDER, backgroundColor: '#fff' }}>
                    <QRCode value={link} size={170} backgroundColor="#fff" color={FUND.TEXT} />
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: FUND.SUBTEXT, marginTop: 10, textAlign: 'center' }}>
                    Have them scan this with their phone
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                    <ModalButton
                      label="They scanned it"
                      alt
                      onPress={() => {
                        setSentTo('QR scanned at the table');
                        setStage('done');
                      }}
                    />
                  </View>
                </>
              ) : (
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.AMBER_BG, borderRadius: 11, padding: 12, marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: FUND.AMBER_TEXT, lineHeight: 17 }}>
                    QR display is unavailable in this build. Send the link by text or email instead.
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 10, alignSelf: 'stretch' }}>
                <View style={{ flex: 1, height: 1, backgroundColor: FUND.BORDER }} />
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: FUND.MUTED }}>or send it</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: FUND.BORDER }} />
              </View>

              <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                <ModalButton label="Text" alt onPress={() => setStage('text')} />
                <ModalButton label="Email" onPress={() => setStage('email')} />
              </View>

              <TouchableOpacity
                onPress={() => {
                  Clipboard.setString(link);
                  FlashMessage.success('Copied', 'Link copied to the clipboard.');
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 }}
              >
                <Ionicons name="copy-outline" size={14} color={FUND.SUBTEXT} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: FUND.SUBTEXT }}>Copy link</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={close} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: FUND.MUTED }}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'text' && (
            <>
              <Text style={{ fontSize: 19, fontWeight: '700', color: FUND.TEXT, marginBottom: 4 }}>Text the link</Text>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: FUND.MUTED, marginBottom: 4, textAlign: 'center' }}>
                Opens your messages app with the link ready to send
              </Text>
              <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 12, marginTop: 14 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: FUND.SUBTEXT, marginRight: 6 }}>+1</Text>
                <TextInput
                  style={{ flex: 1, fontSize: 16, fontWeight: '600', color: FUND.TEXT, padding: 0 }}
                  value={phone}
                  onChangeText={(t) => setPhone(formatLocalUSPhone(t))}
                  placeholder="443-878-4937"
                  placeholderTextColor={FUND.MUTED}
                  keyboardType="phone-pad"
                  maxLength={12}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                <ModalButton label="Open messages" onPress={sendText} />
              </View>
              <TouchableOpacity onPress={() => setStage('choose')} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: FUND.MUTED }}>Back</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'email' && (
            <>
              <Text style={{ fontSize: 19, fontWeight: '700', color: FUND.TEXT, marginBottom: 4 }}>Email the link</Text>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: FUND.MUTED, marginBottom: 4, textAlign: 'center' }}>
                Opens your mail app with the link ready to send
              </Text>
              <TextInput
                style={{ alignSelf: 'stretch', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, fontWeight: '600', color: FUND.TEXT, marginTop: 14, textAlign: 'center' }}
                value={email}
                onChangeText={setEmail}
                placeholder="homeowner@email.com"
                placeholderTextColor={FUND.MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                <ModalButton label="Open mail" onPress={sendEmail} />
              </View>
              <TouchableOpacity onPress={() => setStage('choose')} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: FUND.MUTED }}>Back</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'done' && (
            <>
              <Text style={{ fontSize: 34, marginBottom: 6 }}>✅</Text>
              <Text style={{ fontSize: 19, fontWeight: '700', color: FUND.TEXT, marginBottom: 4 }}>Link sent</Text>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: FUND.MUTED, marginBottom: 16, textAlign: 'center' }}>{sentTo}</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                <ModalButton
                  label="Done"
                  onPress={() => {
                    const who = sentTo;
                    reset();
                    onSent(who);
                  }}
                />
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}