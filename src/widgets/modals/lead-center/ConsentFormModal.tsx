import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  StyleSheet,
  PanResponder,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { Share, ActivityIndicator, Linking } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FileViewer from 'react-native-file-viewer';
import Svg, { Path } from 'react-native-svg';
import RNFS from 'react-native-fs';
import { launchImageLibrary } from 'react-native-image-picker';
import { FlashMessage as GlobalFlashMessage } from '../../../config/message';
import RNFlashMessage from 'react-native-flash-message';
import { formatUSPhoneNumber } from '../../../utils/phone-util';
import Pdf from 'react-native-pdf';
import { Dimensions } from 'react-native';
import { useUploadPaperConsentOCRMutation } from '../../../hooks/useLeadMutation';

import { useAuth } from '../../../hooks/useAuth';

const formatLeadTime = (leadTime: string) => {
  if (!leadTime || leadTime === 'N/A') return '';
  const timeStr = leadTime.toLowerCase().trim();
  const isPM = timeStr.includes('pm');
  const timeMatch = timeStr.match(/(\d+)/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    return `${displayHours.toString().padStart(2, '0')}:00 ${period}`;
  }
  return leadTime;
};

const formatToMMDDYYYY = (dateStr: string) => {
  if (!dateStr) return '';
  let cleanStr = dateStr.trim().replace(/,/g, ' ').replace(/\s+/g, '/').replace(/-+/g, '/');
  const parts = cleanStr.split('/');
  if (parts.length === 3) {
    let [part1, part2, part3] = parts;
    part1 = part1.trim().padStart(2, '0');
    part2 = part2.trim().padStart(2, '0');
    part3 = part3.trim();
    if (part3.length === 2) {
      part3 = '20' + part3;
    }
    if (part1.length === 4) {
      return `${part2}/${part3}/${part1}`;
    }
    if (parseInt(part1, 10) > 12) {
      return `${part2}/${part1}/${part3}`;
    } else {
      return `${part1}/${part2}/${part3}`;
    }
  }
  return dateStr;
};

interface ConsentFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  onPaperFallback: () => void;
  lead: any;
  type: 'consent' | 'roof_waiver';
  loading?: boolean;
  onFinalUpload?: (pdfPath: string) => Promise<void>;
  uploading?: boolean;
  prefilledData?: any;
}

