import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  Image,
  StyleSheet,
  Alert,
  Pressable,
  Platform,
  PermissionsAndroid,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { formatUSPhoneNumber } from '../../../utils/phone-util';
import { parseApiError } from '../../../utils/error-util';
import { INSPECTION_ISSUES } from '../../../constants/lead-center';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RNFlashMessage from 'react-native-flash-message';
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';

interface InspectionFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  lead: any;
  loading?: boolean;
}

const SECTIONS = [
  { id: 'gutters', label: 'Gutter System' },
  { id: 'fascia', label: 'Fascia & Soffit' },
  { id: 'ventilation', label: 'Ventilation (Soffit)' },
  { id: 'structural', label: 'Roofline Observation' },
  { id: 'erosion', label: 'Foundation & Drainage' },
  { id: 'observations', label: 'Additional Observations' },
  { id: 'custom', label: 'Custom Intake / Builder' },
];

type SectionKey =
  | 'gutters'
  | 'fascia'
  | 'ventilation'
  | 'structural'
  | 'erosion'
  | 'observations'
  | 'custom';

interface IssueItem {
  photo: string | null;
  issue: string;
  description: string;
}

type SectionData = Record<SectionKey, IssueItem[]>;

const makeEmptyItem = (): IssueItem => ({ photo: null, issue: '', description: '' });

