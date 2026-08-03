import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import { LeadService } from '../../../services/api/leads';
import { useAuth } from '../../../hooks/useAuth';
// The backend records a server-side audit of the remote session (REVDSM-263), but the
// portal timeline renders `user-activity-log` rows — so we ALSO fire client logs for the
// rep's remote-signing actions (send / resend / recipient edit / cancel) so they show up
// in the portal next to the in-person agreement events.
import {
  logAgreementSentRemote,
  logAgreementRemoteResent,
  logAgreementRemoteRecipientUpdated,
  logAgreementRemoteCancelled,
} from '../../../utils/activity-log/remote-agreement-log';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A party that must sign the agreement — the primary buyer or a co-buyer. */
interface Signer {
  role: 'buyer' | 'coBuyer';
  /** 0 for the primary buyer, 1..n for co-buyers (stable per party). */
  index: number;
  firstName: string;
  lastName: string;
  /** Local display phone, e.g. "(555) 123-4567" — normalized to +1… on send. */
  phone: string;
  email: string;
  /** True ONLY for the primary buyer — they always initial the electronic-payment
   *  section. Co-buyers sign only their own signature section. */
  signsInitials: boolean;
}

/** Per-signer status returned by the backend (`remote-status`). */
interface SignerStatus {
  signerId: string;
  role?: string;
  /** null = primary buyer; 0,1,… = co-buyers (matches `customer.coBuyers`). */
  coBuyerIndex?: number | null;
  name?: string;
  phone?: string;
  email?: string;
  status?: 'sent' | 'viewed' | 'signed' | 'declined' | string;
  lastSentAt?: string;
  viewedAt?: string;
  signedAt?: string;
  declineReason?: string;
  sendCount?: number;
}

/** The remote agreement returned by `remote-status` / `send-remote` (REVDSM-263). */
interface RemoteAgreement {
  agreementId: string;
  /** pending · completed · declined · cancelled · expired */
  status?: string;
  showInitials?: boolean;
  signedPdfUrl?: string | null;
  signers: SignerStatus[];
}

interface AgreementRemoteSignModalProps {
  visible: boolean;
  onClose: () => void;
  leadId: string;
  agreementId: string;
  payload: any;
  signatureFields?: any;
  pdfDimensions?: any;
  /** The lead's customerDetails — provides the primary buyer + `coBuyers[]`. */
  customerDetails?: any;
  /** Fired once every signer has signed (parent refreshes / closes). */
  onComplete?: () => void;
  /** Fired once the rep has SENT the agreement for remote signature (it's now
   *  pending). The parent closes the whole agreement stack and lands on the summary,
   *  which shows "Pending Customer Signature" until the signed PDF is filed. */
  onSent?: (agreementId?: string) => void;
}