export const ConsentFormModal = ({
  visible,
  onClose,
  onSubmit,
  onPaperFallback,
  lead,
  type,
  loading,
  onFinalUpload,
  uploading,
  prefilledData,
}: ConsentFormModalProps) => {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();

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
        style: { zIndex: 9999, elevation: 9999 },
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
        style: { zIndex: 9999, elevation: 9999 },
      });
    },
  };

  const [submissionType, setSubmissionType] = useState<'digital' | 'paper'>(
    prefilledData ? 'paper' : 'digital'
  );

  const getInitialRepName = () => {
    return prefilledData?.repName ?? (user ? `${user.firstName} ${user.lastName}`.trim() : 'Firstrep');
  };

  const getInitialTime = () => {
    const rawTime = prefilledData?.time ?? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return rawTime.replace(/\u202f/g, ' ').replace(/\s+/g, ' ');
  };

  const getInitialDate = () => {
    if (prefilledData?.date) {
      return formatToMMDDYYYY(prefilledData.date);
    }
    const targetDate = new Date();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const yyyy = targetDate.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  };

  const getInitialOfficeCode = () => {
    if (prefilledData?.officeCode) return prefilledData.officeCode;
    if (!user) return '01';
    if (user.officeCode) return user.officeCode;
    if (Array.isArray(user.office) && user.office[0]?.code) return user.office[0].code;
    if (user.office && typeof user.office === 'object') {
      if (user.office.code) return user.office.code;
      if (user.office.officeCode) return user.office.officeCode;
    }
    if (Array.isArray(user.office) && user.office[0]?.officeCode) return user.office[0].officeCode;
    if (user.officeId) return user.officeId;
    return '01';
  };

  const [formData, setFormData] = useState({
    firstName: prefilledData?.firstName ?? lead?.customerDetails?.firstName ?? '',
    lastName: prefilledData?.lastName ?? lead?.customerDetails?.lastName ?? '',
    phoneNumber: formatUSPhoneNumber(prefilledData?.phoneNumber ?? lead?.customerDetails?.phone ?? ''),
    email: prefilledData?.email ?? lead?.customerDetails?.email ?? '',
    leadId: prefilledData?.leadId ?? lead?.leadId ?? 'N/A',
    repName: getInitialRepName(),
    officeCode: getInitialOfficeCode(),
    time: getInitialTime(),
    date: getInitialDate(),
    address: lead?.fullAddress || '',
    consent: false,
  });
  const [generatedPdf, setGeneratedPdf] = useState<string | null>(null);

  React.useEffect(() => {
    if (user) {
      setFormData((prev) => ({
        ...prev,
        repName: prefilledData?.repName ?? `${user.firstName} ${user.lastName}`.trim(),
        officeCode: prefilledData?.officeCode ?? (() => {
          if (user.officeCode) return user.officeCode;
          if (Array.isArray(user.office) && user.office[0]?.code) return user.office[0].code;
          if (user.office && typeof user.office === 'object') {
            if (user.office.code) return user.office.code;
            if (user.office.officeCode) return user.office.officeCode;
          }
          if (Array.isArray(user.office) && user.office[0]?.officeCode) return user.office[0].officeCode;
          if (user.officeId) return user.officeId;
          return '01';
        })(),
      }));
    }
  }, [user, prefilledData]);

  React.useEffect(() => {
    if (prefilledData) {
      setFormData((prev) => ({
        ...prev,
        firstName: prefilledData.firstName ?? prev.firstName,
        lastName: prefilledData.lastName ?? prev.lastName,
        phoneNumber: formatUSPhoneNumber(prefilledData.phoneNumber ?? prev.phoneNumber),
        email: prefilledData.email ?? prev.email,
        leadId: prefilledData.leadId ?? prev.leadId,
        date: prefilledData.date ? formatToMMDDYYYY(prefilledData.date) : prev.date,
      }));
      setSubmissionType('paper');
    }
  }, [prefilledData]);

  // Signature state
  const [showSigPad, setShowSigPad] = useState(false);
  const [savedPaths, setSavedPaths] = useState<string[]>([]);
  const [livePaths, setLivePaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const currentPathRef = React.useRef('');
  const [padLayout, setPadLayout] = useState({ width: Dimensions.get('window').width - 64, height: 260 });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture touches immediately — prevents ScrollView from stealing the gesture
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
          if (finished) {
            setLivePaths((prev) => [...prev, finished]);
          }
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

  const handleFinalSubmit = async () => {
    if (!formData.firstName || !formData.firstName.trim()) {
      FlashMessage.error('Validation Error', 'First name is required.');
      return;
    }
    if (!formData.phoneNumber || !formData.phoneNumber.replace(/\D/g, '')) {
      FlashMessage.error('Validation Error', 'Phone number is required.');
      return;
    }
    if (!formData.email || !formData.email.includes('@')) {
      FlashMessage.error('Validation Error', 'A valid email address is required.');
      return;
    }
    if (savedPaths.length === 0) {
      FlashMessage.error('Validation Error', 'Customer signature is required.');
      return;
    }

    try {
      const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
        <svg width="500" height="260" viewBox="0 0 320 260" xmlns="http://www.w3.org/2000/svg">
          ${savedPaths
          .map(
            (p) =>
              `<path d="${p}" stroke="black" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />`
          )
          .join('')}
        </svg>`;

      const filePath = `${RNFS.CachesDirectoryPath}/signature_${Date.now()}.svg`;
      await RNFS.writeFile(filePath, svgContent, 'utf8');

      const signatureFile = {
        uri: Platform.OS === 'android' ? `file://${filePath}` : filePath,
        name: 'signature.svg',
        type: 'image/svg+xml',
      };

      const formatDateToYmd = (dateStr: string) => {
        if (!dateStr) return '';
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const [mm, dd, yyyy] = parts;
          return `${yyyy}-${mm}-${dd}`;
        }
        return dateStr;
      };

      const rawPhone = String(formData.phoneNumber).replace(/\D/g, '');
      const finalPhone = rawPhone.length === 11 && rawPhone.startsWith('1') ? rawPhone.slice(1) : rawPhone;

      const res = await onSubmit({
        fullName: `${formData.firstName} ${formData.lastName}`.trim(),
        email: String(formData.email),
        phoneNumber: finalPhone,
        leadId: String(lead?.leadId || ''),
        type: submissionType,
        file: signatureFile,
        repName: String(formData.repName),
        officeCode: String(formData.officeCode),
        address: String(formData.address),
        time: String(formData.time),
        date: formatDateToYmd(String(formData.date)),
      });
      console.log(res, 'resssss');

      if (typeof res === 'string') {
        // Automatically trigger final upload to S3 and close
        if (onFinalUpload) {
          await onFinalUpload(res);
        }
        onClose();
      }
    } catch (error: any) {
      console.log('Failed to prepare signature file:', error);
      FlashMessage.error(
        'Error',
        'Failed to save signature: ' + (error?.message || 'Unknown error')
      );
    }
  };

  const handleDownload = async () => {
    if (!generatedPdf) return;
    try {
      if (Platform.OS === 'android') {
        const downloadDir = ReactNativeBlobUtil.fs.dirs.DownloadDir;
        const newPath = `${downloadDir}/${type === 'consent' ? 'Consent' : 'Waiver'}_${Date.now()}.pdf`;
        await ReactNativeBlobUtil.fs.cp(generatedPdf, newPath);
        await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
          {
            name: `${type === 'consent' ? 'Consent' : 'Waiver'}_${Date.now()}`,
            parentFolder: '',
            mimeType: 'application/pdf',
          },
          'Download',
          newPath
        );
        FlashMessage.success('Saved', 'PDF saved to Downloads folder');
      } else {
        await Share.share({
          url: generatedPdf,
          title: 'Save Consent Form',
        });
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
      <View className="flex-1 bg-black/50 justify-center px-4">
        <View className="rounded-2xl overflow-hidden shadow-2xl h-4/5">
          <View
            className="flex-row items-center justify-between p-4"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Text className="text-white text-sm font-semibold">Customer Consent Form</Text>
            <View className="flex-row items-center gap-3">
              {submissionType !== 'paper' && (
                <TouchableOpacity onPress={onPaperFallback} className="bg-white rounded-md px-2 py-0.5">
                  <Text className="text-[#1C252E] text-sm">Paper Fallback</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose}>
                <Icon name="close" size={22} color="white" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            className="px-4 py-6 bg-white h-fit"
            showsVerticalScrollIndicator={false}
            scrollEnabled={!showSigPad}
          >
            {/* Disclaimer */}
            <View className="mb-6 rounded-lg p-3" style={{ backgroundColor: '#919EAB14' }}>
              <Text className="font-semibold text-xs mb-2" style={{ color: '#1C252E' }}>
                Customer Consent to Receive Updates
              </Text>
              <Text className="text-xs" style={{ color: '#637381' }}>
                By signing below, I agree to receive text and/or email updates from Leaf Home and
                its representatives about my inspection, estimate, photos, and project details. I
                understand I can opt out at any time.
              </Text>
            </View>

            {/* Form Fields */}
            {renderField('First Name*', formData.firstName, 'firstName', undefined, true)}
            {renderField('Phone Number*', formData.phoneNumber, 'phoneNumber', undefined, true)}
            {renderField('Email Address*', formData.email, 'email', undefined, true)}
            {renderField('Lead ID*', formData.leadId, 'leadId')}
            {renderField('Rep Name*', formData.repName, 'repName')}
            {renderField('Office Code*', formData.officeCode, 'officeCode')}
            {renderField('Time*', formData.time, 'time', 'clock-outline')}
            {renderField('Date*', formData.date, 'date', 'calendar-range')}
            {renderField('Address*', formData.address, 'address', undefined, true)}

            {/* Signature Section */}
            <View className="mb-6">
              <Text className="text-[#000000] font-semibold text-xs mb-3">Customer Signature *</Text>
              {/* Tap to open inline pad — NO nested Modal */}
              <TouchableOpacity
                onPress={openSigPad}
                activeOpacity={0.8}
                className="w-full h-44 rounded-2xl border-2 border-dashed items-center justify-center overflow-hidden"
                style={{ borderColor: '#919EAB52' }}
              >
                {savedPaths.length === 0 ? (
                  <View className="items-center">
                    <Icon
                      name="fountain-pen-tip"
                      size={32}
                      color="#919EAB"
                      style={{ opacity: 0.3 }}
                    />
                    <Text className="text-[#4D4D4D] text-xs mt-2">Draw Your Signature</Text>
                  </View>
                ) : (
                  <View className="flex-1 w-full bg-slate-50">
                    <Svg width="100%" height="100%" viewBox={`0 0 ${padLayout.width} ${padLayout.height}`} preserveAspectRatio="xMidYMid meet">
                      {savedPaths.map((p, i) => (
                        <Path key={i} d={p} stroke="black" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      ))}
                    </Svg>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Checkbox Section */}
            <View className="flex-row mb-8">
              <TouchableOpacity
                onPress={() => setFormData((p) => ({ ...p, consent: !p.consent }))}
                className="w-6 h-6 rounded-md border-2 items-center justify-center mr-2"
                style={{
                  borderColor: formData.consent ? '#72BD00' : '#637381',
                  backgroundColor: formData.consent ? '#72BD00' : 'transparent',
                }}
              >
                {formData.consent && <MaterialIcon name="check" size={14} color="white" />}
              </TouchableOpacity>
              <View>
                <TouchableOpacity onPress={() => setFormData((p) => ({ ...p, consent: !p.consent }))}>
                  <Text className="text-[#1C252E] text-sm">I agree to electronic Signature.</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openURL('https://leafhome.trusthub.com/privacypolicy')}>
                  <Text className="text-xs" style={{ color: colors.primary.main }}>
                    Privacy Policy | LeafFilter
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Footer Buttons */}
            <View className="flex-row justify-end gap-3 pb-12">
              <TouchableOpacity
                onPress={onClose}
                className="px-3 py-1.5 rounded-lg border"
                style={{ borderColor: '#919EAB52' }}
              >
                <Text className="text-[#1C252E] font-semibold text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleFinalSubmit}
                disabled={!formData.consent || savedPaths.length === 0 || loading}
                className="px-3 py-1.5 rounded-lg"
                style={{
                  backgroundColor:
                    !formData.consent || savedPaths.length === 0
                      ? '#919EAB33'
                      : colors.primary.main,
                  opacity: loading ? 0.6 : 1,
                }}
              >
                <Text
                  className="font-semibold text-sm"
                  style={{
                    color: !formData.consent || savedPaths.length === 0 ? '#919EABCC' : '#FFFFFF',
                  }}
                >
                  {loading ? '...' : 'Submit'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* ── PDF SUCCESS OVERLAY ── */}
          {generatedPdf && (
            <View className="absolute inset-0 bg-white" style={{ zIndex: 1000 }}>
              {/* PDF Preview Header */}
              <View className="flex-row items-center justify-between p-4 border-b border-slate-100">
                <View>
                  <Text className="text-lg font-black text-slate-900">Signed Consent</Text>
                  <Text className="text-[10px] font-bold text-green-600 ">
                    {uploading ? 'Uploading to S3...' : 'Successfully Generated'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  className="w-10 h-10 items-center justify-center rounded-full bg-slate-50"
                >
                  <Icon name="close" size={24} color="#637381" />
                </TouchableOpacity>
              </View>

              {/* Live PDF Viewer */}
              <View className="flex-1 bg-slate-50 items-center justify-center">
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
                    backgroundColor: '#F8FAFC',
                  }}
                  renderActivityIndicator={() => <ActivityIndicator color="#22C55E" size="large" />}
                  onLoadComplete={(numberOfPages) => {
                    console.log(`PDF Loaded with ${numberOfPages} pages`);
                  }}
                  onError={(error) => {
                    console.log('PDF Render Error:', error);
                    FlashMessage.error(
                      'Error',
                      'Unable to display PDF. Please try saving it localy.'
                    );
                  }}
                />
              </View>

              {/* Action Bar */}
              <View className="p-4 bg-white border-t border-slate-100 gap-3">
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={handleViewPdf}
                    className="flex-1 h-12 bg-slate-100 rounded-xl flex-row items-center justify-center"
                  >
                    <Icon name="eye" size={18} color="#637381" className="mr-2" />
                    <Text className="font-bold text-[#637381] text-xs">Full Screen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleDownload}
                    className="flex-1 h-12 bg-slate-100 rounded-xl flex-row items-center justify-center"
                  >
                    <Icon name="download" size={18} color="#637381" className="mr-2" />
                    <Text className="font-bold text-[#637381] text-xs">Save Local</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={onClose}
                  disabled={uploading}
                  className="w-full h-14 bg-green-600 rounded-2xl flex-row items-center justify-center shadow-lg shadow-green-600/30"
                >
                  {uploading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="font-black text-white  tracking-widest text-xs">
                      Finish & Close
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* ── Inline Signature Pad Overlay (same Modal, works on iOS) ── */}
        {showSigPad && (
          <View style={styles.sigOverlay}>
            <View style={styles.sigCard}>
              {/* Sig Header */}
              <View style={[styles.sigHeader, { backgroundColor: colors.primary.main }]}>
                <View>
                  <Text style={styles.sigHeaderTitle}>Draw Your Signature</Text>
                  <Text style={styles.sigHeaderSub}>Use your finger or stylus to sign below.</Text>
                </View>
                <TouchableOpacity onPress={closeSigPad}>
                  <Icon name="close" size={20} color="white" />
                </TouchableOpacity>
              </View>

              {/* Drawing Canvas */}
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

              {/* Sig Actions */}
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
                        backgroundColor: livePaths.length > 0 ? colors.primary.main : '#919EAB33',
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
        <RNFlashMessage ref={flashRef} position="top" />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
});