export const InspectionFormModal = ({
  visible,
  onClose,
  onSubmit,
  lead,
  loading,
}: InspectionFormModalProps) => {
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const flashRef = React.useRef<RNFlashMessage>(null);

  useEffect(() => {
    if (visible && user) {
      logEvent('view', {
        user_id: user._id || user.id,
        module_type: 'inspection_report',
        created_by: user._id || user.id,
      });
    }
  }, [visible, user]);

  const FlashMessage = {
    info: (title: string, description: string = '') => {
      flashRef.current?.showMessage({
        message: title,
        description,
        type: 'info',
        icon: 'info',
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
  };

  const [isGenerating, setIsGenerating] = useState(false);
  const isLoading = !!(isGenerating || loading);

  const [name, setName] = useState(
    `${lead?.customerDetails?.firstName || ''} ${lead?.customerDetails?.lastName || ''}`.trim()
  );
  const [email, setEmail] = useState(lead?.customerDetails?.email || '');
  const [phone, setPhone] = useState(lead?.customerDetails?.phone || '');

  const [sections, setSections] = useState<SectionData>({
    gutters: [makeEmptyItem()],
    fascia: [makeEmptyItem()],
    ventilation: [makeEmptyItem()],
    structural: [makeEmptyItem()],
    erosion: [makeEmptyItem()],
    observations: [makeEmptyItem()],
    custom: [makeEmptyItem()],
  });

  const addItem = (sectionId: SectionKey) => {
    if (isLoading) return;
    setSections((prev) => ({
      ...prev,
      [sectionId]: [...prev[sectionId], makeEmptyItem()],
    }));
  };

  const removeItem = (sectionId: SectionKey, index: number) => {
    if (isLoading) return;
    setSections((prev) => {
      const updated = [...prev[sectionId]];
      updated.splice(index, 1);
      return { ...prev, [sectionId]: updated };
    });
  };

  const updateItem = (
    sectionId: SectionKey,
    index: number,
    field: keyof IssueItem,
    value: string | null
  ) => {
    if (isLoading) return;
    setSections((prev) => {
      const updated = [...prev[sectionId]];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, [sectionId]: updated };
    });
  };

  const handleCapture = (sectionId: SectionKey, index: number) => {
    if (isLoading) return;
    console.log('Tapped Photo Box:', sectionId, index);
    setTimeout(() => {
      Alert.alert(
        'Add Photo',
        'Choose a source',
        [
          {
            text: 'Camera',
            onPress: async () => {
              if (Platform.OS === 'android') {
                const hasCamera = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
                let granted = hasCamera ? PermissionsAndroid.RESULTS.GRANTED : null;
                if (!hasCamera) {
                  granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.CAMERA,
                    {
                      title: 'Camera Permission',
                      message: 'App needs access to your camera to take photos.',
                      buttonNeutral: 'Ask Me Later',
                      buttonNegative: 'Cancel',
                      buttonPositive: 'OK',
                    }
                  );
                }
                if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                  Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
                  return;
                }
              }

              launchCamera(
                {
                  mediaType: 'photo',
                  quality: 0.5,
                  maxWidth: 1200,
                  maxHeight: 1200,
                  saveToPhotos: true,
                },
                (res) => {
                  setTimeout(() => {
                    if (res.didCancel) return;
                    if (res.errorCode) {
                      Alert.alert('Error', res.errorMessage || 'Could not open camera');
                      return;
                    }
                    if (res.assets && res.assets[0]?.uri) {
                      updateItem(sectionId, index, 'photo', res.assets[0].uri);
                    }
                  }, 0);
                }
              );
            },
          },
          {
            text: 'Gallery',
            onPress: () => {
              launchImageLibrary(
                {
                  mediaType: 'photo',
                  quality: 0.5,
                  maxWidth: 1200,
                  maxHeight: 1200,
                  selectionLimit: 1,
                },
                (res) => {
                  setTimeout(() => {
                    if (res.didCancel) return;
                    if (res.errorCode) {
                      Alert.alert('Error', res.errorMessage || 'Could not open gallery');
                      return;
                    }
                    if (res.assets && res.assets[0]?.uri) {
                      updateItem(sectionId, index, 'photo', res.assets[0].uri);
                    }
                  }, 0);
                }
              );
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ],
        { cancelable: true }
      );
    }, 100);
  };

  const handleSubmit = async () => {
    if (isLoading) return;
    try {
      setIsGenerating(true);
      FlashMessage.info('Generating inspection report...', 'Generating');
      const payload: any = {
        name,
        email,
        phone,
        reportId: `INSP-${lead.jobNumber || lead._id}`,
        finalNotes: sections.observations?.[0]?.description || '',
      };

      // Map sections to items, items2, items3, etc.
      const mapping: Record<SectionKey, string> = {
        gutters: 'items',
        fascia: 'items2',
        ventilation: 'items3',
        structural: 'items4',
        erosion: 'items5',
        observations: 'items6',
        custom: 'items7',
      };

      Object.keys(sections).forEach((key) => {
        const sectionId = key as SectionKey;
        const apiKey = mapping[sectionId];
        sections[sectionId].forEach((item, idx) => {
          if (item.issue || item.description || item.photo) {
            payload[`${apiKey}[${idx}][issue]`] = item.issue;
            payload[`${apiKey}[${idx}][description]`] = item.description;
            if (item.photo) {
              payload[`${apiKey}[${idx}][image]`] = item.photo;
            }
          }
        });
      });

      payload.leadId = lead?._id || lead?.id;
      await onSubmit(payload);
    } catch (err: any) {
      console.error('Inspection Submit Error:', err);
      const errorMsg = parseApiError(err);
      FlashMessage.error('Submission Failed', errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderFloatingField = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    keyboardType: any = 'default'
  ) => (
    <View style={styles.fieldWrap}>
      <View style={styles.floatingLabel}>
        <Text style={styles.floatingLabelText}>{label}</Text>
      </View>
      <View style={[styles.fieldBox, isLoading && { opacity: 0.6 }]}>
        <TextInput
          value={value}
          onChangeText={(t) => {
            if (isLoading) return;
            const formatted = label === 'Phone' ? formatUSPhoneNumber(t) : t;
            onChange(formatted);
          }}
          placeholder={label}
          placeholderTextColor="#919EAB"
          keyboardType={keyboardType}
          style={styles.fieldInput}
          maxLength={label === 'Phone' ? 17 : undefined}
          editable={!isLoading}
        />
      </View>
    </View>
  );

  const renderSection = (section: { id: string; label: string }) => {
    const sectionId = section.id as SectionKey;
    const items = sections[sectionId];

    return (
      <View key={sectionId} style={styles.section}>
        {/* Section Header */}
        <Text style={[styles.sectionTitle, { color: colors.primary.main }]}>{section.label}</Text>

        {/* Issue Cards */}
        {items.map((item, idx) => (
          <View key={idx} style={styles.issueCard}>
            {/* Photo Upload Box */}
            <Pressable
              onPress={() => {
                if (isLoading) return;
                handleCapture(sectionId, idx);
              }}
              style={({ pressed }) => [{ opacity: isLoading ? 0.6 : (pressed ? 0.6 : 1) }]}
            >
              <View
                style={[
                  styles.photoBox,
                  { borderColor: item.photo ? colors.primary.main : '#919EAB33' },
                ]}
              >
                {item.photo ? (
                  <Image
                    source={{ uri: item.photo }}
                    style={{ width: '100%', height: 150 }}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <View className="bg-slate-50 w-12 h-12 rounded-full items-center justify-center mb-2">
                      <Icon name="camera-plus-outline" size={24} color={colors.primary.main} />
                    </View>
                    <Text style={styles.photoPlaceholderText}>Capture Point</Text>
                  </View>
                )}
              </View>
            </Pressable>

            {/* Issue Field */}
            <IssueDropdown
              sectionId={sectionId}
              value={item.issue}
              onSelect={(val: string, desc?: string) => {
                if (isLoading) return;
                updateItem(sectionId, idx, 'issue', val);
                if (desc) {
                  updateItem(sectionId, idx, 'description', desc);
                }
              }}
              disabled={isLoading}
            />

            {/* Description Field */}
            <View style={[styles.fieldWrap, { marginTop: 4 }]}>
              <View style={styles.floatingLabel}>
                <Text style={styles.floatingLabelText}>Description</Text>
              </View>
              <View
                style={[
                  styles.fieldBox,
                  { height: 80, alignItems: 'flex-start', paddingTop: 12 },
                  isLoading && { opacity: 0.6 },
                ]}
              >
                <TextInput
                  value={item.description}
                  onChangeText={(t) => {
                    if (isLoading) return;
                    updateItem(sectionId, idx, 'description', t);
                  }}
                  placeholder="Additional details..."
                  placeholderTextColor="#919EAB"
                  style={[styles.fieldInput, { textAlignVertical: 'top' }]}
                  multiline={true}
                  numberOfLines={3}
                  editable={!isLoading}
                />
              </View>
            </View>
          </View>
        ))}

        {/* Add / Remove Row */}
        <View style={styles.addRemoveRow}>
          <Pressable
            onPress={() => {
              if (isLoading) return;
              addItem(sectionId);
            }}
            className="flex-row items-center"
            style={({ pressed }) => [styles.addPhotoBtn, { opacity: isLoading ? 0.4 : (pressed ? 0.6 : 1) }]}
          >
            <Icon name="plus" size={14} color={colors.primary.main} />
            <Text style={[styles.addPhotoBtnText, { color: colors.primary.main }]}>Add Item</Text>
          </Pressable>
          {items.length > 1 && (
            <TouchableOpacity
              onPress={() => {
                if (isLoading) return;
                removeItem(sectionId, items.length - 1);
              }}
              disabled={isLoading}
              style={[styles.removeBtn, { opacity: isLoading ? 0.4 : 1 }]}
            >
              <Icon name="trash-can-outline" size={14} color="#FF4842" />
              <Text style={styles.removeBtnText}>Remove</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // ── Inspection Report form ────────────────────────────────────────────────
  // The schema-driven photo-capture flow (`DynamicInspectionView`) deliberately
  // does NOT live here: this tool generates the report. Photo capture/management
  // belongs to Job Docs → Manage Photos, matching web, where `job-docs-tab.js`
  // — not the report — owns the dynamic inspection dialogs.
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header */}
          <View style={[styles.header, { backgroundColor: colors.primary.main }]}>
            <Text style={styles.headerTitle}>Inspection Report</Text>
            <TouchableOpacity
              onPress={() => {
                if (isLoading) return;
                onClose();
              }}
              disabled={isLoading}
              style={isLoading && { opacity: 0.5 }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={24} color="white" />
            </TouchableOpacity>
          </View>

          {/* Scrollable Body */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Client Fields */}
            {renderFloatingField('Client Name', name, setName)}
            {renderFloatingField('Email', email, setEmail, 'email-address')}
            {renderFloatingField('Phone', phone, setPhone, 'phone-pad')}

            {/* All Sections */}
            {SECTIONS.map(renderSection)}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={() => {
                if (isLoading) return;
                onClose();
              }}
              disabled={isLoading}
              style={[styles.cancelBtn, isLoading && { opacity: 0.5 }]}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={isLoading}
              style={[
                styles.submitBtn,
                { backgroundColor: colors.primary.main, opacity: isLoading ? 0.6 : 1, flexDirection: 'row' },
              ]}
            >
              {isLoading && <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />}
              <Text style={styles.submitBtnText}>
                {isLoading ? 'Generating...' : 'Generate Report'}
              </Text>
            </TouchableOpacity>
          </View>
          <RNFlashMessage
            ref={flashRef}
            position="top"
            statusBarHeight={insets.top > 0 ? insets.top : (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : undefined)}
          />
        </View>
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
  headerTitle: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 20,
    backgroundColor: 'white',
  },
  // Floating label fields
  fieldWrap: {
    marginBottom: 20,
    position: 'relative',
  },
  floatingLabel: {
    position: 'absolute',
    top: -8,
    left: 14,
    zIndex: 10,
    paddingHorizontal: 4,
    backgroundColor: 'white',
  },
  floatingLabelText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#000000',
  },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#919EAB33',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldInput: {
    flex: 1,
    fontSize: 12,
    color: '#1C252E',
    padding: 0,
  },
  // Sections
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  issueCard: {
    marginBottom: 12,
  },
  // Photo box
  photoBox: {
    width: '100%',
    height: 150,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F9FAFB',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#919EAB33',
    marginBottom: 8,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#637381',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Add/Remove row
  addRemoveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addPhotoBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  removeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF4842',
  },
  // Footer
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#919EAB22',
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#919EAB33',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#637381',
  },
  submitBtn: {
    flex: 2,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '700',
  },
});

const IssueDropdown = ({ sectionId, value, onSelect, disabled }: any) => {
  const { colors } = useTheme();
  const [showOptions, setShowOptions] = useState(false);
  const [layout, setLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const triggerRef = React.useRef<View>(null);

  const getIssuesForSection = (id: string) => {
    switch (id) {
      case 'gutters':
        return INSPECTION_ISSUES.gutters;
      case 'fascia':
        return INSPECTION_ISSUES.fascia;
      case 'ventilation':
        return INSPECTION_ISSUES.ventilation;
      case 'structural':
        return INSPECTION_ISSUES.structural;
      case 'erosion':
        return INSPECTION_ISSUES.erosion;
      default:
        return [];
    }
  };

  const options = getIssuesForSection(sectionId);

  const onOpen = () => {
    triggerRef.current?.measure((x, y, width, height, pageX, pageY) => {
      setLayout({ x: pageX, y: pageY, width, height });
      setShowOptions(true);
    });
  };

  if (options.length === 0) {
    return (
      <View style={[styles.fieldWrap, { marginTop: 12 }]}>
        <View style={styles.floatingLabel}>
          <Text style={styles.floatingLabelText}>Issue</Text>
        </View>
        <View style={[styles.fieldBox, disabled && { opacity: 0.6 }]}>
          <TextInput
            value={value}
            onChangeText={onSelect}
            placeholder="Describe the issue"
            placeholderTextColor="#919EAB"
            style={styles.fieldInput}
            editable={!disabled}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.fieldWrap, { marginTop: 12, marginBottom: 12 }]}>
      <TouchableOpacity
        ref={triggerRef}
        onPress={() => {
          if (disabled) return;
          onOpen();
        }}
        disabled={disabled}
        activeOpacity={0.7}
        style={[
          styles.fieldBox,
          disabled && { opacity: 0.6 },
          showOptions && {
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            borderBottomWidth: 0,
          },
        ]}
      >
        <Text
          style={[styles.fieldInput, { color: value ? '#1C252E' : '#919EAB' }]}
          numberOfLines={1}
        >
          {value || 'Select predefined issue...'}
        </Text>
        <Icon name={showOptions ? 'chevron-up' : 'chevron-down'} size={20} color="#919EAB" />

        <View style={styles.floatingLabel}>
          <Text style={styles.floatingLabelText}>Issue</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={showOptions} transparent animationType="none">
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={1}
          onPress={() => setShowOptions(false)}
        >
          <View
            style={{
              position: 'absolute',
              top: layout.y + layout.height,
              left: layout.x,
              width: layout.width,
              backgroundColor: 'white',
              borderBottomLeftRadius: 12,
              borderBottomRightRadius: 12,
              borderWidth: 1,
              borderColor: '#919EAB33',
              borderTopWidth: 0,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.1,
              shadowRadius: 12,
              elevation: 5,
              maxHeight: 250,
              zIndex: 999,
            }}
          >
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              <TouchableOpacity
                onPress={() => {
                  onSelect('');
                  setShowOptions(false);
                }}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: '#F4F6F8',
                }}
              >
                <Text style={{ fontSize: 13, color: '#919EAB', fontStyle: 'italic' }}>
                  None (Custom Entry)
                </Text>
              </TouchableOpacity>
              {options.map((option: any) => (
                <TouchableOpacity
                  key={option.label}
                  onPress={() => {
                    onSelect(option.label, option.description);
                    setShowOptions(false);
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: '#F4F6F8',
                    backgroundColor: value === option.label ? '#72BD0008' : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: value === option.label ? '#72BD00' : '#1C252E',
                      fontWeight: value === option.label ? '700' : '500',
                    }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};
