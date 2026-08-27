import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  StyleSheet,
  PanResponder,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
} from 'react-native-keyboard-controller';
import { BlurView } from '@react-native-community/blur';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { useInstallerActivityLog } from '../../../hooks/useInstallerActivityLog';
import type {
  CocRelationshipType,
  CocSignOff,
  InstallerJob,
} from '../../../config/types/installer';

/**
 * Certificate of Completion — Install, signed on the device.
 *
 * ⚠️ **The FIELDS are the paper certificate's**, one for one: the review note, the three
 * attestations (18+, authorised to sign, installed per contract), Installer's Signature
 * beside Job #, Customer's Signature beside Date, and the relationship to the homeowner.
 * Nothing on the paper form is left out and nothing is added to it — the customer's name,
 * phone, email and address are not on the certificate and are not asked for here; the job
 * record already carries them.
 *
 * ⚠️ **The CHROME is the sales Customer Consent Form's**
 * (`widgets/modals/lead-center/ConsentFormModal.tsx`), requested as a design port: the
 * same green header with its Paper Fallback pill, floating-label fields, dashed signature
 * boxes over an in-card pad, checkbox treatment, exit confirmation and footer.
 *
 * ⚠️ **What leaves this component:** `onSignatureCaptured` per saved signature (a JPEG
 * for the images endpoint) and `onSubmit` for the form itself, which the step turns into
 * `stepData.coc`. It makes no requests of its own, and no PDF is produced — the sales
 * modal generates one, this does not, so the SCAN path (onPaperFallback) is still the
 * only route that files the paper document.
 */

/**
 * Who the signer is, from the certificate's relationship boxes.
 *
 * Re-exported rather than redeclared — this used to be its own two-value union, and a
 * third value on the wire would have left the form unable to represent it.
 */
export type CoCRelationship = CocRelationshipType;

/** What the form hands back on submit. Device-local — see the note above. */
export interface CoCFormData {
  jobNumber: string;
  date: string;
  /** All three must be true to submit — the certificate is void without them. */
  isAdult: boolean;
  isAuthorizedSigner: boolean;
  installedPerContract: boolean;
  relationship: CoCRelationship;
  /** Free text, only when `relationship` is `other`. */
  relationshipOther: string;
  /** SVG path commands from the pad, in pad coordinates. */
  installerSignaturePaths: string[];
  customerSignaturePaths: string[];
  /** The pad's size when they were drawn — the viewBox those paths replay in. */
  signatureSize: { width: number; height: number };
  signedAt: string;
}

/** Which signature the pad is currently collecting. */
type SignatureSlot = 'installer' | 'customer';

interface Props {
  visible: boolean;
  job: InstallerJob;
  onClose: () => void;
  onSubmit: (data: CoCFormData) => void;
  /** Drops to the document scanner — the sales form's "Paper Fallback" pill. */
  onPaperFallback: () => void;
  /**
   * Fired as each signature is SAVED, not at submit — one call per signature, with a
   * JPEG on disk ready for `installer/v1/{jobId}/images`.
   *
   * WARNING: saving is the right moment. Submit is gated behind the three
   * attestations, so uploading there would leave a signed certificate with nothing
   * sent until every box happened to be ticked. Re-signing uploads again, which is
   * intended — each saved signature is its own image.
   */
  onSignatureCaptured?: (uri: string, who: SignatureSlot) => void;
  /**
   * The certificate already on file, from `stepData.coc` on the check-in response.
   *
   * Reopening the form shows what was actually FILED, not what this device happens to
   * remember — so a certificate signed on another phone, or before a reinstall, comes
   * back complete. The strokes only exist where they were drawn, so a signature
   * restored from the server is shown as its uploaded IMAGE.
   */
  initial?: CocSignOff | null;
  submitting?: boolean;
}

/**
 * The header's "Paper Fallback" pill — SHOWN again, by request.
 *
 * ⚠️ It is the ONLY entry point to the document scanner in this step — the result
 * screen's own Scan button was removed earlier and stays removed — so turning this
 * back off means the certificate can only be signed on the device.
 *
 * Kept as a flag rather than inlined: the whole scan path — `onPaperFallback` here,
 * `startScan` and the page grid in `CoCStep` — hangs off it, so switching the button
 * off (or on again) is this one boolean.
 */
const SHOW_PAPER_FALLBACK = true;

const two = (n: number) => n.toString().padStart(2, '0');

