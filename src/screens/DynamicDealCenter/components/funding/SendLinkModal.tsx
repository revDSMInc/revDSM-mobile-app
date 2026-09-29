import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Keyboard } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import { FS, FUND, PS } from './funding-theme';
import { FlashMessage } from '../../../../config/message';
import { formatLocalUSPhone, toE164USPhone } from '../../../../utils/phone-util';
import type { FundingChannel } from '../../../../services/api/FundingService';
import {
  canResendLink,
  isReissue,
  lastSendNote,
  reissueWarning,
  resendSeed,
  type FundingPayment,
} from '../../utils/funding';

/**
 * "Send application/payment link" — the sheet that gets the homeowner onto their
 * own phone to finish a card or a loan application.
 *
 * Three ways out, in the order a rep actually uses them at a kitchen table:
 * **scan the QR** (the homeowner is sitting right there), **text it**, **email it**.
 * All three point at the SAME hosted page: `POST …/link` is idempotent, so opening
 * the sheet, backing out and reopening never stacks links or leaves an earlier one
 * live (spec §5.4).
 *
 * ⚠️ **The server does the sending**, not the device. `link-sent` with a `text` or
 * `email` channel dispatches a real SMS/HTML email — the app only supplies the
 * destination. On a `502` nothing was sent and nothing was written, so the sheet
 * stays open on the same step rather than claiming success.
 *
 * ⚠️ Opening this sheet marks NOTHING. `Link Sent` only ticks once a send actually
 * completes (spec §5.4) — which for QR means the rep confirming the homeowner
 * scanned it.
 *
 * ⚠️ **RESEND** (REVDSM-1155 Item A) reuses this same sheet rather than adding a
 * second one — it is the same two calls (`link`, then `link-sent`), and a separate
 * "resend" sheet would be a second place for the channel rules to drift. When the row
 * is already at Link Sent the sheet opens **on the channel that was used, with the
 * destination prefilled**, so the rep corrects the digit they got wrong instead of
 * retyping from a blank field — retyping is how the same typo gets made twice.
 * `Back` still reaches the QR and the other channel.
 *
 * ⚠️ **A resend to the SAME destination delivers the same url** — `link` is idempotent
 * while the page is open. That is right for "the SMS never arrived": the page was
 * always fine, the delivery was not.
 *
 * ⚠️ **A resend to a DIFFERENT destination is a RE-ISSUE** (REVDSM-1155). The server
 * expires the old Checkout session before minting the new page, so the link the wrong
 * person is holding stops working — which is the entire point, since that url is a
 * bearer credential and a mistyped number often belongs to a real person. The rep is
 * asked to confirm first (`reissueWarning`), because it is the last moment to check
 * the new number before a second stranger gets one, and the confirmation screen says
 * the old link was cancelled. See `isReissue`.
 *
 * ⚠️ The url is a **bearer credential** scoped to one payment: anyone holding it
 * can complete that payment. It is never logged or persisted — it lives in the
 * parent's state for the life of this sheet and no longer.
 *
 * Rendered as an in-sheet overlay, not a nested `<Modal>`: this already lives
 * inside the Result Lead modal, and stacked native modals are unreliable on both
 * platforms.
 */

/**
 * ⚠️ **A STATIC import, and it must stay one. Do NOT put this back behind a
 * `try/catch`.**
 *
 * It used to be an optional `require(...)` that fell back to `QRCode = null` and an
 * amber *"QR display is unavailable in this build"* note. That reads like a deliberate
 * build flag, so nobody ever realised a dependency was missing — and the QR broke,
 * got fixed on one machine, and came back for everyone else, repeatedly.
 *
 * The cause was never the code: `react-native-qrcode-svg` was hand-added to
 * `package.json` in `c558fa0` and, because **`yarn.lock` is gitignored**
 * (`.gitignore:80`, untracked for the whole history), there is no shared lockfile to
 * carry it — so it only ever reached a machine whose owner happened to re-run
 * `yarn install`. The silent fallback is what let that ship instead of being noticed.
 *
 * Static, an absent module is a **Metro resolution error at build time** — loud,
 * immediate, and fixed by `yarn install`. It can no longer reach a rep at a kitchen
 * table. The package is pure JS over `react-native-svg` (already a hard dependency
 * here), so there is nothing to pod-install or link.
 */
