import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  PanResponder,
  Platform,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Path } from 'react-native-svg';
import RNFS from 'react-native-fs';
import FileViewer from 'react-native-file-viewer';
import Pdf from 'react-native-pdf';
import { FlashMessage } from '../../../config/message';
import { LeadService } from '../../../services/api/leads';
import { AgreementRemoteSignModal } from './AgreementRemoteSignModal';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { footerBottomPadding } from '../../../utils/installer-insets';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

// Drawing-pad height. Single source of truth: the pad view, the on-screen preview
// viewBoxes, and the SVG written for upload must all share one coordinate space.
const PAD_HEIGHT = 300;

// The sign request uses `responseType: 'blob'`, so when the server rejects it the
// error body arrives as a Blob (application/json) — the axios interceptor rejects
// with `error.response.data` (that Blob). Logging it prints an opaque
// `{_data:{…,name:'sign.json'}}` with no message. These helpers READ the Blob so the
// real server reason is surfaced to the rep (and the console) instead.
const readBlobAsText = (blob: any): Promise<string> =>
  new Promise((resolve) => {
    try {
      if (!blob || (typeof blob.size !== 'number' && !blob._data)) return resolve('');
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsText(blob as Blob);
    } catch {
      resolve('');
    }
  });

// Pull the most useful human message out of a signing error, which may be a Blob
// (application/json body), the parsed `error.response.data`, or a plain Error.
const extractServerMessage = async (err: any): Promise<string> => {
  const isBlobLike = (v: any) => v && (v._data || typeof v.size === 'number');
  const candidate = isBlobLike(err)
    ? err
    : isBlobLike(err?.data)
      ? err.data
      : err?.response?.data;
  const text = await readBlobAsText(candidate);
  if (text) {
    try {
      const parsed = JSON.parse(text);
      return parsed?.message || parsed?.error || text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  }
  if (typeof err?.message === 'string' && err.message) return err.message;
  return '';
};

interface AgreementSignatureModalProps {
  visible: boolean;
  onClose: () => void;
  leadId: string;
  agreementId: string;
  previewBase64: string;
  onSuccess: (pdfUrl: string) => void;
  payload: any;
  signatureFields?: {
    buyerSignature?: any;
    buyerInitials?: any;
  };
  pdfDimensions?: {
    width: number;
    height: number;
  };
  /** Lead customer details (primary buyer + `coBuyers[]`) — enables "Send
   *  Remotely" so the homeowner (and each co-buyer) can e-sign on their own
   *  phone. When omitted, the remote button is hidden and only in-person
   *  signing is available. */
  customerDetails?: any;
  /** Fired when a remote session finishes (all signers signed) so the parent can
   *  refresh the outcome and close, same as an in-person `onSuccess`. */
  onRemoteComplete?: () => void;
  /** Fired when the rep SENDS the agreement for remote signature (now pending). The
   *  parent closes the whole stack and marks the summary "Pending Customer Signature". */
  onRemoteSent?: (agreementId?: string) => void;
  /**
   * How this modal presents itself. Defaults to `slide`, which is right when it is
   * opened straight from a screen (the legacy Job Builder summary).
   *
   * WARNING Pass `fade` when this is rendered INSIDE an already-open full-screen
   * modal, as `DynamicAgreementDialog` does. Two nested modals both sliding up reads
   * to the rep as the app opening two separate screens for one 'Generate' tap - they
   * watch a page slide up to show a spinner, then a second page slide up over it. A
   * cross-fade makes the document replace the spinner in place, so the whole thing
   * looks like the one screen it logically is.
   */
  animationType?: 'none' | 'slide' | 'fade';
}

/**
 * The footer row (Cancel / Submit), padded by the MODAL WINDOW's own bottom inset.
 *
 * ⚠️ Must be a child of the modal's inner `SafeAreaProvider`: the component that renders the
 * Modal reads the app ROOT's insets, where the bottom inset is 0 - but this window extends under
 * the Android nav bar, which then painted over the buttons ("still not centred"). The inner
 * provider measures the actual modal window. Same helper as the installer sub-flows.
 */
const ModalFooterBar: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const inner = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingHorizontal: 24,
        paddingTop: 16,
        // Android floor (32): if the window still reports no inset, a 3-button nav bar (~48dp) must
        // not be able to sit over the buttons. A correct inset (48 / gesture ~24) wins when larger.
        paddingBottom: footerBottomPadding(Math.max(inner.bottom, Platform.OS === 'android' ? 32 : 0)),
        borderTopWidth: 1,
        borderTopColor: '#f1f5f9',
        backgroundColor: 'white',
        flexDirection: 'row',
        gap: 12,
      }}
    >
      {children}
    </View>
  );
};