/**
 * Hand-rolled rather than `toLocaleDateString`, for the reason
 * `utils/inspection-photos.ts` records: it cannot be relied on unless Intl data is
 * compiled into the JS engine.
 */
const todayMMDDYYYY = () => {
  const d = new Date();
  return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}`;
};

export function CoCFormModal({
  visible,
  job,
  onClose,
  onSubmit,
  onPaperFallback,
  onSignatureCaptured,
  initial,
  submitting,
}: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  // Every interaction on this form is logged from HERE — the step only sees the
  // submitted certificate, so it cannot report what was ticked, cleared or abandoned.
  const log = useInstallerActivityLog();

  /**
   * Job # and Date are READ-ONLY, and derived rather than entered.
   *
   * The job number is the record's, shown as filed or as `N/A` when the endpoint sent
   * none — a crew standing at the house cannot know it, and a typo here files the
   * certificate against the wrong job. The date is TODAY, because today is when it is
   * being signed; re-signing an existing certificate re-dates it, which is the honest
   * record of when the signatures were taken.
   */
  const jobNumber = job.jobNumber || job.leadDisplayId || job.leadId || 'N/A';
  const signedDate = todayMMDDYYYY();

  const [formData, setFormData] = useState({
    relationshipOther: initial?.customer?.otherRelationship ?? '',
  });

  const [attest, setAttest] = useState({
    adult: !!initial?.confirmations?.is18OrOlder,
    authorized: !!initial?.confirmations?.isHomeownerOrAuthorized,
    completed: !!initial?.confirmations?.installationCompletedAsPerContract,
  });

  /**
   * Deliberately UNSET until the signer picks one.
   *
   * The paper form has two boxes and neither is pre-ticked. Defaulting to "Homeowner"
   * would put an attestation about who is signing into the record without anyone having
   * made it — the one thing on this certificate that must be an active choice.
   */
  const [relationship, setRelationship] = useState<CoCRelationship | null>(
    initial?.customer?.relationshipType ?? null
  );

  // Cancel / header-✕ raise a confirmation rather than dismissing, so a half-signed
  // certificate can't be lost to a stray tap. Sales does the same, for the same reason.
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // ── Signature state (ported from the sales form, one pad serving two slots) ──
  const [signatures, setSignatures] = useState<Record<SignatureSlot, string[]>>({
    installer: initial?.installerSignaturePaths ?? [],
    customer: initial?.customerSignaturePaths ?? [],
  });

  /**
   * The filed signature images, for the slots this device has no strokes for.
   *
   * A slot counts as SIGNED when it has either — otherwise reopening a filed
   * certificate would demand two fresh signatures to change a tick box.
   */
  const filedSignature: Record<SignatureSlot, string | undefined> = {
    installer: initial?.installerSignatureUrl,
    customer: initial?.customerSignatureUrl,
  };
  const hasSignature = (slot: SignatureSlot) =>
    signatures[slot].length > 0 || !!filedSignature[slot];
  const [sigSlot, setSigSlot] = useState<SignatureSlot | null>(null);
  const [livePaths, setLivePaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const currentPathRef = React.useRef('');
  const [padLayout, setPadLayout] = useState({
    width: Dimensions.get('window').width - 64,
    height: 260,
  });

  /**
   * Off-screen rasterisation surfaces, one per signature.
   *
   * ⚠️ They are positioned off-screen rather than hidden: `react-native-view-shot`
   * draws a real, laid-out view, so `display: none`, zero size or `opacity: 0` all
   * capture nothing. They are also a FIXED size, independent of the preview box the
   * installer sees — the uploaded image must not change with the phone or with how
   * far the form happens to be scrolled.
   */
  const installerShot = React.useRef<View>(null);
  const customerShot = React.useRef<View>(null);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim the touch immediately, or the ScrollView underneath steals the stroke.
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

  const openSigPad = (slot: SignatureSlot) => {
    log.cocSignaturePadOpened(slot);
    setLivePaths([...signatures[slot]]);
    setCurrentPath('');
    setSigSlot(slot);
  };
  const closeSigPad = () => {
    if (sigSlot) log.cocSignaturePadCancelled(sigSlot);
    setSigSlot(null);
  };
  const saveSig = () => {
    if (sigSlot) {
      log.cocSignatureSaved({
        who: sigSlot,
        strokes: livePaths.length,
        // A line that already carried a signature — drawn again, or an earlier one
        // being replaced on a certificate that was already filed.
        replaced: signatures[sigSlot].length > 0 || !!filedSignature[sigSlot],
      });
      setSignatures((prev) => ({ ...prev, [sigSlot]: [...livePaths] }));
    }
    setSigSlot(null);
  };
  const clearSig = () => {
    if (sigSlot) log.cocSignatureCleared(sigSlot);
    setLivePaths([]);
    setCurrentPath('');
    currentPathRef.current = '';
  };


  /** Ticking or un-ticking one attestation — logged either way, by its payload key. */
  const toggleAttest = (
    field: keyof typeof attest,
    confirmation: 'is18OrOlder' | 'isHomeownerOrAuthorized' | 'installationCompletedAsPerContract'
  ) => {
    const checked = !attest[field];
    log.cocConfirmationToggled({ confirmation, checked });
    setAttest((prev) => ({ ...prev, [field]: checked }));
  };

  /** Tapping the ticked box clears the answer — that is a state, and it is logged. */
  const selectRelationship = (value: CoCRelationship) => {
    const next = relationship === value ? null : value;
    log.cocRelationshipSelected({
      relationship: next,
      otherRelationship: next === 'other' ? formData.relationshipOther || undefined : undefined,
    });
    setRelationship(next);
  };

  /** Cancel and the header ✕ both land here, and are told apart in the log. */
  const dismiss = (via: 'cancel' | 'close') => {
    log.cocFormDismissed({ via, signed: !!initial });
    setShowExitConfirm(true);
  };

  /**
   * Any ticked box answers the question, so Submit unlocks on the tick.
   *
   * Only `other` needs more: it is the write-in line, and an unfilled one names
   * nobody. `spouse` is a first-class enum value (not an `other` write-in), so it
   * stands on its own exactly as `homeowner` does.
   */
  const relationshipNamed =
    relationship === 'homeowner' ||
    relationship === 'spouse' ||
    (relationship === 'other' && formData.relationshipOther.trim().length > 0);

  const canSubmit =
    attest.adult &&
    attest.authorized &&
    attest.completed &&
    !!jobNumber.trim() &&
    hasSignature('installer') &&
    hasSignature('customer') &&
    relationshipNamed &&
    !submitting;

  /**
   * One signature as a JPEG on disk.
   *
   * Returns `''` rather than throwing: the certificate is signed either way, and
   * losing the submit over a failed raster would be worse than losing the image.
   */
  const rasterise = async (ref: React.RefObject<View | null>): Promise<string> => {
    try {
      const uri = await captureRef(ref, { format: 'jpg', quality: 0.9, result: 'tmpfile' });
      // Android hands back a bare path; the upload's multipart needs a scheme.
      return uri.startsWith('file://') || uri.startsWith('content://') ? uri : `file://${uri}`;
    } catch (err) {
      console.warn('[CoCForm] Could not rasterise a signature:', err);
      return '';
    }
  };

  /**
   * Rasterise-and-hand-off, run whenever a slot's paths change.
   *
   * WARNING: it has to be an EFFECT, not part of `saveSig`. The off-screen surface
   * only holds the new strokes after the render that `setSignatures` triggers, so
   * capturing inside the handler would photograph the PREVIOUS signature — and
   * nothing at all for the first one. The extra frame is for Android, where the
   * native view is attached a beat after the commit.
   */
  const capturedKey = React.useRef<Record<SignatureSlot, string>>({
    installer: '',
    customer: '',
  });

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      (['installer', 'customer'] as const).forEach(async (slot) => {
        const key = signatures[slot].join('|');
        if (!key || capturedKey.current[slot] === key) return;
        capturedKey.current[slot] = key;
        const uri = await rasterise(slot === 'installer' ? installerShot : customerShot);
        if (uri) onSignatureCaptured?.(uri, slot);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [signatures, onSignatureCaptured]);

  const handleSubmit = () => {
    if (!canSubmit || !relationship) return;

    onSubmit({
      jobNumber,
      date: signedDate,
      isAdult: attest.adult,
      isAuthorizedSigner: attest.authorized,
      installedPerContract: attest.completed,
      relationship,
      relationshipOther: relationship === 'other' ? formData.relationshipOther.trim() : '',
      installerSignaturePaths: signatures.installer,
      customerSignaturePaths: signatures.customer,
      signatureSize: padLayout,
      signedAt: new Date().toISOString(),
    });
  };

  /**
   * The sales form's field: a floating label notched into the border, value inside.
   *
   * A read-only field renders grey (`#919EAB`) rather than looking disabled — it is
   * context the signer confirms, not something anyone fills in. Same treatment the
   * sales consent form gives its own read-only rows.
   */
  const renderField = (
    label: string,
    value: string,
    onChangeText?: (text: string) => void,
    icon?: string
  ) => (
    <View style={styles.fieldWrap}>
      <View style={styles.floatingLabel}>
        <Text style={styles.floatingLabelText}>{label}</Text>
      </View>
      <View style={styles.fieldBox}>
        <TextInput
          value={value}
          editable={!!onChangeText}
          onChangeText={onChangeText}
          style={[styles.fieldInput, { color: onChangeText ? '#1C252E' : '#919EAB' }]}
          placeholder={label}
          placeholderTextColor="#C4CDD5"
        />
        {!!icon && <Icon name={icon} size={20} color="#919EAB" />}
      </View>
    </View>
  );

  /**
   * The certificate's tick boxes — square, filled green, exactly as sales draws them.
   *
   * ⚠️ `inline` is for the relationship row, whose three one-word answers sit side
   * by side. It drops the row margin and, crucially, the label's `flex-1` — in a
   * horizontal parent that would make each box claim an equal third and spread the
   * ticks across the width instead of keeping each label against its own box.
   */
  const renderCheck = (
    checked: boolean,
    label: string,
    onToggle: () => void,
    inline = false
  ) => (
    <TouchableOpacity
      className={`flex-row items-center ${inline ? 'mr-5 mb-2' : 'mb-3'}`}
      activeOpacity={0.8}
      onPress={onToggle}
    >
      <View
        className="w-6 h-6 rounded-md border-2 items-center justify-center mr-2"
        style={{
          borderColor: checked ? '#72BD00' : '#637381',
          backgroundColor: checked ? '#72BD00' : 'transparent',
        }}
      >
        {checked && <MaterialIcon name="check" size={14} color="white" />}
      </View>
      <Text className={`text-[#1C252E] text-sm leading-6 ${inline ? '' : 'flex-1'}`}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  /**
   * A signature line from the paper form: the label, then the drawn signature or the
   * prompt. Tapping opens the pad as an in-card overlay, NOT a nested Modal — stacked
   * native modals are unreliable on both platforms, which is why the sales form does it
   * this way too.
   */
  const renderSignature = (slot: SignatureSlot, label: string) => {
    const paths = signatures[slot];
    // Strokes win: they are what THIS session drew. The filed image is the fallback
    // for a certificate signed elsewhere, and it is replaced the moment the box is
    // signed again.
    const filed = paths.length === 0 ? filedSignature[slot] : undefined;
    return (
      <View className="mb-6">
        <Text className="text-[#000000] font-semibold text-xs mb-3">{label}</Text>
        {/* WARNING: the box's height is a plain style and the ink layer is ABSOLUTE.
            It was an `h-36` class with a `flex-1` child, and the moment a signature
            existed that child collapsed the box to its dashed top border — the
            signature saved with nothing on screen to show for it. A signed and an
            unsigned box must be the same size, so nothing inside may size it. */}
        <TouchableOpacity
          onPress={() => openSigPad(slot)}
          activeOpacity={0.8}
          className="w-full rounded-2xl border-2 border-dashed items-center justify-center overflow-hidden"
          style={[styles.sigPreview, { borderColor: '#919EAB52' }]}
        >
          {filed ? (
            <View style={[StyleSheet.absoluteFill, styles.sigPreviewInk]}>
              <Image
                source={{ uri: filed }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
              />
            </View>
          ) : paths.length === 0 ? (
            <View className="items-center">
              <Icon name="fountain-pen-tip" size={32} color="#919EAB" style={{ opacity: 0.3 }} />
              <Text className="text-[#4D4D4D] text-xs mt-2">{t('installer.cocSignatureDraw')}</Text>
            </View>
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.sigPreviewInk]}>
              <Svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${padLayout.width} ${padLayout.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {paths.map((d, i) => (
                  <Path
                    key={i}
                    d={d}
                    stroke="black"
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
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View className="flex-1 justify-center px-4">
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType="dark"
          blurAmount={12}
          reducedTransparencyFallbackColor="rgba(0,0,0,0.8)"
          pointerEvents="none"
        />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]}
          pointerEvents="none"
        />

        {/* ⚠️ TWO layers of keyboard handling, and both are needed.

            The card is a fixed 80% of the screen and vertically centred, so the keyboard
            covers its lower half — scrolling ALONE cannot help, because "above the
            keyboard" is outside the card. `KeyboardAvoidingView` shrinks the card to the
            space that is left; `KeyboardAwareScrollView` then brings the focused field
            into that space. The write-in relationship field is the last thing on the
            form and was completely buried without this.

            Both come from `react-native-keyboard-controller` rather than React Native's
            own: `KeyboardProvider` (mounted in App.tsx) puts the app EDGE-TO-EDGE, after
            which Android stops resizing the window and RN's KeyboardAvoidingView has
            nothing to react to. The controller reads the keyboard height directly, and
            its context crosses the Modal boundary the same way `useSafeAreaInsets` does. */}
        <KeyboardAvoidingView behavior="padding" style={styles.cardHost}>
          <View className="rounded-2xl overflow-hidden shadow-2xl h-4/5">
          {/* Header */}
          <View
            className="flex-row items-center justify-between p-4"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Text className="text-white text-sm font-semibold">{t('installer.cocFormTitle')}</Text>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              {SHOW_PAPER_FALLBACK && (
                <TouchableOpacity
                  onPress={() => {
                    log.cocPaperFallback();
                    onPaperFallback();
                  }}
                  className="bg-white rounded-md px-2 py-0.5"
                >
                  <Text className="text-[#1C252E] text-sm">
                    {t('installer.cocPaperFallback')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => dismiss('close')}>
                <Icon name="close" size={22} color="white" />
              </TouchableOpacity>
            </View>
          </View>

          <KeyboardAwareScrollView
            className="px-4 py-6 bg-white"
            showsVerticalScrollIndicator={false}
            scrollEnabled={!sigSlot}
            keyboardShouldPersistTaps="handled"
            bottomOffset={24}
          >
            {/*
              The page's description line, sitting directly above the Job # box.

              It was a grey callout card, which read as an aside to be skimmed past. It
              is the instruction the whole certificate rests on — walk the job with the
              customer BEFORE signing — so it is plain text at the head of the form, in
              the reading position, not boxed off to one side of it.
            */}
            <View className="mb-6">
              <Text className="font-semibold text-sm mb-1" style={{ color: '#1C252E' }}>
                {t('installer.cocFormDisclaimerTitle')}
              </Text>
              <Text className="text-xs leading-5" style={{ color: '#637381' }}>
                {t('installer.cocFormDisclaimerBody')}
              </Text>
            </View>

            {/*
              Order is the SIGNING order the certificate is read in, not the paper
              form's two-up layout: identify the job, date it, say who is signing,
              make the three attestations, then the customer signs and the installer
              counter-signs last. Requested by the field team.
            */}

            {/* Job # */}
            {renderField(t('installer.cocFieldJobNumber'), jobNumber)}

            {/* Date */}
            {renderField(t('installer.cocFieldDate'), signedDate, undefined, 'calendar-range')}

            {/* Relationship to homeowner */}
            <View className="mb-6">
              <Text className="text-[#000000] font-semibold text-xs mb-3">
                {t('installer.cocRelationshipLabel')}
              </Text>
              {/*
                One row, and it WRAPS: the three labels are short enough to sit side by
                side, but a longer translation must fall to a second line rather than
                push a tick box off the card.
              */}
              <View className="flex-row flex-wrap items-center">
                {renderCheck(
                  relationship === 'homeowner',
                  t('installer.cocRelationshipHomeowner'),
                  () => selectRelationship('homeowner'),
                  true
                )}
                {renderCheck(
                  relationship === 'spouse',
                  t('installer.cocRelationshipSpouse'),
                  () => selectRelationship('spouse'),
                  true
                )}
                {renderCheck(
                  relationship === 'other',
                  t('installer.cocRelationshipOther'),
                  () => selectRelationship('other'),
                  true
                )}
              </View>
              {/*
                The paper's write-in line, which only exists once "Other" is ticked.

                ⚠️ The wrapper's marginTop is REQUIRED, not cosmetic. `floatingLabel` is
                absolutely positioned at `top: -8`, so it is drawn OUTSIDE the field box
                and over whatever sits above it — here the tick row, which only carries
                8px of its own margin. Without the clearance the label lands on top of
                "Homeowner / Spouse / Other".

                ⚠️ And it gets its OWN label: reusing `cocRelationshipLabel` printed
                "Relationship to homeowner" a second time, directly under the section
                heading of the same name, so the field looked like a stray duplicate of
                the block it belongs to rather than the answer to it.
              */}
              {relationship === 'other' && (
                <View style={styles.otherFieldWrap}>
                  {renderField(
                    t('installer.cocRelationshipOtherSpecify'),
                    formData.relationshipOther,
                    (text) => setFormData((prev) => ({ ...prev, relationshipOther: text }))
                  )}
                </View>
              )}
            </View>

            {/* The three attestations — all required, as on paper. */}
            <View className="mb-6">
              {renderCheck(attest.adult, t('installer.cocAttestAdult'), () =>
                toggleAttest('adult', 'is18OrOlder')
              )}
              {renderCheck(attest.authorized, t('installer.cocAttestAuthorized'), () =>
                toggleAttest('authorized', 'isHomeownerOrAuthorized')
              )}
              {renderCheck(attest.completed, t('installer.cocAttestCompleted'), () =>
                toggleAttest('completed', 'installationCompletedAsPerContract')
              )}
            </View>

            {/* Customer's Signature */}
            {renderSignature('customer', t('installer.cocCustomerSignature'))}

            {/* Installer's Signature */}
            {renderSignature('installer', t('installer.cocInstallerSignature'))}

            {/* Footer */}
            <View className="flex-row justify-end pb-12" style={{ gap: 12 }}>
              <TouchableOpacity
                onPress={() => dismiss('cancel')}
                className="px-3 py-1.5 rounded-lg border"
                style={{ borderColor: '#919EAB52' }}
              >
                <Text className="text-[#1C252E] font-semibold text-sm">{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!canSubmit}
                className="px-3 py-1.5 rounded-lg"
                style={{
                  backgroundColor: canSubmit ? colors.primary.main : '#919EAB33',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? (
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text className="font-semibold text-sm" style={{ color: '#FFFFFF' }}>
                      {t('installer.cocSubmitting')}
                    </Text>
                  </View>
                ) : (
                  <Text
                    className="font-semibold text-sm"
                    style={{ color: canSubmit ? '#FFFFFF' : '#919EABCC' }}
                  >
                    {t('installer.cocSubmit')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
          </View>
        </KeyboardAvoidingView>

        {/* ── Signature pad overlay (same Modal — see `renderSignature`) ── */}
        {!!sigSlot && (
          <View style={styles.sigOverlay}>
            <View style={styles.sigCard}>
              <View style={[styles.sigHeader, { backgroundColor: colors.primary.main }]}>
                <View>
                  {/* Names WHOSE signature is being taken — one pad serves both lines,
                      and signing on the wrong one is otherwise invisible. */}
                  <Text style={styles.sigHeaderTitle}>
                    {sigSlot === 'installer'
                      ? t('installer.cocInstallerSignature')
                      : t('installer.cocCustomerSignature')}
                  </Text>
                  <Text style={styles.sigHeaderSub}>{t('installer.cocSignatureHint')}</Text>
                </View>
                <TouchableOpacity onPress={closeSigPad}>
                  <Icon name="close" size={20} color="white" />
                </TouchableOpacity>
              </View>

              <View style={styles.sigPadWrap}>
                <View
                  style={styles.sigPad}
                  {...panResponder.panHandlers}
                  onStartShouldSetResponder={() => true}
                  onLayout={(e) =>
                    setPadLayout({
                      width: e.nativeEvent.layout.width,
                      height: e.nativeEvent.layout.height,
                    })
                  }
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

              <View style={styles.sigActions}>
                <TouchableOpacity onPress={clearSig} style={styles.clearBtn}>
                  <Icon name="eraser" size={16} color="#FF5630" style={{ marginRight: 6 }} />
                  <Text style={styles.clearBtnText}>{t('installer.cocSignatureClear')}</Text>
                </TouchableOpacity>
                <View style={styles.sigRightBtns}>
                  <TouchableOpacity onPress={closeSigPad} style={styles.sigCancelBtn}>
                    <Text style={styles.sigCancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={saveSig}
                    style={[
                      styles.sigSaveBtn,
                      { backgroundColor: livePaths.length > 0 ? colors.primary.main : '#919EAB33' },
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
                      {t('installer.cocSignatureSave')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Rasterisation surfaces ──
            Off-screen but real: see the refs above for why they cannot be hidden.
            White ground, because the upload is a JPEG and has no alpha to fall back
            on — on a transparent capture the ink would land on black. */}
        <View style={styles.captureHost} pointerEvents="none">
          {(['installer', 'customer'] as const).map((slot) => (
            <View
              key={slot}
              ref={slot === 'installer' ? installerShot : customerShot}
              collapsable={false}
              style={styles.captureCanvas}
            >
              <Svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${padLayout.width} ${padLayout.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {signatures[slot].map((d, i) => (
                  <Path
                    key={i}
                    d={d}
                    stroke="#1C252E"
                    strokeWidth={3}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </Svg>
            </View>
          ))}
        </View>

        {/* ── Exit confirmation ── */}
        {showExitConfirm && (
          <View style={styles.exitOverlay}>
            <BlurView
              style={StyleSheet.absoluteFill}
              blurType={isDark ? 'dark' : 'light'}
              blurAmount={10}
              reducedTransparencyFallbackColor={
                isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'
              }
              pointerEvents="none"
            />
            <View style={styles.exitScrim} pointerEvents="none" />
            <View style={styles.exitCard}>
              <View style={styles.exitIconCircle}>
                <Icon name="alert-outline" size={24} color="#D97706" />
              </View>
              <Text style={styles.exitTitle}>{t('installer.cocExitTitle')}</Text>
              <Text style={styles.exitBody}>{t('installer.cocExitBody')}</Text>
              <View style={styles.exitBtnRow}>
                <TouchableOpacity
                  onPress={() => setShowExitConfirm(false)}
                  style={styles.exitStayBtn}
                >
                  <Text style={styles.exitStayText}>{t('installer.cocExitStay')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setShowExitConfirm(false);
                    onClose();
                  }}
                  style={styles.exitLeaveBtn}
                >
                  <Text style={styles.exitLeaveText}>{t('installer.cocExitLeave')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /**
   * ⚠️ `elevation` is NOT decoration here, and neither overlay works without it.
   *
   * The form card carries `shadow-2xl`, which NativeWind turns into a real Android
   * ELEVATION — and on Android elevation decides sibling draw order outright, so a
   * plain `zIndex` on a later sibling loses to it and the overlay renders BEHIND the
   * form. Both overlays therefore sit above the card on both axes: zIndex for iOS,
   * elevation for Android. Keep them above the card's, and the exit prompt above the
   * signature pad.
   */
  sigOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
    zIndex: 999,
    elevation: 40,
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
  fieldWrap: { marginBottom: 20, position: 'relative' },
  /** Clearance for the absolutely-positioned floating label — see the call site. */
  otherFieldWrap: { marginTop: 12 },
  floatingLabel: {
    position: 'absolute',
    top: -8,
    left: 14,
    zIndex: 10,
    paddingHorizontal: 4,
    backgroundColor: 'white',
  },
  floatingLabelText: { fontSize: 11, fontWeight: '600', color: '#000000' },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#919EAB33',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldInput: { flex: 1, fontSize: 12, padding: 0, color: '#1C252E' },
  // Off-screen, NOT hidden — `react-native-view-shot` draws a laid-out view.
  cardHost: { flex: 1, justifyContent: 'center' },
  sigPreview: { height: 144 },
  sigPreviewInk: { backgroundColor: '#F8FAFC' },
  captureHost: { position: 'absolute', left: -10000, top: 0 },
  captureCanvas: { width: 600, height: 260, backgroundColor: '#FFFFFF' },
  exitOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    zIndex: 1002,
    elevation: 50,
  },
  exitScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  exitCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  exitIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  exitTitle: { fontSize: 17, fontWeight: '900', color: '#1C252E', textAlign: 'center' },
  exitBody: { fontSize: 13, color: '#637381', textAlign: 'center', marginTop: 8, lineHeight: 19 },
  exitBtnRow: { flexDirection: 'row', gap: 12, marginTop: 22, alignSelf: 'stretch' },
  exitStayBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  exitStayText: { fontSize: 14, fontWeight: '900', color: '#334155' },
  exitLeaveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    alignItems: 'center',
  },
  exitLeaveText: { fontSize: 14, fontWeight: '900', color: '#fff' },
});