import QRCode from 'react-native-qrcode-svg';

type Stage = 'choose' | 'text' | 'email' | 'done';

interface Props {
  payment: FundingPayment;
  /** The hosted-page url from `POST …/link`. Empty while it is still being fetched. */
  link: string;
  isLoadingLink: boolean;
  /** A `link-sent` call is in flight. */
  isSending: boolean;
  /**
   * The company's gateway cannot accept payments (`charges_enabled`) — the
   * server's own wording.
   *
   * ⚠️ This is the ONE link failure a retry cannot fix, so it must not fall through
   * to the generic *"Close this and try again"* below: the rep would try again,
   * fail again, and call support. Only someone with portal access can resolve it.
   */
  blockedReason?: string | null;
  /** Resolves true only when the server confirms the send — see the 502 note above. */
  onSend: (channel: FundingChannel, destination?: string) => Promise<boolean>;
  /**
   * The rep put the link on the clipboard.
   *
   * ⚠️ Reported as a bare event, and the callback takes NO argument on purpose: the
   * url is a bearer credential and must not travel to a logger. What matters for the
   * record is only that the credential left the app — the payment can be completed
   * from wherever it was pasted, and no other event covers that.
   */
  onCopyLink?: () => void;
  onClose: () => void;
}

function ModalButton({ label, onPress, alt, disabled, busy }: {
  label: string; onPress: () => void; alt?: boolean; disabled?: boolean; busy?: boolean;
}) {
  const off = !!disabled || !!busy;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={off}
      style={{
        flex: 1,
        borderRadius: 11,
        paddingVertical: 13,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: off ? 0.5 : 1,
        backgroundColor: alt ? '#fff' : FUND.GREEN,
        borderWidth: alt ? 1.6 : 0,
        borderColor: FUND.BORDER,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={alt ? FUND.SUBTEXT : '#fff'} />
      ) : (
        <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: alt ? '#3A4048' : '#fff' }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

export function SendLinkModal({
  payment,
  link,
  isLoadingLink,
  isSending,
  blockedReason,
  onSend,
  onCopyLink,
  onClose,
}: Props) {
  /**
   * Is this a second (or third) send for a row that is already at Link Sent?
   *
   * ⚠️ Read off the PAYMENT, not passed in as a prop: both host screens already
   * hand this component the row, and deriving it here is what stops the two of them
   * from ever disagreeing about whether a send is a resend.
   */
  const isResend = canResendLink(payment);
  const previously = lastSendNote(payment);

  /**
   * ⚠️ Lazy initialisers, not an effect. Both hosts mount this conditionally
   * (`{!!linkPayment && <SendLinkModal …/>}`), so it remounts on every open and the
   * seed runs exactly once per open — an effect would fight the rep the moment they
   * started correcting the number.
   */
  const [stage, setStage] = useState<Stage>(() => (isResend ? resendSeed(payment).stage : 'choose'));
  const [phone, setPhone] = useState(() => (isResend ? resendSeed(payment).phone : ''));
  const [email, setEmail] = useState(() => (isResend ? resendSeed(payment).email : ''));
  const [sentTo, setSentTo] = useState('');
  /**
   * Was the send that landed on the confirmation screen a RE-ISSUE?
   *
   * ⚠️ Captured at send time rather than re-derived for the `done` copy: the row is
   * refetched the moment the send lands, so by then `sentTo` is the NEW destination
   * and `isReissue` would compare it against itself and answer false. The rep would
   * never be told the old link had been cancelled.
   */
  const [cancelledOld, setCancelledOld] = useState<string | null>(null);

  /**
   * The pending re-issue confirmation — the copy to show and what to do on YES.
   *
   * ⚠️ The action is held as a THUNK rather than reconstructed when the rep confirms.
   * The channel and destination are captured at the moment they pressed Send, so a
   * keystroke landing behind the confirmation cannot change what is actually sent.
   */
  const [confirm, setConfirm] = useState<{ warning: string; run: () => void } | null>(null);

  const isBank = payment.type === 'bank';
  const noun = isBank ? 'application' : 'payment';
  const title = `${isResend ? 'Resend' : 'Send'} ${noun} link`;

  /** Only advance to the confirmation when the SERVER says the send happened. */
  const deliver = async (channel: FundingChannel, destination: string | undefined, who: string) => {
    // Read BEFORE the call: the row is refreshed by the send, so afterwards the old
    // destination is gone. Same reason `useFunding.wasLinkSent` snapshots first.
    const cancelled = isReissue(payment, channel, destination)
      ? String(payment.sentTo || '').trim()
      : null;
    const ok = await onSend(channel, destination);
    if (!ok) return; // the hook already surfaced why; stay put so the rep can retry
    setSentTo(who);
    setCancelledOld(cancelled);
    setStage('done');
  };

  /**
   * Send, pausing first when this cancels a link that is already out there.
   *
   * ⚠️ Not required by the API — the server re-issues either way — but the rep is
   * about to kill a page the homeowner may already have open, and this is the last
   * moment to notice a wrong number before a SECOND stranger receives one.
   *
   * ⚠️ **An in-sheet layer, NOT a native `Alert` and NOT a nested `<Modal>`.** This
   * component is already an absolutely-positioned overlay (it is not itself a Modal,
   * for the stacked-modal reason at the top of the file), so another absolute layer
   * inside its own root sits above it with no z-order risk and carries the app’s own
   * type and colour. A native Alert here rendered in the OS chrome instead: system
   * font, system buttons, and a title the rep reads as coming from the phone rather
   * than from the deal.
   *
   * ⚠️ The keyboard is dismissed first. This is raised from the text/email stage,
   * where the keyboard covers the lower half of the screen — the previous native
   * dialog was drawn over it, but an in-sheet card is not.
   */
  const confirmThenDeliver = (channel: FundingChannel, destination: string, who: string) => {
    const warning = reissueWarning(payment, channel, destination);
    if (!warning) {
      deliver(channel, destination, who);
      return;
    }
    Keyboard.dismiss();
    setConfirm({ warning, run: () => deliver(channel, destination, who) });
  };

  const sendText = () => {
    const e164 = toE164USPhone(phone);
    if (e164.length !== 12) {
      FlashMessage.warning('Phone number', 'Enter the homeowner’s 10-digit mobile number.');
      return;
    }
    confirmThenDeliver('text', e164, `Texted to ${formatLocalUSPhone(phone)}`);
  };

  const sendEmail = () => {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      FlashMessage.warning('Email address', 'Enter a valid email address for the homeowner.');
      return;
    }
    confirmThenDeliver('email', to, `Emailed to ${to}`);
  };

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,20,24,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 22, maxHeight: '92%' }}>
        <ScrollView contentContainerStyle={{ padding: 22, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
          {stage === 'choose' && (
            <>
              <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, marginBottom: 4, textAlign: 'center' }}>{title}</Text>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginBottom: isResend && previously ? 10 : 16, textAlign: 'center' }}>
                ${payment.amount.toLocaleString()} · {payment.method}
              </Text>

              {/* ⚠️ The destination, read back. A rep who mistyped a digit cannot see
                  it anywhere else — this is the whole point of the resend flow. */}
              {isResend && !!previously && (
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 }}>
                  <Text style={{ fontSize: FS.TINY, fontFamily: PS.extrabold, letterSpacing: 0.5, color: FUND.MUTED, marginBottom: 3 }}>LAST SENT</Text>
                  <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.SUBTEXT }}>{previously}</Text>
                </View>
              )}

              {isLoadingLink ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color={FUND.GREEN} />
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginTop: 12 }}>Preparing the link…</Text>
                </View>
              ) : blockedReason ? (
                /* ⚠️ NOT "try again". The company's Stripe account is connected but
                   cannot take payments, and no number of taps changes that — the
                   rep needs someone with portal access, so say so and name them. */
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.RED_BG, borderRadius: 11, padding: 12 }}>
                  <Text style={{ fontSize: FS.BODY, fontFamily: PS.extrabold, color: FUND.RED_TEXT }}>
                    Payments are not set up for your company yet
                  </Text>
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.RED_TEXT, lineHeight: 17, marginTop: 4 }}>
                    Contact your office — setup has to be finished in Stripe before card and loan links can be sent.
                    Nothing has been sent.
                  </Text>
                  {/* The server's wording names the exact requirement whoever is
                      called will have to clear. */}
                  <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, color: FUND.RED_TEXT, lineHeight: 16, marginTop: 6, opacity: 0.85 }}>
                    {blockedReason}
                  </Text>
                </View>
              ) : !link ? (
                /* The link call failed — the hook has already said why. Without a url
                   there is nothing to scan, text or email, so offer the way out
                   rather than three dead buttons. */
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.RED_BG, borderRadius: 11, padding: 12 }}>
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.RED_TEXT, lineHeight: 17 }}>
                    Couldn’t create the payment link. Close this and try again — nothing has been sent.
                  </Text>
                </View>
              ) : (
                <>
                  {/* ⚠️ Unconditional. There is no "QR unavailable" state any more — see
                      the import note at the top of the file. If `link` resolved, the
                      code renders. */}
                  <View style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: FUND.BORDER, backgroundColor: '#fff' }}>
                    <QRCode value={link} size={170} backgroundColor="#fff" color={FUND.TEXT} />
                  </View>
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.SUBTEXT, marginTop: 10, textAlign: 'center' }}>
                    Have them scan this with their phone
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                    {/* Sends nothing — it RECORDS that the homeowner scanned it. */}
                    <ModalButton
                      label="They scanned it"
                      alt
                      busy={isSending}
                      onPress={() => deliver('qr', undefined, 'QR scanned at the table')}
                    />
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 10, alignSelf: 'stretch' }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: FUND.BORDER }} />
                    <Text style={{ fontSize: FS.TINY, fontFamily: PS.bold, letterSpacing: 0.6, textTransform: 'uppercase', color: FUND.MUTED }}>or send it</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: FUND.BORDER }} />
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                    <ModalButton label="Text" alt onPress={() => setStage('text')} disabled={isSending} />
                    <ModalButton label="Email" onPress={() => setStage('email')} disabled={isSending} />
                  </View>

                  <TouchableOpacity
                    onPress={() => {
                      Clipboard.setString(link);
                      onCopyLink?.();
                      FlashMessage.success('Copied', 'Link copied to the clipboard.');
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 }}
                  >
                    <Ionicons name="copy-outline" size={14} color={FUND.SUBTEXT} />
                    <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.SUBTEXT }}>Copy link</Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity onPress={onClose} style={{ marginTop: 12 }}>
                {/* "Cancel" implies aborting something in progress; when the gate
                    refused there is nothing in progress to abort. */}
                <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.MUTED }}>{blockedReason ? 'Close' : 'Cancel'}</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'text' && (
            <>
              <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, marginBottom: 4 }}>
                {isResend ? 'Check the number' : 'Text the link'}
              </Text>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginBottom: 4, textAlign: 'center' }}>
                {isResend
                  ? 'Correct it if it is wrong, then send the same link again.'
                  : 'Goes straight to the homeowner’s phone'}
              </Text>
              <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 12, marginTop: 14 }}>
                <Text style={{ fontSize: FS.LEAD, fontFamily: PS.bold, color: FUND.SUBTEXT, marginRight: 6 }}>+1</Text>
                <TextInput
                  style={{ flex: 1, fontSize: FS.LEAD, fontFamily: PS.semibold, color: FUND.TEXT, padding: 0 }}
                  value={phone}
                  onChangeText={(t) => setPhone(formatLocalUSPhone(t))}
                  placeholder="443-878-4937"
                  placeholderTextColor={FUND.MUTED}
                  keyboardType="phone-pad"
                  maxLength={12}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                <ModalButton label={isResend ? 'Resend text' : 'Send text'} onPress={sendText} busy={isSending} />
              </View>
              {/* Reaches the QR and the other channel even when a resend opened
                  straight onto this stage — nothing is taken away by the shortcut. */}
              <TouchableOpacity onPress={() => setStage('choose')} disabled={isSending} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.MUTED }}>
                  {isResend ? 'Other ways to send' : 'Back'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'email' && (
            <>
              <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, marginBottom: 4 }}>
                {isResend ? 'Check the address' : 'Email the link'}
              </Text>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginBottom: 4, textAlign: 'center' }}>
                {isResend
                  ? 'Correct it if it is wrong, then send the same link again.'
                  : 'Goes straight to the homeowner’s inbox'}
              </Text>
              <TextInput
                style={{ alignSelf: 'stretch', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 13, fontSize: FS.LEAD, fontFamily: PS.semibold, color: FUND.TEXT, marginTop: 14, textAlign: 'center' }}
                value={email}
                onChangeText={setEmail}
                placeholder="homeowner@email.com"
                placeholderTextColor={FUND.MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                <ModalButton label={isResend ? 'Resend email' : 'Send email'} onPress={sendEmail} busy={isSending} />
              </View>
              <TouchableOpacity onPress={() => setStage('choose')} disabled={isSending} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.MUTED }}>
                  {isResend ? 'Other ways to send' : 'Back'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'done' && (
            <>
              <Text style={{ fontSize: FS.EMOJI, marginBottom: 6 }}>✅</Text>
              <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, marginBottom: 4 }}>
                {cancelledOld ? 'New link sent' : isResend ? 'Link sent again' : 'Link sent'}
              </Text>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginBottom: cancelledOld ? 10 : 16, textAlign: 'center' }}>{sentTo}</Text>

              {/* ⚠️ Said explicitly, because the rep cannot see it anywhere else and it
                  is the fact that makes the mistake safe: the url the wrong person is
                  holding no longer works. It also warns them off a link they may have
                  copied to the clipboard a moment ago. */}
              {!!cancelledOld && (
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 }}>
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.SUBTEXT, lineHeight: 17 }}>
                    The earlier link to{' '}
                    {payment.sentChannel === 'email' ? cancelledOld : formatLocalUSPhone(cancelledOld) || cancelledOld}{' '}
                    has been cancelled and no longer works.
                  </Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                <ModalButton label="Done" onPress={onClose} />
              </View>
            </>
          )}
        </ScrollView>
      </View>

      {/* ── "this cancels the old link" ──
          The LAST child of the sheet root, so it covers the card and its keyboard
          without a nested <Modal>. Same chrome as the app’s other destructive
          confirmations (Cancel Job, Reset Job Builder): white card, centred title,
          outlined "keep" beside a red "do it". */}
      {!!confirm && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,20,24,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 70 }}>
          <View style={{ width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 18, padding: 20 }}>
            <View style={{ alignSelf: 'center', width: 42, height: 42, borderRadius: 21, backgroundColor: FUND.RED_BG, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Ionicons name="unlink-outline" size={20} color={FUND.RED_TEXT} />
            </View>
            <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, textAlign: 'center' }}>
              Cancel the old link?
            </Text>
            <Text style={{ fontSize: FS.BODY, fontFamily: PS.semibold, color: FUND.SUBTEXT, textAlign: 'center', lineHeight: 18, marginTop: 8 }}>
              {confirm.warning}
            </Text>

            {/* ⚠️ Said plainly, because it is the half a rep skims past: the homeowner
                may already have the old page open, and it stops working the moment
                this is confirmed. */}
            <View style={{ backgroundColor: FUND.RED_BG, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14 }}>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.RED_TEXT, lineHeight: 16 }}>
                Anyone holding the old link — including whoever received it by mistake — will no
                longer be able to pay on it.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <TouchableOpacity
                onPress={() => setConfirm(null)}
                disabled={isSending}
                style={{ flex: 1, minHeight: 44, borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#3A4048' }}>Keep it</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const go = confirm.run;
                  setConfirm(null);
                  go();
                }}
                disabled={isSending}
                style={{ flex: 1.35, minHeight: 44, backgroundColor: FUND.RED, borderRadius: 11, alignItems: 'center', justifyContent: 'center', opacity: isSending ? 0.6 : 1 }}
              >
                <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#fff' }}>{'Cancel & send new'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
