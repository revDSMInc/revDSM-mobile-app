import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';
import { BLOCK_RENDERERS } from './blocks';
import { AgreementSignatureCapture } from './AgreementSignatureCapture';
import { logEvent } from '../../../../services/api/LoggerService';
import { useCompanyLogoBase64 } from '../../../../hooks/useCompanyLogoBase64';

// Fixed layout width so the rasterized agreement looks like a document regardless
// of device width (mirrors web html2canvas CAPTURE_WIDTH = 850). The document is
// laid out at this width and then scaled DOWN to fit the screen (zoom-to-fit) while
// still being captured at full resolution — view-shot renders the ref'd view's own
// layer at its intrinsic width bounds, so the ancestor scale doesn't reduce quality.
const CAPTURE_WIDTH = 850;
// Rough first-paint height guess (corrected by onLayout) to avoid a 0-height flash.
const INITIAL_DOC_HEIGHT = CAPTURE_WIDTH * 1.3;

export interface DynamicAgreementGeneratorProps {
  agreementConfig: any;
  customerDetails?: any;
  jobDetails?: any;
  paymentDetails?: any;
  jobScope?: string[];
  contractorName?: string;
  onSave?: (file: any) => void;
  leadId?: string;
  // Logged-in rep — used for audit logging (agreement_generated / signature_signed)
  // and as a contractorName fallback (web reads this from AuthContext in the generator).
  user?: any;
}

// Imperative handle so a parent (e.g. the dialog's "Generate & Sign" flow) can
// trigger the same capture as the in-generator "Save Agreement" button.
export interface DynamicAgreementGeneratorHandle {
  generateImage: () => void;
}

/**
 * RN port of web `dynamic-agreement-generator.js`. Renders the agreement from the
 * config content-blocks and rasterizes it to a JPEG data-URI with
 * react-native-view-shot (html2canvas has no RN equivalent). The resulting file is
 * appended to jobState.agreements by the caller.
 *
 * REQUIRES react-native-view-shot (native module, not yet installed — see
 * package.json note). Until it's installed and the app rebuilt this cannot run.
 */
export const DynamicAgreementGenerator = forwardRef<
  DynamicAgreementGeneratorHandle,
  DynamicAgreementGeneratorProps