// There is no push — poll `remote-status` while pending (doc: every 10–15s).
const POLL_MS = 12000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format only the local 10-digit part as (XXX) XXX-XXXX, no +1 prefix. */
const formatLocalPhone = (text: string): string => {
  const digits = text.replace(/\D/g, '').replace(/^1/, '').slice(-10).substring(0, 10);
  if (!digits) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.substring(0, 3)}) ${digits.substring(3)}`;
  return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
};

/** Reduce a display phone to the bare 10 digits the API expects (e.g. "5551234567"). */
const digitsOnly = (display: string): string =>
  display.replace(/\D/g, '').replace(/^1/, '').slice(-10);

const fullName = (s: { firstName?: string; lastName?: string }) =>
  `${s.firstName || ''} ${s.lastName || ''}`.trim();

/** Build the signer list from the lead's customer details (buyer + co-buyers). */
const buildSigners = (customerDetails: any): Signer[] => {
  const cd = customerDetails || {};
  const buyer: Signer = {
    role: 'buyer',
    index: 0,
    firstName: cd.firstName || '',
    lastName: cd.lastName || '',
    phone: formatLocalPhone(cd.phone || cd.phoneNumber || cd.mobile || ''),
    email: cd.email || '',
    signsInitials: true,
  };
  const coBuyers: Signer[] = (Array.isArray(cd.coBuyers) ? cd.coBuyers : []).map(
    (c: any, i: number) => ({
      role: 'coBuyer' as const,
      index: i + 1,
      firstName: c?.firstName || '',
      lastName: c?.lastName || '',
      phone: formatLocalPhone(c?.phone || ''),
      email: c?.email || '',
      signsInitials: false,
    })
  );
  return [buyer, ...coBuyers];
};

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  sent: { label: 'Sent', color: '#B45309', bg: '#FEF3C7', icon: 'send-outline' },
  viewed: { label: 'Viewed', color: '#1D4ED8', bg: '#DBEAFE', icon: 'eye-outline' },
  signed: { label: 'Signed', color: '#15803D', bg: '#DCFCE7', icon: 'check-circle-outline' },
  declined: { label: 'Declined', color: '#B91C1C', bg: '#FEE2E2', icon: 'close-circle-outline' },
};

// ─── Component ──────────────────────────────────────────────────────────────

export const AgreementRemoteSignModal: React.FC<AgreementRemoteSignModalProps> = ({
  visible,
  onClose,
  leadId,
  // agreementId / payload / signatureFields / pdfDimensions are accepted for caller
  // compatibility but the remote flow is driven entirely by leadId + the server's own
  // agreement (its id comes back from send-remote / remote-status).
  customerDetails,
  onComplete,
  onSent,
}) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const uid = user?._id || user?.id;

  // 'compose' — edit recipients & send; 'pending' — track/resend; 'done' — completed.
  const [phase, setPhase] = useState<'compose' | 'pending' | 'done'>('compose');
  const [signers, setSigners] = useState<Signer[]>([]);
  const [agreement, setAgreement] = useState<RemoteAgreement | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Inline recipient editor while pending: which signer/field is open.
  const [editing, setEditing] = useState<{ signerId: string; field: 'phone' | 'email'; value: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Normalize send-remote / remote-status into a RemoteAgreement (or null) ──
  // `remote-status` wraps as `{ agreement: {...}|null }`; `send-remote` returns the
  // agreement fields flat (`{ agreementId, status, results, signers }`).
  const normalizeAgreement = (raw: any): RemoteAgreement | null => {
    const data = raw?.data?.data ?? raw?.data ?? raw;
    const ag = data && 'agreement' in data ? data.agreement : data?.agreementId ? data : null;
    if (!ag || !ag.agreementId) return null;
    return {
      agreementId: ag.agreementId,
      status: ag.status,
      showInitials: ag.showInitials,
      signedPdfUrl: ag.signedPdfUrl,
      signers: Array.isArray(ag.signers) ? ag.signers : [],
    };
  };

  // Agreement status → which panel. pending/declined → track; completed → done;
  // cancelled/expired (or none) → compose so the rep can send afresh.
  const phaseFor = (a: RemoteAgreement | null): 'compose' | 'pending' | 'done' => {
    const s = String(a?.status || '').toLowerCase();
    if (!a || s === 'cancelled' || s === 'expired') return 'compose';
    if (s === 'completed') return 'done';
    return 'pending';
  };

  // ── Fetch current agreement status ──────────────────────────────────────────
  const refreshStatus = useCallback(
    async (opts: { showSpinner?: boolean } = {}) => {
      if (!leadId) return;
      if (opts.showSpinner) setLoadingStatus(true);
      try {
        const res = await LeadService.getAgreementRemoteStatus(leadId);
        const next = normalizeAgreement(res);
        if (next) {
          setAgreement(next);
          setPhase(phaseFor(next));
        }
        // `{ agreement: null }` → nothing out for signature; stay on compose.
      } catch {
        // Network / not-found → treat as "no active agreement".
      } finally {
        if (opts.showSpinner) setLoadingStatus(false);
      }
    },
    [leadId]
  );

  // ── On open: seed signers from customer details, then probe for a session ────
  useEffect(() => {
    if (!visible) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    setPhase('compose');
    setSigners(buildSigners(customerDetails));
    setAgreement(null);
    setEditing(null);
    refreshStatus({ showSpinner: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Poll while pending ───────────────────────────────────────────────────────
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (visible && phase === 'pending') {
      pollRef.current = setInterval(() => refreshStatus(), POLL_MS);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [visible, phase, refreshStatus]);

  // ── Recipient edits (compose phase) ──────────────────────────────────────────
  const updateSigner = (index: number, patch: Partial<Signer>) => {
    setSigners((prev) => prev.map((s) => (s.index === index ? { ...s, ...patch } : s)));
  };

  const signerHasContact = (s: Signer) => digitsOnly(s.phone).length > 0 || s.email.trim().length > 0;
  const canSend = signers.length > 0 && signers.every(signerHasContact);

  // ── Send ─────────────────────────────────────────────────────────────────────
  // `POST /agreement/:leadId/send-remote` with `{ signers: [{ coBuyerIndex, phone,
  // email }] }` — `coBuyerIndex: null` is the primary buyer. The server contacts every
  // signer and files the signed PDF once all have signed. Audit is server-side.
  const handleSend = async () => {
    if (!canSend) {
      Alert.alert('Missing contact', 'Each signer needs a phone number or an email address.');
      return;
    }
    setSending(true);
    try {
      const body = {
        signers: signers.map((s) => ({
          coBuyerIndex: s.index === 0 ? null : s.index - 1,
          phone: digitsOnly(s.phone),
          email: s.email.trim(),
        })),
      };
      const res = await LeadService.sendAgreementRemote(leadId, body);
      const data = res?.data?.data ?? res?.data;
      const next = normalizeAgreement(res);

      if (next) {
        setAgreement(next);
        setPhase(phaseFor(next));
      } else {
        setPhase('pending');
        await refreshStatus({ showSpinner: true });
      }

      // Portal timeline: the agreement was sent for remote signature. Fired on a
      // successful POST (whether every signer was reached or only some — the partial
      // case is surfaced to the rep below).
      if (uid) {
        logAgreementSentRemote({
          userId: uid,
          leadId,
          agreementId: next?.agreementId,
          signers: signers.map((s) => ({
            role: s.role === 'buyer' ? 'Buyer' : 'Co-Buyer',
            name: fullName(s) || (s.role === 'buyer' ? 'Primary Buyer' : `Co-Buyer ${s.index}`),
            phone: digitsOnly(s.phone),
            email: s.email.trim(),
          })),
        }).catch(() => {});
      }

      // A PARTIAL failure still returns 200 — surface any signer we couldn't reach
      // (delivered:false means every channel for that signer failed).
      const results: any[] = Array.isArray(data?.results) ? data.results : [];
      const undelivered = results.filter((r) => r?.delivered === false);
      if (undelivered.length) {
        // Stay on the pending panel so the rep can fix the bad phone/email and resend.
        const names = undelivered.map((r) => r?.name || 'a signer').join(', ');
        Alert.alert('Sent — with issues', `Couldn't reach: ${names}. Fix their phone/email below and resend.`);
      } else {
        // Fully delivered — close the whole agreement stack and land on the summary,
        // which now shows "Pending Customer Signature". (Inlines handleSent using the
        // freshly-normalized `next` so it doesn't depend on the async `agreement` state.)
        Alert.alert('Sent', 'The agreement was sent for remote signature.', [
          {
            text: 'OK',
            onPress: () => {
              if (onSent) onSent(next?.agreementId);
              else onClose();
            },
          },
        ]);
      }
    } catch (err: any) {
      // 409 = an agreement is already out. Load it so the rep can resend / edit /
      // cancel instead of being stuck. 502 = nothing reached anyone (a real failure).
      const code = err?.code || err?.response?.status || err?.status;
      const msg = String(err?.message || err?.response?.data?.message || '');
      if (code === 409 || /already/i.test(msg)) {
        await refreshStatus({ showSpinner: true });
        Alert.alert('Already sent', 'This agreement is already out for signature — resend, edit a recipient, or cancel it below.');
      } else {
        Alert.alert('Error', msg || 'Could not send the agreement. Please try again.');
      }
    } finally {
      setSending(false);
    }
  };

  // ── Resend / edit contact (pending phase) ────────────────────────────────────
  // Both rotate the signer's token, so the previously sent link stops working.
  const doResend = async (signer: SignerStatus, patch?: { phone?: string; email?: string }) => {
    if (!agreement) return;
    setResendingId(signer.signerId);
    try {
      if (patch) {
        // PATCH corrects the contact AND resends in one call.
        await LeadService.updateAgreementRemoteSigner(agreement.agreementId, signer.signerId, patch);
      } else {
        await LeadService.resendAgreementRemoteSigner(agreement.agreementId, signer.signerId);
      }
      await refreshStatus();
      // Portal timeline: a recipient edit (phone/email correction) vs a plain resend.
      if (uid) {
        const info = {
          role:
            signer.coBuyerIndex == null || (signer.role || '').toLowerCase() === 'buyer'
              ? 'Buyer'
              : 'Co-Buyer',
          name: signer.name || '',
          phone: patch?.phone ?? signer.phone ?? '',
          email: patch?.email ?? signer.email ?? '',
        };
        if (patch) {
          const field = patch.phone !== undefined ? 'phone' : 'email';
          logAgreementRemoteRecipientUpdated({
            userId: uid,
            leadId,
            agreementId: agreement.agreementId,
            signer: info,
            field,
            newValue: String(patch.phone ?? patch.email ?? ''),
          }).catch(() => {});
        } else {
          logAgreementRemoteResent({
            userId: uid,
            leadId,
            agreementId: agreement.agreementId,
            signer: info,
          }).catch(() => {});
        }
      }
      Alert.alert('Sent', patch ? 'Recipient updated and link resent.' : 'Link resent.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not resend. Please try again.');
    } finally {
      setResendingId(null);
    }
  };

  const openEdit = (signer: SignerStatus, field: 'phone' | 'email') => {
    const value =
      field === 'phone'
        ? formatLocalPhone(signer.phone || '')
        : signer.email || '';
    setEditing({ signerId: signer.signerId, field, value });
  };

  const saveEdit = async () => {
    if (!editing || !agreement) return;
    const signer = agreement.signers.find((s) => s.signerId === editing.signerId);
    if (!signer) return;
    const patch =
      editing.field === 'phone'
        ? { phone: digitsOnly(editing.value) }
        : { email: editing.value.trim() };
    if (editing.field === 'phone' && !patch.phone) {
      Alert.alert('Invalid phone', 'Enter a valid 10-digit phone number.');
      return;
    }
    if (editing.field === 'email' && !patch.email) {
      Alert.alert('Invalid email', 'Enter a valid email address.');
      return;
    }
    setSavingEdit(true);
    try {
      await doResend(signer, patch);
      setEditing(null);
    } finally {
      setSavingEdit(false);
    }
  };

  // Cancel the whole request (voids every outstanding link) → back to compose.
  const handleCancel = () => {
    if (!agreement) return;
    Alert.alert('Cancel request?', 'This voids every outstanding signing link for this agreement.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Request',
        style: 'destructive',
        onPress: async () => {
          try {
            const cancelledId = agreement.agreementId;
            await LeadService.cancelAgreementRemote(cancelledId);
            // Portal timeline: the remote request was voided.
            if (uid) {
              logAgreementRemoteCancelled({ userId: uid, leadId, agreementId: cancelledId }).catch(() => {});
            }
            setAgreement(null);
            setSigners(buildSigners(customerDetails));
            setPhase('compose');
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Could not cancel. Please try again.');
          }
        },
      },
    ]);
  };

  const handleDone = () => {
    // Hand off to the parent, which closes THIS sheet then the agreement modal on a
    // later frame (see AgreementSignatureModal.onComplete). Do NOT also call onClose
    // here — a second same-frame dismissal is what caused the blank black screen.
    if (onComplete) onComplete();
    else onClose();
  };

  // The rep has SENT the agreement for remote signature (it is now pending). Hand off
  // to the parent to close the WHOLE agreement stack and land on the summary, which
  // shows "Pending Customer Signature" and polls the signed PDF in once the homeowner
  // signs. Same staged-teardown contract as `handleDone` — never also call onClose here.
  const handleSent = () => {
    if (onSent) onSent(agreement?.agreementId);
    else onClose();
  };

  // The sheet's close (header ✕) routes by phase: compose → plain dismiss; pending
  // (already sent) → hand off as "sent" so we return to the summary's pending state;
  // done (all signed) → complete. Keeps every exit consistent with the primary button.
  const closeSheet = () => {
    if (phase === 'done') return handleDone();
    if (phase === 'pending' && agreement) return handleSent();
    return onClose();
  };

  // ── Derived: signer rows for the pending panel (buyer first, then co-buyers) ──
  const pendingRows = useMemo(() => {
    if (!agreement) return [];
    const idxOf = (st: SignerStatus) => (st.coBuyerIndex == null ? -1 : st.coBuyerIndex);
    return agreement.signers
      .slice()
      .sort((a, b) => idxOf(a) - idxOf(b))
      .map((st) => {
        const isBuyer = st.coBuyerIndex == null || (st.role || '').toLowerCase() === 'buyer';
        const roleLabel = isBuyer ? 'Buyer' : 'Co-Buyer';
        const name = st.name || (isBuyer ? fullName(signers[0] || {}) : roleLabel);
        return { st, roleLabel, name };
      });
  }, [agreement, signers]);

  // ─── Render: shared shell ────────────────────────────────────────────────────
  const sheetBg = isDark ? colors.card : '#FFFFFF';
  const titleColor = isDark ? '#FFF' : '#1C252E';

  const renderHeader = (title: string, sub: string) => (
    <View style={styles.titleRow}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={[styles.sheetTitle, { color: titleColor }]}>{title}</Text>
        <Text style={styles.sheetSub}>{sub}</Text>
      </View>
      <TouchableOpacity onPress={closeSheet} disabled={sending}>
        <Icon name="close" size={24} color="#637381" />
      </TouchableOpacity>
    </View>
  );

  // ─── Render: COMPOSE ─────────────────────────────────────────────────────────
  const renderCompose = () => (
    <>
      {renderHeader('Send Agreement Remotely', 'Each signer gets a link to sign on their own phone')}

      <View style={[styles.infoBanner, { backgroundColor: isDark ? '#3B82F615' : '#EFF6FF', borderColor: isDark ? '#3B82F640' : '#BFDBFE' }]}>
        <Icon name="information-outline" size={18} color="#2563EB" style={{ marginTop: 1 }} />
        <Text style={[styles.infoText, { color: isDark ? '#93C5FD' : '#1E40AF' }]}>
          The homeowner signs on their own device. We&apos;ll show each signer&apos;s status here and
          you can resend or fix a number/email any time.
        </Text>
      </View>

      {signers.map((s) => (
        <View
          key={`${s.role}-${s.index}`}
          style={[styles.signerCard, { backgroundColor: isDark ? '#FFFFFF08' : '#F9FAFB', borderColor: isDark ? '#FFFFFF12' : '#EEF1F4' }]}
        >
          <View style={styles.signerCardHead}>
            <Text style={[styles.signerName, { color: titleColor }]}>
              {fullName(s) || (s.role === 'buyer' ? 'Primary Buyer' : `Co-Buyer ${s.index}`)}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: s.role === 'buyer' ? '#4CBB17' : '#00B8D9' }]}>
              <Text style={styles.roleBadgeText}>{s.role === 'buyer' ? 'BUYER' : 'CO-BUYER'}</Text>
            </View>
          </View>
          {s.signsInitials && (
            <Text style={styles.initialsNote}>
              Signs signature + initials (electronic-payment authorization)
            </Text>
          )}

          {/* Phone */}
          <Text style={styles.fieldLabel}>Phone Number</Text>
          <View style={[styles.inputRow, { borderColor: isDark ? '#FFFFFF20' : '#919EAB33', backgroundColor: isDark ? '#FFFFFF05' : '#FFFFFF' }]}>
            <Text style={[styles.prefix, { color: isDark ? '#FFFFFF80' : '#637381' }]}>+1</Text>
            <TextInput
              value={s.phone}
              onChangeText={(t) => updateSigner(s.index, { phone: formatLocalPhone(t) })}
              placeholder="(555) 123-4567"
              placeholderTextColor="#919EAB"
              keyboardType="phone-pad"
              style={[styles.inputText, { color: titleColor }]}
              editable={!sending}
            />
          </View>

          {/* Email */}
          <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Email Address</Text>
          <View style={[styles.inputRow, { borderColor: isDark ? '#FFFFFF20' : '#919EAB33', backgroundColor: isDark ? '#FFFFFF05' : '#FFFFFF' }]}>
            <Icon name="email-outline" size={16} color="#637381" style={{ marginRight: 8 }} />
            <TextInput
              value={s.email}
              onChangeText={(t) => updateSigner(s.index, { email: t })}
              placeholder="customer@email.com"
              placeholderTextColor="#919EAB"
              keyboardType="email-address"
              autoCapitalize="none"
              style={[styles.inputText, { color: titleColor }]}
              editable={!sending}
            />
          </View>

          {!signerHasContact(s) && (
            <Text style={styles.contactWarn}>Add a phone or email to send this signer a link.</Text>
          )}
        </View>
      ))}

      <View style={{ gap: 10, marginTop: 8 }}>
        <TouchableOpacity
          onPress={handleSend}
          disabled={sending || !canSend}
          style={[styles.primaryBtn, { backgroundColor: !sending && canSend ? '#4CBB17' : '#919EAB33' }]}
        >
          {sending ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={[styles.primaryBtnText, { color: !sending && canSend ? 'white' : '#919EABCC' }]}>
              {signers.length > 1 ? `Send to ${signers.length} Signers` : 'Send for Signature'}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} disabled={sending} style={[styles.cancelBtn, { borderColor: isDark ? '#FFFFFF20' : '#E2E8F0' }]}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  // ─── Render: PENDING ─────────────────────────────────────────────────────────
  const renderPending = () => (
    <>
      {renderHeader('Pending Customer Signature', 'Waiting for the homeowner to sign remotely')}

      <View style={[styles.pendingBanner, { backgroundColor: isDark ? '#F59E0B15' : '#FFF8E6', borderColor: isDark ? '#F59E0B40' : '#F59E0B60' }]}>
        <Icon name="clock-outline" size={18} color="#D97706" style={{ marginTop: 1 }} />
        <Text style={[styles.infoText, { color: isDark ? '#F59E0B' : '#92400E' }]}>
          Updates automatically. You&apos;ll see when each signer views and signs.
        </Text>
        {loadingStatus && <ActivityIndicator size="small" color="#D97706" />}
      </View>

      {pendingRows.map(({ st, roleLabel, name }) => {
        const meta = STATUS_META[String(st.status || 'sent').toLowerCase()] || STATUS_META.sent;
        const isEditingThis = editing?.signerId === st.signerId;
        return (
          <View
            key={st.signerId}
            style={[styles.signerCard, { backgroundColor: isDark ? '#FFFFFF08' : '#F9FAFB', borderColor: isDark ? '#FFFFFF12' : '#EEF1F4' }]}
          >
            <View style={styles.signerCardHead}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.signerName, { color: titleColor }]}>{name}</Text>
                <Text style={styles.signerRole}>
                  {roleLabel}
                  {roleLabel === 'Buyer' ? ' · signs initials' : ''}
                </Text>
              </View>
              <View style={[styles.statusChip, { backgroundColor: meta.bg }]}>
                <Icon name={meta.icon} size={13} color={meta.color} style={{ marginRight: 4 }} />
                <Text style={[styles.statusChipText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            </View>

            {/* Recipient line */}
            <Text style={styles.recipientLine}>
              {st.phone ? `📱 ${formatLocalPhone(st.phone)}` : ''}
              {st.phone && st.email ? '   ' : ''}
              {st.email ? `✉️ ${st.email}` : ''}
              {!st.phone && !st.email ? 'No contact on file' : ''}
            </Text>

            {/* Inline editor */}
            {isEditingThis ? (
              <View style={styles.editRow}>
                <View style={[styles.inputRow, { flex: 1, borderColor: isDark ? '#FFFFFF20' : '#919EAB33', backgroundColor: isDark ? '#FFFFFF05' : '#FFFFFF' }]}>
                  {editing!.field === 'phone' && (
                    <Text style={[styles.prefix, { color: isDark ? '#FFFFFF80' : '#637381' }]}>+1</Text>
                  )}
                  <TextInput
                    value={editing!.value}
                    onChangeText={(t) =>
                      setEditing((e) =>
                        e ? { ...e, value: e.field === 'phone' ? formatLocalPhone(t) : t } : e
                      )
                    }
                    placeholder={editing!.field === 'phone' ? '(555) 123-4567' : 'customer@email.com'}
                    placeholderTextColor="#919EAB"
                    keyboardType={editing!.field === 'phone' ? 'phone-pad' : 'email-address'}
                    autoCapitalize="none"
                    autoFocus
                    style={[styles.inputText, { color: titleColor }]}
                    editable={!savingEdit}
                  />
                </View>
                <TouchableOpacity onPress={() => setEditing(null)} disabled={savingEdit} style={styles.iconBtnGhost}>
                  <Icon name="close" size={18} color="#637381" />
                </TouchableOpacity>
                <TouchableOpacity onPress={saveEdit} disabled={savingEdit} style={[styles.iconBtnSolid, { backgroundColor: '#4CBB17' }]}>
                  {savingEdit ? <ActivityIndicator size="small" color="white" /> : <Icon name="check" size={18} color="white" />}
                </TouchableOpacity>
              </View>
            ) : (
              String(st.status || '').toLowerCase() !== 'signed' && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    onPress={() => doResend(st)}
                    disabled={resendingId === st.signerId}
                    style={styles.actionChip}
                  >
                    {resendingId === st.signerId ? (
                      <ActivityIndicator size="small" color="#4CBB17" />
                    ) : (
                      <>
                        <Icon name="refresh" size={14} color="#4CBB17" />
                        <Text style={styles.actionChipText}>Resend</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => openEdit(st, 'phone')} style={styles.actionChip}>
                    <Icon name="phone-outline" size={14} color="#637381" />
                    <Text style={[styles.actionChipText, { color: '#637381' }]}>Edit Phone</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => openEdit(st, 'email')} style={styles.actionChip}>
                    <Icon name="email-outline" size={14} color="#637381" />
                    <Text style={[styles.actionChipText, { color: '#637381' }]}>Edit Email</Text>
                  </TouchableOpacity>
                </View>
              )
            )}
          </View>
        );
      })}

      <TouchableOpacity onPress={handleSent} style={[styles.primaryBtn, { backgroundColor: isDark ? '#FFFFFF14' : '#0F172A', marginTop: 8 }]}>
        <Text style={[styles.primaryBtnText, { color: 'white' }]}>Done</Text>
      </TouchableOpacity>
      {/* Cancel the whole request (voids every outstanding link) — e.g. wrong lead. */}
      <TouchableOpacity onPress={handleCancel} style={{ alignItems: 'center', paddingVertical: 12, marginTop: 2 }}>
        <Text style={{ color: '#EF4444', fontWeight: '800', fontSize: 12 }}>Cancel Request</Text>
      </TouchableOpacity>
    </>
  );

  // ─── Render: DONE ────────────────────────────────────────────────────────────
  const renderDone = () => (
    <>
      {renderHeader('Agreement Signed', 'All signers have completed the agreement')}
      <View style={styles.doneWrap}>
        <View style={styles.doneCircle}>
          <Icon name="check-bold" size={40} color="white" />
        </View>
        <Text style={[styles.doneTitle, { color: titleColor }]}>Signed remotely</Text>
        <Text style={styles.doneSub}>
          Every signer has signed. The signed agreement has been saved to this job.
        </Text>
      </View>
      <TouchableOpacity onPress={handleDone} style={[styles.primaryBtn, { backgroundColor: '#4CBB17' }]}>
        <Text style={[styles.primaryBtnText, { color: 'white' }]}>Done</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <View style={styles.overlay}>
          <View style={[styles.sheetCard, { backgroundColor: sheetBg }]}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 24, paddingBottom: Math.max(insets.bottom, 24) }}
            >
              {phase === 'compose' && renderCompose()}
              {phase === 'pending' && renderPending()}
              {phase === 'done' && renderDone()}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheetCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', overflow: 'hidden' },

  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontWeight: '900' },
  sheetSub: { fontSize: 13, color: '#637381', marginBottom: 16 },

  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1,
    borderRadius: 12, padding: 14, marginBottom: 16,
  },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1,
    borderRadius: 12, padding: 14, marginBottom: 16,
  },
  infoText: { flex: 1, fontSize: 12.5, lineHeight: 18 },

  signerCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  signerCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  signerName: { fontSize: 15, fontWeight: '800' },
  signerRole: { fontSize: 11, color: '#637381', marginTop: 2, fontWeight: '600' },
  roleBadge: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  roleBadgeText: { color: 'white', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  initialsNote: { fontSize: 11, color: '#4CBB17', fontWeight: '700', marginTop: 6 },

  fieldLabel: {
    fontSize: 10, fontWeight: '900', color: '#637381', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 6, marginTop: 12,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, height: 50,
  },
  prefix: { fontWeight: '700', marginRight: 6, fontSize: 14, includeFontPadding: false },
  inputText: { flex: 1, fontSize: 14, fontWeight: '600' },
  contactWarn: { fontSize: 11, color: '#FF5630', fontWeight: '700', marginTop: 8 },

  recipientLine: { fontSize: 12.5, color: '#637381', marginTop: 8, fontWeight: '600' },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 8,
  },
  actionChipText: { fontWeight: '800', color: '#4CBB17', fontSize: 12 },

  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  iconBtnGhost: {
    width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnSolid: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  statusChip: { flexDirection: 'row', alignItems: 'center', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  statusChipText: { fontSize: 11, fontWeight: '800' },

  primaryBtn: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontWeight: '900', fontSize: 14, letterSpacing: 0.3 },
  cancelBtn: { height: 50, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontWeight: '700', color: '#637381', fontSize: 14 },

  doneWrap: { alignItems: 'center', paddingVertical: 24 },
  doneCircle: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#4CBB17',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  doneTitle: { fontSize: 18, fontWeight: '900' },
  doneSub: { fontSize: 13, color: '#637381', textAlign: 'center', marginTop: 8, lineHeight: 19, paddingHorizontal: 12 },
});
