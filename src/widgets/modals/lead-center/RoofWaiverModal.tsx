import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  StyleSheet,
  PanResponder,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import Svg, { Path } from 'react-native-svg';
import RNFS from 'react-native-fs';
import { formatUSPhoneNumber } from '../../../utils/phone-util';
import { Share, ActivityIndicator, Linking } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FileViewer from 'react-native-file-viewer';
import Pdf from 'react-native-pdf';
import { Dimensions } from 'react-native';
import RNFlashMessage from 'react-native-flash-message';

interface RoofWaiverModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  onPaperFallback: () => void;
  lead: any;
  loading?: boolean;
  onFinalUpload?: (pdfPath: string) => Promise<void>;
  uploading?: boolean;
  prefilledData?: any;
}

import { useRoofWaiver } from '../../../hooks/useRoofWaiver';
import { useRepProducts } from '../../../hooks/useRepProducts';
import { useAuth } from '../../../hooks/useAuth';
import { buildRoofWaiverText } from '../../../utils/roof-waiver-text';
import { SignaturePad } from './components/SignaturePad';

export const RoofWaiverModal = ({
  visible,
  onClose,
  onSubmit,
  onPaperFallback,
  lead,
  loading,
  onFinalUpload,
  uploading,
  prefilledData,
}: RoofWaiverModalProps) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Web parity (REVDSM-1053): the agreement names the signed-in company and the
  // products it publishes, not LeafFilter. Both have safe fallbacks, so the
  // paragraph is still complete while the products request is in flight.
  const { user } = useAuth();
  const { products: repProducts } = useRepProducts();
  const companyName = user?.companyName;
  const roofWaiverText = useMemo(
    () => buildRoofWaiverText({ companyName, products: repProducts }),
    [companyName, repProducts]
  );

  const flashRef = React.useRef<RNFlashMessage>(null);
  const FlashMessage = {
    success: (title: string, description: string = '') => {
      flashRef.current?.showMessage({
        message: title,
        description,
        type: 'success',
        icon: 'success',
        duration: 3000,
        floating: true,
        style: { zIndex: 9999, elevation: 9999 },
      });
    },
    error: (title: string, description: string = 'Something went wrong') => {
      flashRef.current?.showMessage({
        message: title,
        description,
        type: 'danger',
        icon: 'danger',
        duration: 4000,
        floating: true,
        style: { zIndex: 9999, elevation: 9999, backgroundColor: '#D32F2F' },
      });
    },
    show: (title: string, description: string = '', type: any = 'info') => {
      flashRef.current?.showMessage({
        message: title,
        description,
        type,
        icon: type,
        duration: 3000,
        floating: true,
        style: { zIndex: 9999, elevation: 9999, backgroundColor: type === 'danger' ? '#D32F2F' : undefined },
      });
    },
  };

  const [padLayout, setPadLayout] = useState({ width: Dimensions.get('window').width - 64, height: 260 });

  const {
    formData,
    setFormData,
    generatedPdf,
    showSigPad,
    setShowSigPad,
    savedPaths,
    setSavedPaths,
    livePaths,
    setLivePaths,
    currentPath,
    panResponder,
    handleFinalSubmit,
    submissionType,
    clearSig,
  } = useRoofWaiver(lead, onSubmit, onFinalUpload, onClose, prefilledData, flashRef);

  const openSigPad = () => {
    setLivePaths([...savedPaths]);
    setShowSigPad(true);
  };

  const saveSig = () => {
    setSavedPaths([...livePaths]);
    setShowSigPad(false);
  };

  const handleDownload = async () => {
    if (!generatedPdf) return;
    try {
      if (Platform.OS === 'android') {
        const downloadDir = ReactNativeBlobUtil.fs.dirs.DownloadDir;
        const newPath = `${downloadDir}/waiver_${Date.now()}.pdf`;
        await ReactNativeBlobUtil.fs.cp(generatedPdf, newPath);
        await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
          { name: `Waiver_${Date.now()}`, parentFolder: '', mimeType: 'application/pdf' },
          'Download',
          newPath
        );
        FlashMessage.success('Saved', 'PDF saved to Downloads folder');
      } else {
        await Share.share({ url: generatedPdf, title: 'Save Roof Waiver' });
      }
    } catch (e) {
      FlashMessage.error('Error', 'Failed to save file');
    }
  };

  const handleViewPdf = async () => {
    if (generatedPdf) {
      try {
        await FileViewer.open(generatedPdf, { showOpenWithDialog: true });
      } catch (e) {
        FlashMessage.error('Error', 'No PDF viewer found on device');
      }
    }
  };

  const renderField = (
    label: string,
    value: string,
    key: string,
    icon?: string,
    editable: boolean = false
  ) => (
    <View style={styles.fieldWrap}>
      <View style={styles.floatingLabel}>
        <Text style={styles.floatingLabelText}>{label}</Text>
      </View>
      <View style={styles.fieldBox}>
        <TextInput
          value={value}
          editable={editable}
          onChangeText={(t) => {
            const formatted = key === 'phoneNumber' ? formatUSPhoneNumber(t) : t;
            setFormData((p) => ({ ...p, [key]: formatted }));
          }}
          style={[styles.fieldInput, { color: editable ? '#1C252E' : '#919EAB' }]}
          placeholder={`Enter ${label}`}
          placeholderTextColor="#C4CDD5"
          keyboardType={key === 'phoneNumber' ? 'phone-pad' : 'default'}
          maxLength={key === 'phoneNumber' ? 17 : undefined}
        />
        {icon && <Icon name={icon} size={20} color="#919EAB" />}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={[styles.header, { backgroundColor: colors.primary.main }]}>
            <Text style={styles.headerTitle}>Roof Waiver Form</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={onPaperFallback} style={styles.paperFallbackBtn}>
                <Text style={styles.paperFallbackText}>
                  {submissionType === 'paper' ? 'Rescan Paper' : 'Paper Fallback'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose}>
                <Icon name="close" size={22} color="white" />
              </TouchableOpacity>
            </View>
          </View>

          {submissionType === 'paper' && (
            <View style={{ backgroundColor: '#F0F9EB', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E1F3D8', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="check-circle" size={16} color="#72BD00" />
              <Text style={{ color: '#67C23A', fontSize: 12, fontWeight: '600' }}>
                Paper Fallback Mode: Prefilled from OCR scan.
              </Text>
            </View>
          )}

          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!showSigPad}
          >
            <View style={styles.disclaimerBox}>
              <Text style={styles.disclaimerTitle}>Roof Waiver Agreement</Text>
              <Text style={styles.disclaimerBody}>{roofWaiverText}</Text>
            </View>

            {renderField('First Name*', formData.firstName, 'firstName', undefined, true)}
            {renderField('Phone Number*', formData.phoneNumber, 'phoneNumber', undefined, true)}
            {renderField('Email Address*', formData.email, 'email', undefined, true)}
            {renderField('Lead ID*', formData.leadId, 'leadId')}
            {renderField('Rep Name*', formData.repName, 'repName')}
            {renderField('Office Code*', formData.officeCode, 'officeCode')}
            {renderField('Time*', formData.time, 'time', 'clock-outline')}
            {renderField('Date*', formData.date, 'date', 'calendar-range')}
            {renderField('Address*', formData.address, 'address', undefined, true)}

            <View style={styles.signatureSection}>
              <Text style={styles.signatureLabel}>Customer Signature *</Text>
              <TouchableOpacity
                onPress={openSigPad}
                activeOpacity={0.8}
                style={styles.signatureBox}
              >
                {savedPaths.length === 0 ? (
                  <View style={styles.signaturePlaceholder}>
                    <Icon
                      name="fountain-pen-tip"
                      size={32}
                      color="#919EAB"
                      style={{ opacity: 0.3 }}
                    />
                    <Text style={styles.signaturePlaceholderText}>Draw Your Signature</Text>
                  </View>
                ) : (
                  <View style={{ flex: 1, width: '100%', backgroundColor: '#F8FAFC' }}>
                    <Svg width="100%" height="100%" viewBox={`0 0 ${padLayout.width} ${padLayout.height}`} preserveAspectRatio="xMidYMid meet">
                      {savedPaths.map((p, i) => (
                        <Path key={i} d={p} stroke="black" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      ))}
                    </Svg>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.checkboxRow}>
              <TouchableOpacity
                onPress={() => setFormData((p) => ({ ...p, consent: !p.consent }))}
                style={[
                  styles.checkbox,
                  {
                    borderColor: formData.consent ? colors.primary.main : '#637381',
                    backgroundColor: formData.consent ? colors.primary.main : 'transparent',
                  },
                ]}
              >
                {formData.consent && <MaterialIcon name="check" size={14} color="white" />}
              </TouchableOpacity>
              <View>
                <TouchableOpacity onPress={() => setFormData((p) => ({ ...p, consent: !p.consent }))}>
                  <Text style={styles.checkboxText}>I agree to electronic Signature.</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openURL('https://leafhome.trusthub.com/privacypolicy')}>
                  <Text style={[styles.checkboxLinks, { color: colors.primary.main }]}>
                    {`Privacy Policy${companyName ? ` | ${companyName}` : ''}`}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.footerRow}>
              <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleFinalSubmit}
                disabled={!formData.consent || savedPaths.length === 0 || loading}
                style={[
                  styles.submitBtn,
                  {
                    backgroundColor:
                      !formData.consent || savedPaths.length === 0
                        ? '#919EAB33'
                        : colors.primary.main,
                    opacity: loading ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.submitBtnText,
                    {
                      color: !formData.consent || savedPaths.length === 0 ? '#919EABCC' : '#FFFFFF',
                    },
                  ]}
                >
                  {loading ? '...' : 'Submit'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {generatedPdf && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'white',
                zIndex: 1000,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: '#F4F6F8',
                }}
              >
                <View>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E' }}>
                    Signed Waiver
                  </Text>
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '700',
                      color: '#72BD00',
                      textTransform: 'uppercase',
                    }}
                  >
                    {uploading ? 'Uploading to Cloud...' : 'Successfully Generated'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  style={{
                    width: 40,
                    height: 40,
                    alignItems: 'center',
                    borderRadius: 20,
                    backgroundColor: '#F4F6F8',
                  }}
                >
                  <Icon name="close" size={24} color="#637381" />
                </TouchableOpacity>
              </View>

              <View
                style={{
                  flex: 1,
                  backgroundColor: '#F4F6F8',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Pdf
                  source={{
                    uri: generatedPdf.startsWith('file://')
                      ? generatedPdf
                      : `file://${generatedPdf}`,
                    cache: false,
                  }}
                  trustAllCerts={false}
                  style={{
                    flex: 1,
                    width: Dimensions.get('window').width - 32,
                    height: '100%',
                    backgroundColor: '#F4F6F8',
                  }}
                  renderActivityIndicator={() => <ActivityIndicator color="#72BD00" size="large" />}
                  onLoadComplete={(num) => console.log('Waiver PDF Loaded:', num)}
                  onError={(err) => {
                    console.log('Waiver PDF Error:', err);
                    FlashMessage.error('Error', 'Unable to show waiver preview.');
                  }}
                />
              </View>

              <View
                style={{
                  padding: 16,
                  backgroundColor: 'white',
                  borderTopWidth: 1,
                  borderTopColor: '#F4F6F8',
                  gap: 12,
                }}
              >
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={handleViewPdf}
                    style={{
                      flex: 1,
                      height: 48,
                      backgroundColor: '#F4F6F8',
                      borderRadius: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="eye" size={18} color="#637381" style={{ marginRight: 8 }} />
                    <Text style={{ fontWeight: '700', color: '#637381', fontSize: 12 }}>
                      Preview
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleDownload}
                    style={{
                      flex: 1,
                      height: 48,
                      backgroundColor: '#F4F6F8',
                      borderRadius: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="download" size={18} color="#637381" style={{ marginRight: 8 }} />
                    <Text style={{ fontWeight: '700', color: '#637381', fontSize: 12 }}>Save</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={onClose}
                  disabled={uploading}
                  style={{
                    width: '100%',
                    height: 56,
                    backgroundColor: '#72BD00',
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#72BD00',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 6,
                  }}
                >
                  {uploading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text
                      style={{
                        fontWeight: '900',
                        color: 'white',
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        fontSize: 12,
                      }}
                    >
                      Finish & Close
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <SignaturePad
          showSigPad={showSigPad}
          colors={colors}
          closeSigPad={() => setShowSigPad(false)}
          panResponder={panResponder}
          livePaths={livePaths}
          currentPath={currentPath}
          clearSig={clearSig}
          saveSig={saveSig}
          onPadLayout={(e: any) => setPadLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        />
        <RNFlashMessage
          ref={flashRef}
          position="top"
          statusBarHeight={insets.top > 0 ? insets.top : (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : undefined)}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    maxHeight: '88%',
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitle: { color: 'white', fontSize: 14, fontWeight: '600' },
  paperFallbackBtn: {
    borderWidth: 1,
    borderColor: 'white',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  paperFallbackText: { color: 'white', fontSize: 12, fontWeight: '500' },
  body: { paddingHorizontal: 16, paddingTop: 20, backgroundColor: 'white' },
  disclaimerBox: {
    marginBottom: 20,
    borderRadius: 10,
    padding: 14,
    backgroundColor: '#F4F6F8',
  },
  disclaimerTitle: { fontSize: 13, fontWeight: '600', color: '#1C252E', marginBottom: 8 },
  disclaimerBody: { fontSize: 11, color: '#637381', lineHeight: 17 },
  fieldWrap: { marginBottom: 20, position: 'relative' },
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
  fieldInput: { flex: 1, fontSize: 12, padding: 0 },
  signatureSection: { marginBottom: 20 },
  signatureLabel: { fontSize: 12, fontWeight: '600', color: '#000000', marginBottom: 10 },
  signatureBox: {
    width: '100%',
    height: 176,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#919EAB52',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  signaturePlaceholder: { alignItems: 'center' },
  signaturePlaceholderText: { color: '#4D4D4D', fontSize: 12, marginTop: 8 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  checkboxText: { fontSize: 13, color: '#1C252E' },
  checkboxLinks: { fontSize: 11, marginTop: 2 },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingBottom: 20,
    paddingTop: 4,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#919EAB52',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { color: '#1C252E', fontWeight: '600', fontSize: 13 },
  submitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: { fontWeight: '600', fontSize: 13 },

  // ── Inline Signature Overlay (no second Modal) ──────────────────
  sigOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 16,
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
