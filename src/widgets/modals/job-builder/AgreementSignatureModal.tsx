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
  const [pdfOffset, setPdfOffset] = useState({ x: 0, y: 0 });
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

          // Open the signed PDF immediately
          setTimeout(async () => {
            try {
              await FileViewer.open(filePath);
            } catch (e) {
              console.error('Failed to open PDF:', e);
            }
          }, 500);

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
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/60 justify-end">
        <View
          className="w-full bg-white rounded-t-[40px] overflow-hidden"
          style={{ height: '94%' }}
        >
          {/* Header */}
          <View className="px-6 py-4 flex-row justify-between items-center border-b border-slate-100">
            <View>
              <Text className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Digital Agreement
              </Text>
              <Text className="text-sm font-black text-slate-900">Sign to Finalize Order</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-10 h-10 rounded-full bg-slate-50 items-center justify-center"
            >
              <Icon name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Main Content Area */}
          <View className="flex-1 relative bg-slate-200">
            {previewBase64.startsWith('JVBERi') ? (
              <View className="flex-1">
                <Pdf
                  source={{ uri: `data:application/pdf;base64,${previewBase64}` }}
                  style={{ flex: 1, backgroundColor: '#f1f5f9' }}
                  fitPolicy={0}
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

                {/* Absolute Signature/Initial Boxes */}
                {signatureFields && (
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
                            left: `${signatureFields.buyerInitials.xPercent}%`,
                            top: `${Number(signatureFields.buyerInitials.yPercent) - 1}%`,
                            width: `${signatureFields.buyerInitials.widthPercent}%`,
                            height: `${signatureFields.buyerInitials.heightPercent}%`,
                            backgroundColor:
                              initialsPaths.length > 0
                                ? 'rgba(34, 197, 94, 0.15)'
                                : 'rgba(239, 68, 68, 0.1)',
                            borderWidth: 2,
                            borderColor: initialsPaths.length > 0 ? '#22c55e' : '#ef4444',
                            borderStyle: initialsPaths.length > 0 ? 'solid' : 'dashed',
                            borderRadius: 4,
                            alignItems: 'center',
                            justifyContent: 'center',
                            transform: [{ scale: 1 / pdfScale }], // Counter-scale to keep border thin if zoomed
                          }}
                        >
                          {initialsPaths.length === 0 ? (
                            <Text
                              style={{
                                fontSize: 8,
                                fontWeight: '900',
                                color: '#ef4444',
                                textTransform: 'uppercase',
                              }}
                            >
                              Initial Here
                            </Text>
                          ) : (
                            <Svg width="100%" height="100%" viewBox={`0 0 ${padWidth || 500} 300`}>
                              {initialsPaths.map((p, i) => (
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
                            left: `${signatureFields.buyerSignature.xPercent}%`,
                            top: `${Number(signatureFields.buyerSignature.yPercent) - 4}%`,
                            width: `${signatureFields.buyerSignature.widthPercent}%`,
                            height: `${signatureFields.buyerSignature.heightPercent}%`,
                            backgroundColor:
                              signaturePaths.length > 0
                                ? 'rgba(34, 197, 94, 0.1)'
                                : 'rgba(239, 68, 68, 0.1)',
                            borderWidth: 2,
                            borderColor: signaturePaths.length > 0 ? '#22c55e' : '#ef4444',
                            borderStyle: signaturePaths.length > 0 ? 'solid' : 'dashed',
                            borderRadius: 4,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {signaturePaths.length === 0 ? (
                            <Text
                              style={{
                                fontSize: 8,
                                fontWeight: '900',
                                color: '#ef4444',
                                textTransform: 'uppercase',
                              }}
                            >
                              Sign Here
                            </Text>
                          ) : (
                            <Svg width="100%" height="100%" viewBox={`0 0 ${padWidth || 500} 300`}>
                              {signaturePaths.map((p, i) => (
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
                            </Svg>
                          )}
                        </TouchableOpacity>
                      )}
                  </View>
                )}
              </View>
            ) : (
              <View className="flex-1 items-center justify-center bg-slate-100">
                <Icon name="file-document-outline" size={48} color="#cbd5e1" />
                <Text className="text-slate-400 font-bold mt-4">Document preview unavailable</Text>
              </View>
            )}
          </View>

          {/* Footer Submit Button */}
          <View className="p-8 pb-10 border-t border-slate-100 bg-white">
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading || initialsPaths.length === 0 || signaturePaths.length === 0}
              className={`h-16 rounded-3xl items-center justify-center shadow-lg ${
                loading || initialsPaths.length === 0 || signaturePaths.length === 0
                  ? 'bg-slate-200'
                  : 'bg-green-600 shadow-green-600/30'
              }`}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-black uppercase tracking-widest text-xs">
                  Authorize & Submit Order
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Signature Drawing Overlay */}
        {activePad && (
          <View style={styles.overlay} className="bg-black/95 items-center justify-center p-6">
            <View className="bg-white w-full rounded-[40px] overflow-hidden">
              <View className="p-6 flex-row justify-between items-center bg-slate-50">
                <View>
                  <Text className="font-black text-slate-900 uppercase text-xs">
                    {activePad === 'initials' ? 'Capture Initials' : 'Capture Signature'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setActivePad(null)}>
                  <Icon name="close" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>

              <View className="p-6">
                <View
                  style={{ height: 300 }}
                  onLayout={(e) => setPadWidth(e.nativeEvent.layout.width)}
                  className="w-full bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl overflow-hidden"
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

              <View className="p-6 flex-row gap-3">
                <TouchableOpacity
                  onPress={() => clearPad(activePad)}
                  className="flex-1 h-14 bg-slate-100 rounded-2xl items-center justify-center"
                >
                  <Text className="font-black text-slate-600 uppercase text-[10px]">Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={savePad}
                  className="flex-[2] h-14 bg-slate-900 rounded-2xl items-center justify-center"
                >
                  <Text className="font-black text-white uppercase text-[10px]">Save Mark</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
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