export const AgreementSignatureModal = ({
  visible,
  onClose,
  leadId,
  agreementId,
  previewBase64,
  onSuccess,
  payload,
  signatureFields,
  pdfDimensions,
  customerDetails,
  onRemoteComplete,
  onRemoteSent,
  animationType = 'slide',
}: AgreementSignatureModalProps) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const statusBarBg = isDark ? colors.background : '#0E2A1C';
  const [loading, setLoading] = useState(false);
  // Remote-signing (homeowner e-signs on their own phone). Only offered when the
  // caller supplies customer details to address the link(s) to.
  const [remoteOpen, setRemoteOpen] = useState(false);

  // Initials state
  const [initialsPaths, setInitialsPaths] = useState<string[]>([]);
  const [liveInitials, setLiveInitials] = useState<string[]>([]);
  const [currentInitialsPath, setCurrentInitialsPath] = useState('');
  const currentInitialsRef = useRef('');

  // Signature state
  const [signaturePaths, setSignaturePaths] = useState<string[]>([]);
  const [liveSignature, setLiveSignature] = useState<string[]>([]);
  const [currentSignaturePath, setCurrentSignaturePath] = useState('');
  const currentSignatureRef = useRef('');

  const [activePad, setActivePad] = useState<'initials' | 'signature' | null>(null);
  // The e-signature consent box on the capture pad. Reset every time a pad opens, so each
  // mark is an explicit agreement rather than one tick carried over from the last.
  const [agreedToESign, setAgreedToESign] = useState(false);
  useEffect(() => {
    setAgreedToESign(false);
  }, [activePad]);
  const [currentPage, setCurrentPage] = useState(1);
  const [containerLayout, setContainerLayout] = useState({ width: 0, height: 0 });
  const [padWidth, setPadWidth] = useState(0);

  // ---- Shared zoom/pan transform values ----
  // Both the Pdf view and the box overlays live inside the same Animated.View
  // below, driven by these values. Because they share one transform, zoom
  // and pan can never desync the boxes from the page — there's no position
  // recalculation happening on zoom at all.
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const MIN_SCALE = 1;
  const MAX_SCALE = 3;

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= MIN_SCALE) {
        scale.value = withTiming(MIN_SCALE);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = MIN_SCALE;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      // Only allow panning once zoomed in — mirrors typical PDF viewer feel
      // and avoids fighting the page-swipe-to-change-page gesture at scale 1.
      if (savedScale.value > MIN_SCALE) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const pdfTransformStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const fmt = (n: number) => n.toFixed(1);

  const createPanResponder = (
    currentRef: React.MutableRefObject<string>,
    setCurrent: (p: string) => void,
    setLive: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    // Last raw point of the in-progress stroke. Held in the responder's closure
    // (not state) so it is always current inside the move handler.
    let last: { x: number; y: number } | null = null;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        last = { x: locationX, y: locationY };
        const path = `M${fmt(locationX)},${fmt(locationY)}`;
        currentRef.current = path;
        setCurrent(path);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        if (!last) {
          last = { x: locationX, y: locationY };
          return;
        }
        const dx = locationX - last.x;
        const dy = locationY - last.y;
        // Drop sub-pixel jitter — without this the finger's micro-tremor emits a
        // curve per event and the stroke reads as fuzzy rather than clean.
        if (dx * dx + dy * dy < 1) return;

        // Smooth with the midpoint technique: the PREVIOUS raw point becomes the
        // quadratic control point and the midpoint between it and the current
        // point becomes the endpoint. Consecutive segments then share a tangent,
        // so the stroke curves continuously instead of showing a corner at every
        // sampled touch (the old `L` line-to produced a visible polyline).
        const mx = (last.x + locationX) / 2;
        const my = (last.y + locationY) / 2;
        const next = `${currentRef.current} Q${fmt(last.x)},${fmt(last.y)} ${fmt(mx)},${fmt(my)}`;
        last = { x: locationX, y: locationY };
        currentRef.current = next;
        setCurrent(next);
      },
      onPanResponderRelease: () => {
        // Close on the final raw point: the loop above always ends at a midpoint,
        // so the last half-segment would otherwise be clipped. For a tap with no
        // movement this is a zero-length line, which strokeLinecap="round" renders
        // as a dot (previously a bare `M` drew nothing at all).
        if (last && currentRef.current) {
          currentRef.current = `${currentRef.current} L${fmt(last.x)},${fmt(last.y)}`;
        }
        const finished = currentRef.current;
        if (finished) {
          setLive((prev) => [...prev, finished]);
        }
        last = null;
        currentRef.current = '';
        setCurrent('');
      },
      onPanResponderTerminationRequest: () => false,
    });
  };

  const initialsPanResponder = useMemo(
    () => createPanResponder(currentInitialsRef, setCurrentInitialsPath, setLiveInitials),
    []
  );

  const signaturePanResponder = useMemo(
    () => createPanResponder(currentSignatureRef, setCurrentSignaturePath, setLiveSignature),
    []
  );

  const clearPad = (type: 'initials' | 'signature') => {
    if (type === 'initials') {
      setLiveInitials([]);
      setCurrentInitialsPath('');
    } else {
      setLiveSignature([]);
      setCurrentSignaturePath('');
    }
  };

  // Save Mark needs BOTH: the consent ticked AND something actually drawn on the open pad.
  const padHasInk = activePad === 'initials' ? liveInitials.length > 0 : liveSignature.length > 0;
  const canSavePad = agreedToESign && padHasInk;

  const savePad = () => {
    // Belt and braces: the button is disabled until both are true, but the guard lives here so
    // no other caller can save an empty mark or one without the consent.
    if (!canSavePad) return;
    if (activePad === 'initials') {
      setInitialsPaths([...liveInitials]);
    } else if (activePad === 'signature') {
      setSignaturePaths([...liveSignature]);
    }
    setActivePad(null);
  };

  const convertToSvgFile = async (paths: string[], fileName: string) => {
    // The viewBox MUST match the pad's own coordinate space (padWidth × PAD_HEIGHT),
    // because the path data is in raw pad pixels. It was hardcoded to 500×200 while
    // the pad is 300 tall, so everything the customer drew below y=200 — typically
    // the lower third of a signature — was cropped out of the file sent to
    // `/agreement/{leadId}/sign`, even though the on-screen preview (which uses the
    // correct viewBox) looked complete.
    const w = padWidth || 500;
    const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
      <svg width="${w}" height="${PAD_HEIGHT}" viewBox="0 0 ${w} ${PAD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        ${paths
        .map(
          (p) =>
            `<path d="${p}" stroke="black" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />`
        )
        .join('')}
      </svg>`;

    const filePath = `${RNFS.CachesDirectoryPath}/${fileName}_${Date.now()}.svg`;
    await RNFS.writeFile(filePath, svgContent, 'utf8');

    return {
      uri: Platform.OS === 'android' ? `file://${filePath}` : filePath,
      name: `${fileName}.svg`,
      type: 'image/svg+xml',
    };
  };

  const handleSubmit = async () => {
    if (initialsPaths.length === 0 || signaturePaths.length === 0) {
      FlashMessage.error('Error', 'Please provide both initials and signature');
      return;
    }

    try {
      setLoading(true);

      const initialsFile = await convertToSvgFile(initialsPaths, 'initials');
      const signatureFile = await convertToSvgFile(signaturePaths, 'signature');

      const formData = new FormData();
      formData.append('agreementId', agreementId);
      formData.append('initials', initialsFile as any);
      formData.append('signature', signatureFile as any);

      const response = await LeadService.signAgreement(leadId, formData);
      const blob = response.data;

      if (!blob || blob.size === 0) {
        throw new Error('Received empty blob from server');
      }

      // The real success returns a PDF. A JSON body here means the server reported an
      // error with a 2xx status — read it and surface the message instead of writing
      // the JSON out as a bogus ".pdf".
      if (typeof blob.type === 'string' && blob.type.includes('json')) {
        const msg = await extractServerMessage(blob);
        throw new Error(msg || 'The server could not sign this agreement.');
      }

      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        try {
          const base64data = (reader.result as string).split(',')[1];
          const filePath = `${RNFS.DocumentDirectoryPath}/agreement_signed_${agreementId}.pdf`;
          await RNFS.writeFile(filePath, base64data, 'base64');

          FlashMessage.success(
            'Success',
            'Agreement signed successfully\nYour finalized document is complete and a copy has been sent to you'
          );

          onSuccess(filePath);
          onClose();
        } catch (fileError) {
          console.error('File saving failed:', fileError);
          FlashMessage.error('Error', 'Failed to save signed agreement');
        } finally {
          setLoading(false);
        }
      };

      reader.onerror = () => {
        console.error('FileReader error');
        FlashMessage.error('Error', 'Failed to process signed agreement data');
        setLoading(false);
      };
    } catch (error) {
      // Surface the ACTUAL server reason (read out of the error Blob) so a signing
      // failure is diagnosable instead of a blanket "Failed to sign agreement".
      const serverMsg = await extractServerMessage(error);
      console.error('Signing failed:', serverMsg || error);
      FlashMessage.error('Error', serverMsg || 'Failed to sign agreement');
      setLoading(false);
    }
  };

  const handleOpenFullPreview = async () => {
    try {
      const filePath = `${RNFS.CachesDirectoryPath}/agreement_preview_${agreementId}.pdf`;
      await RNFS.writeFile(filePath, previewBase64, 'base64');
      await FileViewer.open(filePath);
    } catch (error) {
      FlashMessage.error('Error', 'Failed to open full preview');
    }
  };

  return (
    <Modal visible={visible} animationType={animationType} transparent={false} statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor={statusBarBg} translucent />
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View style={{ flex: 1, backgroundColor: 'white' }}>
            {(Platform.OS === 'ios' || Platform.OS === 'android') && (
              <View style={{ height: insets.top, backgroundColor: statusBarBg }} />
            )}
            <View style={{ flex: 1, backgroundColor: 'white' }}>
              {/* Header */}
              <View style={{ paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
                {/* ⚠️ `flex: 1` + `minWidth: 0` + a right margin: without them the title kept its full
                    one-line width and ran UNDER the Send Remotely button. It now wraps instead. */}
                <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                  <Text numberOfLines={2} style={{ fontSize: 10, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.5 }}>
                    Digital Agreement
                  </Text>
                  <Text numberOfLines={2} style={{ fontSize: 14, fontWeight: '900', color: '#0f172a' }}>Sign to Finalize Order</Text>
                </View>
                <View style={{ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {/* Send Remotely — homeowner (and each co-buyer) e-signs on their
                      own phone. Hidden when the caller can't supply recipients. */}
                  {!!customerDetails && (
                    <TouchableOpacity
                      onPress={() => setRemoteOpen(true)}
                      disabled={loading}
                      style={{ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#ECFDF5', borderWidth: 1.5, borderColor: '#4CBB17' }}
                    >
                      <Icon name="send-outline" size={15} color="#059669" />
                      <Text numberOfLines={1} style={{ fontSize: 10.5, fontWeight: '900', color: '#059669', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                        Send Remotely
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={onClose}
                    style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Icon name="close" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Main Content Area — overflow:hidden keeps zoom transforms inside this box,
                  preventing the animated PDF from ever bleeding into the header or footer */}
              <View
                style={{ flex: 1, position: 'relative', backgroundColor: '#1e293b', overflow: 'hidden' }}
                onLayout={(e) => setContainerLayout(e.nativeEvent.layout)}
              >
                {previewBase64.startsWith('JVBERi') ? (
                  <GestureDetector gesture={composedGesture}>
                    {/*
                      This Animated.View is the single shared transform target.
                      The Pdf component and the box overlays are siblings inside
                      it, so pinch/pan moves both identically — there is no
                      separate scale-correction math needed for the boxes.
                    */}
                    <Animated.View style={[{ flex: 1 }, pdfTransformStyle]}>
                      <Pdf
                        source={{ uri: `data:application/pdf;base64,${previewBase64}` }}
                        style={{ flex: 1, backgroundColor: '#334155' }}
                        fitPolicy={2}
                        enablePaging={false}
                        horizontal={false}
                        scrollEnabled={false}
                        spacing={0}
                        minScale={1.0}
                        maxScale={1.0}
                        page={currentPage}
                        onPageChanged={(page) => {
                          setCurrentPage(page);
                        }}
                      />

                      {signatureFields &&
                        containerLayout.width > 0 &&
                        (() => {
                          const pdfWidth = pdfDimensions?.width ?? 794;
                          const pdfHeight = pdfDimensions?.height ?? 1028;
                          const PDF_ASPECT_RATIO = pdfWidth / pdfHeight;
                          const containerAR = containerLayout.width / containerLayout.height;

                          let renderedW, renderedH, offsetX, offsetY;
                          if (containerAR > PDF_ASPECT_RATIO) {
                            renderedH = containerLayout.height;
                            renderedW = renderedH * PDF_ASPECT_RATIO;
                            offsetX = (containerLayout.width - renderedW) / 2;
                            offsetY = 0;
                          } else {
                            renderedW = containerLayout.width;
                            renderedH = renderedW / PDF_ASPECT_RATIO;
                            offsetX = 0;
                            offsetY = (containerLayout.height - renderedH) / 2;
                          }

                          const initialsBoxH = (Number(signatureFields.buyerInitials?.heightPercent ?? 0) / 100) * renderedH;
                          const signatureBoxH = (Number(signatureFields.buyerSignature?.heightPercent ?? 0) / 100) * renderedH;

                          return (
                            <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
                              {/* Buyer Initials Box */}
                              {signatureFields.buyerInitials &&
                                currentPage === signatureFields.buyerInitials.page && (
                                  <TouchableOpacity
                                    onPress={() => {
                                      setLiveInitials([...initialsPaths]);
                                      setActivePad('initials');
                                    }}
                                    style={{
                                      position: 'absolute',
                                      left:
                                        offsetX +
                                        (Number(signatureFields.buyerInitials.xPercent) / 100) *
                                        renderedW,
                                      top:
                                        offsetY +
                                        (Number(signatureFields.buyerInitials.yPercent) / 100) *
                                        renderedH,
                                      width:
                                        (Number(signatureFields.buyerInitials.widthPercent) / 100) *
                                        renderedW,
                                      height: initialsBoxH,
                                      backgroundColor:
                                        initialsPaths.length > 0
                                          ? 'rgba(34, 197, 94, 0.15)'
                                          : 'rgba(239, 68, 68, 0.08)',
                                      borderWidth: 2,
                                      borderColor: initialsPaths.length > 0 ? '#22C55E' : '#94A3B8',
                                      borderStyle: initialsPaths.length > 0 ? 'solid' : 'dashed',
                                      borderRadius: 8,
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }}
                                  >
                                    {initialsPaths.length === 0 ? (
                                      <View style={{ alignItems: 'center' }}>
                                        {/* <Text style={{ fontSize: 7, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: -0.5 }}>
                                          Initial
                                        </Text>
                                        <Icon name="pencil-plus" size={12} color="#94A3B8" /> */}
                                      </View>
                                    ) : (
                                      <Svg
                                        width="100%"
                                        height="100%"
                                        viewBox={`0 0 ${padWidth || 500} ${PAD_HEIGHT}`}
                                      >
                                        {initialsPaths.map((p, i) => (
                                          <Path
                                            key={i}
                                            d={p}
                                            stroke="#1e293b"
                                            strokeWidth={4}
                                            fill="none"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          />
                                        ))}
                                      </Svg>
                                    )}
                                  </TouchableOpacity>
                                )}

                              {/* Buyer Signature Box */}
                              {signatureFields.buyerSignature &&
                                currentPage === signatureFields.buyerSignature.page && (
                                  <TouchableOpacity
                                    onPress={() => {
                                      setLiveSignature([...signaturePaths]);
                                      setActivePad('signature');
                                    }}
                                    style={{
                                      position: 'absolute',
                                      left:
                                        offsetX +
                                        (Number(signatureFields.buyerSignature.xPercent) / 100) *
                                        renderedW,
                                      top:
                                        offsetY +
                                        (Number(signatureFields.buyerSignature.yPercent) / 100) *
                                        renderedH,
                                      width:
                                        (Number(signatureFields.buyerSignature.widthPercent) / 100) *
                                        renderedW,
                                      height: signatureBoxH,
                                      backgroundColor:
                                        signaturePaths.length > 0
                                          ? 'rgba(34, 197, 94, 0.15)'
                                          : 'rgba(239, 68, 68, 0.08)',
                                      borderWidth: 2,
                                      borderColor: signaturePaths.length > 0 ? '#22C55E' : '#94A3B8',
                                      borderStyle: signaturePaths.length > 0 ? 'solid' : 'dashed',
                                      borderRadius: 8,
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }}
                                  >
                                    {signaturePaths.length === 0 ? (
                                      <View style={{ alignItems: 'center' }}>
                                        {/* <Text style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>
                                          Sign Here
                                        </Text>
                                        <Icon name="signature-freehand" size={16} color="#94A3B8" /> */}
                                      </View>
                                    ) : (
                                      <Svg
                                        width="100%"
                                        height="100%"
                                        viewBox={`0 0 ${padWidth || 500} ${PAD_HEIGHT}`}
                                      >
                                        {signaturePaths.map((p, i) => (
                                          <Path
                                            key={i}
                                            d={p}
                                            stroke="#1e293b"
                                            strokeWidth={4}
                                            fill="none"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          />
                                        ))}
                                      </Svg>
                                    )}
                                  </TouchableOpacity>
                                )}
                            </View>
                          );
                        })()}
                    </Animated.View>
                  </GestureDetector>
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
                    <Icon name="file-document-outline" size={48} color="#cbd5e1" />
                    <Text style={{ color: '#94a3b8', fontWeight: 'bold', marginTop: 16 }}>Document preview unavailable</Text>
                  </View>
                )}
              </View>


              {/* Compact Footer Actions */}
              <ModalFooterBar>
                <TouchableOpacity
                  onPress={onClose}
                  style={{ flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}
                >
                  <Text style={{ color: '#64748b', fontWeight: '900', textTransform: 'uppercase', letterSpacing: 2, fontSize: 11 }}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={loading || initialsPaths.length === 0 || signaturePaths.length === 0}
                  style={{
                    flex: 2,
                    height: 48,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: loading || initialsPaths.length === 0 || signaturePaths.length === 0 ? '#e2e8f0' : '#059669',
                    shadowColor: '#059669',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.1,
                    shadowRadius: 8,
                    elevation: 4
                  }}
                >
                  {loading ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text style={{ color: 'white', fontWeight: '900', textTransform: 'uppercase', letterSpacing: 2, fontSize: 11 }}>
                      Submit Agreement
                    </Text>
                  )}
                </TouchableOpacity>
              </ModalFooterBar>
            </View>

            {/* Signature Drawing Overlay — sits as sibling to the main content View, inside SafeAreaView */}
            {activePad && (
              <View style={[styles.overlay, { backgroundColor: 'rgba(0, 0, 0, 0.95)', alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
                <View style={{ backgroundColor: 'white', width: '100%', borderRadius: 40, overflow: 'hidden' }}>
                  <View style={{ padding: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
                    <View>
                      <Text style={{ fontWeight: '900', color: '#0f172a', textTransform: 'uppercase', fontSize: 12 }}>
                        {activePad === 'initials' ? 'Capture Initials' : 'Capture Signature'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setActivePad(null)}>
                      <Icon name="close" size={20} color="#64748b" />
                    </TouchableOpacity>
                  </View>

                  <View style={{ padding: 24 }}>
                    <View
                      style={{ height: PAD_HEIGHT, width: '100%', backgroundColor: '#f8fafc', borderWidth: 2, borderStyle: 'dashed', borderColor: '#e2e8f0', borderRadius: 24, overflow: 'hidden' }}
                      onLayout={(e) => setPadWidth(e.nativeEvent.layout.width)}
                      {...(activePad === 'initials'
                        ? initialsPanResponder.panHandlers
                        : signaturePanResponder.panHandlers)}
                    >
                      {/* pointerEvents="none" is REQUIRED, not cosmetic. Without it
                          the accumulating <Path> children become touch targets, and
                          `locationX/locationY` on a move event is reported relative
                          to whichever child was hit rather than the pad. Mid-stroke
                          the coordinates then jump to a different origin, which is
                          what produced the long straight lines shooting across the
                          pad. Making the Svg transparent to touches keeps every
                          event anchored to the pad view. */}
                      <Svg width="100%" height="100%" pointerEvents="none">
                        {(activePad === 'initials' ? liveInitials : liveSignature).map((p, i) => (
                          <Path
                            key={i}
                            d={p}
                            stroke="#1e293b"
                            strokeWidth={3}
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}
                        {(activePad === 'initials' ? currentInitialsPath : currentSignaturePath) !==
                          '' && (
                            <Path
                              d={activePad === 'initials' ? currentInitialsPath : currentSignaturePath}
                              stroke="#1e293b"
                              strokeWidth={3}
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                      </Svg>
                    </View>
                  </View>

                  {/* Consent sits ABOVE the buttons, and Save Mark stays disabled until it is ticked. */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setAgreedToESign((v) => !v)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: agreedToESign }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingTop: 4 }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: agreedToESign ? '#0f172a' : '#94a3b8',
                        backgroundColor: agreedToESign ? '#0f172a' : 'white',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 12,
                      }}
                    >
                      {agreedToESign && <Icon name="check" size={16} color="white" />}
                    </View>
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: '#0f172a' }}>
                      I agree to electronic signature
                    </Text>
                  </TouchableOpacity>

                  <View style={{ padding: 24, flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity
                      onPress={() => clearPad(activePad)}
                      style={{ flex: 1, height: 56, backgroundColor: '#f1f5f9', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={{ fontWeight: '900', color: '#475569', textTransform: 'uppercase', fontSize: 10 }}>Clear</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={savePad}
                      disabled={!canSavePad}
                      style={{ flex: 2, height: 56, backgroundColor: '#0f172a', borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: canSavePad ? 1 : 0.4 }}
                    >
                      <Text style={{ fontWeight: '900', color: 'white', textTransform: 'uppercase', fontSize: 10 }}>Save Mark</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

            {/* Remote signing — homeowner (and each co-buyer) e-signs on their own
                phone. Self-contained: recipients → send → pending/resend → done. */}
            {!!customerDetails && (
              <AgreementRemoteSignModal
                visible={remoteOpen}
                onClose={() => setRemoteOpen(false)}
                leadId={leadId}
                agreementId={agreementId}
                payload={payload}
                signatureFields={signatureFields}
                pdfDimensions={pdfDimensions}
                customerDetails={customerDetails}
                onComplete={() => {
                  // Close the nested remote sheet FIRST, then tear down the agreement
                  // modal/dialog on a later frame. Collapsing the stacked modals
                  // (dialog → sign modal → remote sheet) in a single frame orphans a
                  // modal backdrop and leaves a blank black screen — so sequence them.
                  setRemoteOpen(false);
                  setTimeout(() => {
                    onRemoteComplete?.();
                    onClose();
                  }, 450);
                }}
                onSent={(id) => {
                  // Agreement SENT for remote signature. Same staged teardown as
                  // onComplete, but the summary marks "Pending Customer Signature"
                  // (onRemoteSent) instead of reading a signed PDF that doesn't exist yet.
                  setRemoteOpen(false);
                  setTimeout(() => {
                    onRemoteSent?.(id);
                    onClose();
                  }, 450);
                }}
              />
            )}
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
  },
});