>(function DynamicAgreementGenerator(
  {
    agreementConfig,
    customerDetails = {},
    jobDetails = {},
    paymentDetails = {},
    jobScope = [],
    contractorName = '',
    onSave,
    leadId,
    user,
  }: DynamicAgreementGeneratorProps,
  ref
) {
  const containerRef = useRef<View>(null);
  const [signatureUri, setSignatureUri] = useState<string | null>(null);
  const [initialsUri, setInitialsUri] = useState<string | null>(null);
  const [padTarget, setPadTarget] = useState<null | 'signature' | 'initials'>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const formattedDate = formatToday();
  // Secure company logo (base64) — fetched from the auth user's companyLogo/profilePicture.
  const { logo: secureLogo, loading: logoLoading } = useCompanyLogoBase64();

  const header = agreementConfig?.header || {};
  const styles2 = agreementConfig?.styles || {};
  const contentBlocks = (agreementConfig?.contentBlocks || [])
    .filter((b: any) => b.enabled !== false)
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

  const handleSave = async () => {
    if (!containerRef.current) return;
    setIsProcessing(true);
    try {
      const dataUri = await captureRef(containerRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'data-uri',
        width: CAPTURE_WIDTH,
      });
      const filename = `Agreement_${jobDetails.jobNumber || 'NA'}_${Date.now()}.jpg`;
      const file = {
        name: filename,
        file: dataUri, // 'data:image/jpeg;base64,...' — upload payload shape
        uri: dataUri,
        contentType: 'image/jpeg',
        documentType: 'agreement' as const,
        type: 'agreement' as const,
        isNew: true,
        isSystemGenerated: true,
      };
      onSave?.(file);
      // Audit log (web parity: dynamic-agreement-generator.js logs agreement_generated).
      if (user?._id) {
        logEvent('add', {
          user_id: user._id,
          created_by: user._id,
          module_type: 'agreement',
          meta: {
            leadId,
            fieldName: 'agreement',
            fieldLabel: 'Agreement',
            action: 'agreement_generated',
          },
        });
      }
    } catch (error) {
      console.warn('[DynamicAgreementGenerator] capture failed', error);
      // User-facing error (web parity: enqueueSnackbar 'Failed to generate agreement').
      Alert.alert('Error', 'Failed to generate agreement. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Expose generateImage() so a parent can trigger capture programmatically.
  useImperativeHandle(ref, () => ({ generateImage: handleSave }));

  const blockProps = {
    customerDetails,
    jobDetails,
    paymentDetails,
    jobScope,
    contractorName,
    formattedDate,
    signatureUri,
    initialsUri,
    onRequestSignature: () => setPadTarget('signature'),
    onRequestInitials: () => setPadTarget('initials'),
    leadId,
    user,
    logEvent,
  };

  const canSave = Boolean(signatureUri && initialsUri) && !isProcessing;

  // Zoom-to-fit: lay the document out at CAPTURE_WIDTH, then scale it down (fitScale)
  // to the available screen width so the whole agreement is visible. On top of that
  // fit, the user can pinch-to-zoom and pan around (interactive, view-only — does not
  // affect the captured image, which is rendered from the ref'd view's 800px bounds).
  const { width: screenWidth } = useWindowDimensions();
  const [docHeight, setDocHeight] = useState(INITIAL_DOC_HEIGHT);
  const availableWidth = Math.max(240, screenWidth - 32); // 16px page padding each side
  const fitScale = Math.min(1, availableWidth / CAPTURE_WIDTH);
  const fitHeight = docHeight * fitScale;

  // --- interactive pinch-zoom + pan over the fit-scaled document ---------------
  const zoom = useSharedValue(1);
  const zoomStart = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const txStart = useSharedValue(0);
  const tyStart = useSharedValue(0);
  // Viewport + content dims (as shared values so gesture worklets read live values).
  const vpW = useSharedValue(0);
  const vpH = useSharedValue(0);
  const contentW = useSharedValue(availableWidth);
  const contentH = useSharedValue(fitHeight);

  useEffect(() => {
    contentW.value = availableWidth;
    contentH.value = fitHeight;
  }, [availableWidth, fitHeight, contentW, contentH]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      zoom.value = Math.min(4, Math.max(1, zoomStart.value * e.scale));
    })
    .onEnd(() => {
      zoomStart.value = zoom.value;
      // Re-clamp the (centered) content within the viewport after a zoom change.
      const maxX = Math.max(0, (contentW.value * zoom.value - vpW.value) / 2);
      const maxY = Math.max(0, (contentH.value * zoom.value - vpH.value) / 2);
      tx.value = Math.min(maxX, Math.max(-maxX, tx.value));
      ty.value = Math.min(maxY, Math.max(-maxY, ty.value));
      txStart.value = tx.value;
      tyStart.value = ty.value;
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = txStart.value + e.translationX;
      ty.value = tyStart.value + e.translationY;
    })
    .onEnd(() => {
      // Keep the (centered) content within the viewport; allows panning a tall doc.
      const maxX = Math.max(0, (contentW.value * zoom.value - vpW.value) / 2);
      const maxY = Math.max(0, (contentH.value * zoom.value - vpH.value) / 2);
      tx.value = Math.min(maxX, Math.max(-maxX, tx.value));
      ty.value = Math.min(maxY, Math.max(-maxY, ty.value));
      txStart.value = tx.value;
      tyStart.value = ty.value;
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: zoom.value }],
  }));

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1, overflow: 'hidden' }}
        onLayout={(e) => {
          vpW.value = e.nativeEvent.layout.width;
          vpH.value = e.nativeEvent.layout.height;
        }}
      >
        <GestureDetector gesture={composed}>
          <Animated.View style={[styles.viewport, zoomStyle]}>
            <View style={{ width: availableWidth, height: fitHeight, overflow: 'hidden' }}>
              <View
                ref={containerRef}
                collapsable={false}
                onLayout={(e) => {
                  const h = e.nativeEvent.layout.height;
                  if (h && Math.abs(h - docHeight) > 1) setDocHeight(h);
                }}
                style={[
                  styles.doc,
                  { width: CAPTURE_WIDTH, transform: [{ scale: fitScale }], transformOrigin: '0% 0%' },
                ]}
              >
            {/* HEADER */}
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.addresses}>{(header.addresses || []).join('\n')}</Text>
              </View>
              <View style={{ minWidth: 220, alignItems: 'flex-end' }}>
                <Text style={styles.companyName}>{header.companyName || 'Company Name'}</Text>
                {!!header.contactInfo?.mainPhone && (
                  <Text style={styles.contactLine}>Main: {header.contactInfo.mainPhone}</Text>
                )}
                {!!header.contactInfo?.customerService && (
                  <Text style={styles.contactLine}>Customer Service: {header.contactInfo.customerService}</Text>
                )}
                {!!header.contactInfo?.website && (
                  <Text style={[styles.contactLine, { fontWeight: '700' }]}>{header.contactInfo.website}</Text>
                )}
                {!!header.contactInfo?.licenseNumber && (
                  <Text style={styles.contactLine}>License # {header.contactInfo.licenseNumber}</Text>
                )}
              </View>
            </View>

            {/* LOGO — precedence mirrors web: header.customLogo (direct URL) >
                secure company logo (base64 from the auth user) > none. The wrapper
                keeps reserved height so the document layout is stable either way. */}
            <View style={styles.logoWrap}>
              {header.customLogo ? (
                <Image
                  source={{ uri: header.customLogo }}
                  style={{ width: 260, height: 90, resizeMode: 'contain' }}
                />
              ) : logoLoading ? (
                <ActivityIndicator size="small" color="#94A3B8" />
              ) : secureLogo ? (
                <Image
                  source={{ uri: secureLogo }}
                  style={{ width: 260, height: 90, resizeMode: 'contain' }}
                />
              ) : null}
            </View>

            {/* CONTENT BLOCKS */}
            <View style={{ padding: 20 }}>
              {contentBlocks.map((block: any) => {
                const Renderer = BLOCK_RENDERERS[block.type];
                if (!Renderer) return null;
                return <Renderer key={block.blockId || block._id} block={block} {...blockProps} />;
              })}
                </View>
              </View>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>

      {/* ACTIONS (outside the captured container) */}
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={() => {
            setSignatureUri(null);
            setInitialsUri(null);
          }}
          style={styles.clearBtn}
        >
          <Text style={styles.clearBtnText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave}
          style={[styles.saveBtn, { backgroundColor: canSave ? '#22C55E' : '#CBD5E1' }]}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
          ) : null}
          <Text style={styles.saveBtnText}>{isProcessing ? 'Processing...' : 'Save Agreement'}</Text>
        </TouchableOpacity>
      </View>

      <AgreementSignatureCapture
        visible={padTarget !== null}
        title={padTarget === 'initials' ? 'Draw Your Initials' : 'Draw Your Signature'}
        onClose={() => setPadTarget(null)}
        onCapture={(uri) => {
          const target = padTarget;
          if (target === 'initials') setInitialsUri(uri);
          else setSignatureUri(uri);
          // Audit log (web parity: signature-section-block / pricing-table-block log
          // on the SignaturePad's onChange). On mobile the pad lives in the generator,
          // so the log fires here — the point the signature/initials is actually made.
          if (uri && user?._id) {
            const isInitials = target === 'initials';
            logEvent('add', {
              user_id: user._id,
              created_by: user._id,
              module_type: 'agreement',
              meta: {
                leadId,
                fieldName: isInitials ? 'initials' : 'signature',
                fieldLabel: isInitials
                  ? 'Initials Signed to Charge Credit'
                  : 'Agreement Signed',
                action: isInitials ? 'initials_signed' : 'signature_signed',
              },
            });
          }
        }}
      />
    </View>
  );
});

function formatToday(): string {
  // Avoid date-fns import churn — format MM/dd/yyyy for the agreement date line.
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doc: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#000',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  addresses: { fontSize: 9, color: '#000' },
  companyName: { fontSize: 12, fontWeight: '700', color: '#000', marginBottom: 4 },
  contactLine: { fontSize: 9, color: '#000', lineHeight: 13 },
  logoWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16, minHeight: 110 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#fff',
  },
  clearBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FF5630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: { color: '#FF5630', fontWeight: '700', fontSize: 13 },
  saveBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
