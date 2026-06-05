import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  PanResponder,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Path } from 'react-native-svg';
import RNFS from 'react-native-fs';
import FileViewer from 'react-native-file-viewer';
import Pdf from 'react-native-pdf';
import { FlashMessage } from '../../../config/message';
import { LeadService } from '../../../services/api/leads';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

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
}

export const AgreementSignatureModal = ({
  visible,
  onClose,
  leadId,
  agreementId,
  previewBase64,
  onSuccess,
  payload,
  signatureFields,
}: AgreementSignatureModalProps) => {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(false);

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
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfScale, setPdfScale] = useState(1);
  const [containerLayout, setContainerLayout] = useState({ width: 0, height: 0 });
  const [padWidth, setPadWidth] = useState(0);

  const createPanResponder = (
    currentRef: React.MutableRefObject<string>,
    setCurrent: (p: string) => void,
    setLive: React.Dispatch<React.SetStateAction<string[]>>
  ) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const path = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        currentRef.current = path;
        setCurrent(path);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const next = `${currentRef.current} L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        currentRef.current = next;
        setCurrent(next);
      },
      onPanResponderRelease: () => {
        const finished = currentRef.current;
        if (finished) {
          setLive((prev) => [...prev, finished]);
        }
        currentRef.current = '';
        setCurrent('');
      },
      onPanResponderTerminationRequest: () => false,
    });

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

  const savePad = () => {
    if (activePad === 'initials') {
      setInitialsPaths([...liveInitials]);
    } else if (activePad === 'signature') {
      setSignaturePaths([...liveSignature]);
    }
    setActivePad(null);
  };

  const convertToSvgFile = async (paths: string[], fileName: string) => {
    const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
      <svg width="500" height="200" viewBox="0 0 500 200" xmlns="http://www.w3.org/2000/svg">
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

      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        try {
          const base64data = (reader.result as string).split(',')[1];
          const filePath = `${RNFS.DocumentDirectoryPath}/agreement_signed_${agreementId}.pdf`;
          await RNFS.writeFile(filePath, base64data, 'base64');

          FlashMessage.success('Success', 'Agreement signed successfully');

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
      console.error('Signing failed:', error);
      FlashMessage.error('Error', 'Failed to sign agreement');
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
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={{ flex: 1, backgroundColor: 'white' }}>
          {/* Header */}
          <View style={{ paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <View>
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 2 }}>
                Digital Agreement
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#0f172a' }}>Sign to Finalize Order</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Main Content Area */}
          <View
            style={{ flex: 1, position: 'relative', backgroundColor: '#1e293b' }}
            onLayout={(e) => setContainerLayout(e.nativeEvent.layout)}
          >
            {previewBase64.startsWith('JVBERi') ? (
              <View style={{ flex: 1 }}>
                <Pdf
                  source={{ uri: `data:application/pdf;base64,${previewBase64}` }}
                  style={{ flex: 1, backgroundColor: '#334155' }}
                  fitPolicy={2}
                  enablePaging={true}
                  spacing={0}
                  minScale={1.0}
                  maxScale={3.0}
                  onPageChanged={(page) => {
                    setCurrentPage(page);
                  }}
                  onScaleChanged={(scale) => {
                    setPdfScale(scale);
                  }}
                />

                {/* Precision Signature/Initial Overlays */}
                {signatureFields &&
                  containerLayout.width > 0 &&
                  (() => {
                    const PDF_ASPECT_RATIO = 0.7727; // 8.5 / 11
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
                                width: `${Math.max(
                                  15,
                                  Number(signatureFields.buyerInitials.widthPercent) * 1.2
                                )}%`,
                                height: `${Math.max(
                                  3.5,
                                  Number(signatureFields.buyerInitials.heightPercent) * 0.8
                                )}%`,
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
                                transform: [
                                  { translateX: -renderedW * 0.01 },
                                  { translateY: -renderedH * 0.005 },
                                ], // Precision center-alignment
                              }}
                            >
                              {initialsPaths.length === 0 ? (
                                <View style={{ alignItems: 'center' }}>
                                  <Text style={{ fontSize: 7, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: -0.5 }}>
                                    Initial
                                  </Text>
                                  <Icon name="pencil-plus" size={12} color="#94A3B8" />
                                </View>
                              ) : (
                                <Svg
                                  width="100%"
                                  height="100%"
                                  viewBox={`0 0 ${padWidth || 500} 300`}
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
                                width: `${Math.max(
                                  16,
                                  Number(signatureFields.buyerSignature.widthPercent) * 0.65
                                )}%`,
                                height: `${Math.max(
                                  5,
                                  Number(signatureFields.buyerSignature.heightPercent) * 0.65
                                )}%`,
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
                                transform: [
                                  { translateX: -renderedW * 0.005 + 10 },
                                  { translateY: 0.0 },
                                ], // Precision center-alignment on line
                              }}
                            >
                              {signaturePaths.length === 0 ? (
                                <View style={{ alignItems: 'center' }}>
                                  <Text style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>
                                    Sign Here
                                  </Text>
                                  <Icon name="signature-freehand" size={16} color="#94A3B8" />
                                </View>
                              ) : (
                                <Svg
                                  width="100%"
                                  height="100%"
                                  viewBox={`0 0 ${padWidth || 500} 300`}
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
              </View>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
                <Icon name="file-document-outline" size={48} color="#cbd5e1" />
                <Text style={{ color: '#94a3b8', fontWeight: 'bold', marginTop: 16 }}>Document preview unavailable</Text>
              </View>
            )}
          </View>

          {/* Compact Footer Actions */}
          <View style={{ paddingHorizontal: 24, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9', backgroundColor: 'white', flexDirection: 'row', gap: 12 }}>
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
          </View>
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
                  style={{ height: 300, width: '100%', backgroundColor: '#f8fafc', borderWidth: 2, borderStyle: 'dashed', borderColor: '#e2e8f0', borderRadius: 24, overflow: 'hidden' }}
                  onLayout={(e) => setPadWidth(e.nativeEvent.layout.width)}
                  {...(activePad === 'initials'
                    ? initialsPanResponder.panHandlers
                    : signaturePanResponder.panHandlers)}
                >
                  <Svg width="100%" height="100%">
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

              <View style={{ padding: 24, flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  onPress={() => clearPad(activePad)}
                  style={{ flex: 1, height: 56, backgroundColor: '#f1f5f9', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontWeight: '900', color: '#475569', textTransform: 'uppercase', fontSize: 10 }}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={savePad}
                  style={{ flex: 2, height: 56, backgroundColor: '#0f172a', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontWeight: '900', color: 'white', textTransform: 'uppercase', fontSize: 10 }}>Save Mark</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
        </SafeAreaView>
      </SafeAreaProvider>
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
