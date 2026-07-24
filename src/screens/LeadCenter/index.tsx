import React, { useState, useEffect, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  StatusBar,
  Modal,
  BackHandler,
  Alert,
  PermissionsAndroid,
} from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { Storage } from '../../utils/storage';
import { logLeadSessionPause } from '../../utils/lead-activity-log';
import { ENV } from '../../config/env';
import { useTheme } from '../../theme/ThemeProvider';
import Pitchbook from '../../widgets/modals/lead-center/Pitchbook';
import {
  useSubmitJobBuilderMutation,
  useSubmitDigitalConsentMutation,
  useSubmitRoofWaiverMutation,
  useUploadReportMutation,
  useGenerateRevRenderMutation,
  useUploadPaperConsentOCRMutation,
  useUploadImagesMutation,
  useFinalizeConsentUploadMutation,
} from '../../hooks/useLeadMutation';
import { LeadService } from '../../services/api/leads';
import { resolveS3Url } from '../../utils/s3-utils';
import { getRawPhoneNumber } from '../../utils/phone-util';
import { parseApiError } from '../../utils/error-util';
import { ConsentFormModal } from '../../widgets/modals/lead-center/ConsentFormModal';
import { RoofWaiverModal } from '../../widgets/modals/lead-center/RoofWaiverModal';
import { RiskReportModal } from '../../widgets/modals/lead-center/RiskReportModal';
import { PdfPreviewModal } from '../../widgets/modals/PdfPreviewModal';
import { MapSelectionModal } from '../../widgets/common/modal/MapSelectionModal';
import { PaperFallbackModal } from '../../widgets/modals/lead-center/PaperFallbackModal';
import { useAuth } from '../../hooks/useAuth';
import { logEvent } from '../../services/api/LoggerService';
import { logBuildJobInitiated, logCalculatorCreated, logPaymentMethodInherited } from '../../utils/activity-log/calculator-log';
import { JobDocsSection } from '../../widgets/components/LeadCenter/JobDocsSection';
import { ToolsSection, MapSection } from '../../widgets/components/LeadCenter/OperationalSections';
import Icon from 'react-native-vector-icons/Ionicons';
import { Header } from '../../widgets/common/MainHeader';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { EditCustomerModal } from '../../widgets/modals/lead-center/EditCustomerModal';
import Feather from 'react-native-vector-icons/Feather';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';
import Ionicon from 'react-native-vector-icons/Ionicons';

type TabType = 'job_docs' | 'tools';

import { ImageGridModal } from '../../widgets/modals/lead-center/ImageGridModal';
import { Linking } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { FlashMessage } from '../../config/message';
import { IMAGE_CATEGORIES } from '../../constants/lead-center';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FileViewer from 'react-native-file-viewer';

import { useLeadQuery } from '../../hooks/useLeadQuery';
import RNFS from 'react-native-fs';

import { useLeadCenterData } from '../../hooks/useLeadCenterData';
import { useLeadReports } from '../../hooks/useLeadReports';
import { useLeadCenterModals } from '../../hooks/useLeadCenterModals';
import { InspectionFormModal } from '../../widgets/modals/lead-center/InspectionFormModal';
import { downloadPdfToDevice } from '../../utils/download-utils';

const SubModalWrap = ({
  visible,
  children,
  onClose,
  isDark,
  colors,
}: {
  visible: boolean;
  children: React.ReactNode;
  onClose: () => void;
  isDark: boolean;
  colors: any;
}) => (
  <Modal
    visible={visible}
    animationType="slide"
    transparent={false}
    statusBarTranslucent={true}
    hardwareAccelerated={true}
    onRequestClose={onClose}
  >
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar
        barStyle={'light-content'}
        backgroundColor="transparent"
        translucent
        animated={false}
      />
      {children}
    </View>
  </Modal>
);

export default function LeadCenterPage() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isConsentGenerating, setIsConsentGenerating] = useState(false);
  const [isWaiverGenerating, setIsWaiverGenerating] = useState(false);
  const [isInspectionGenerating, setIsInspectionGenerating] = useState(false);

  const { lead: initialLead, initialTool, fromZoneCanvasser, appointmentStarted } =
    route.params || {};

  // Custom Hooks for Data, Reports, and Modals
  const {
    lead,
    setLead,
    isRefreshing,
    refetch,
    jobState,
    setJobState,
    calculatorData,
    outcomeForm,
    isOutcomeLoading,
    sectionImages,
    setSectionImages,
  } = useLeadCenterData(initialLead, user, { appointmentStarted });

  const hasLoggedPauseRef = useRef(false);
  const userRef = useRef(user);
  const leadRef = useRef(lead);

  useEffect(() => {
    userRef.current = user;
    leadRef.current = lead;
  }, [user, lead]);

  useEffect(() => {
    return () => {
      if (leadRef.current?._id && !hasLoggedPauseRef.current) {
        hasLoggedPauseRef.current = true;
        logLeadSessionPause(userRef.current, leadRef.current).catch((err) => {
          console.warn('[LeadCenter] Unmount session pause logging failed:', err);
        });
      }
    };
  }, []);

  const {
    secureUrls,
    riskJob,
    handleStartRiskReport,
    handleDownloadRiskReport,
    handleDownloadReport,
    handleResetRiskReport,
    revRenderJobs,
    handleStartRevRenders,
  } = useLeadReports(lead, refetch);

  const {
    showConsentModal,
    showWaiverModal,
    showInspectionModal,
    showInspectionGrid,
    showPaperFallback,
    showRiskModal,
    showPdfModal,
    pdfPreviewData,
    toggleModal,
    handleOpenPdf,
    onToolAction,
  } = useLeadCenterModals(lead, initialTool, secureUrls, riskJob, {
    handleStartRiskReport,
    handleDownloadRiskReport,
    handleDownloadReport,
    handleResetRiskReport,
  });

  const finalizeUploadMutation = useFinalizeConsentUploadMutation();

  const [activeTab, setActiveTab] = useState<TabType>(
    route.params?.tab || (initialTool === 'tools' ? 'tools' : 'job_docs')
  );

  useEffect(() => {
    if (route.params?.tab) {
      setActiveTab(route.params.tab as TabType);
    }
  }, [route.params?.tab]);

  useEffect(() => {
    if (!user?._id) return;

    const prefetchMapJobs = async () => {
      try {
        console.log('[LeadCenter Prefetch] Prefetching map jobs (all)...');
        queryClient.prefetchQuery({
          queryKey: ['mapJobs', 'all'],
          queryFn: async () => {
            const res = await LeadService.findJobs({});
            return res.data?.data || [];
          },
          staleTime: 1000 * 60 * 5,
        });

        // Request location permissions asynchronously in background
        if (Platform.OS === 'ios') {
          await Geolocation.requestAuthorization('whenInUse');
        } else {
          const hasLocation = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
          if (!hasLocation) {
            await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
          }
        }
      } catch (e) {
        console.warn('[LeadCenter Prefetch] Location/Prefetch error:', e);
      }
    };

    prefetchMapJobs();
  }, [user?._id, queryClient]);

  const [loading, setLoading] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [showEditCustomerModal, setShowEditCustomerModal] = useState(false);
  const [showPhoneOptions, setShowPhoneOptions] = useState(false);
  const [showEmailOptions, setShowEmailOptions] = useState(false);

  const [activeFallbackForm, setActiveFallbackForm] = useState<'consent' | 'roof_waiver' | null>(null);
  const [prefilledOcrData, setPrefilledOcrData] = useState<any>(null);

  const parseOcrData = (ocrResult: any) => {
    const dataList = ocrResult?.data;
    const getFromData = (label: string) => {
      if (Array.isArray(dataList)) {
        const item = dataList.find((i: any) => i?.label?.toLowerCase() === label.toLowerCase());
        return item?.value ?? '';
      }
      if (dataList && typeof dataList === 'object') {
        return dataList[label] ?? dataList[label.replace(/\s+/g, '')] ?? '';
      }
      return '';
    };

    const fullName = getFromData('Customer Name') || '';
    const [firstName = '', ...lastNameParts] = fullName.split(' ');
    const lastName = lastNameParts.join(' ');

    const rawDate = getFromData('Date') || '';
    const normalizeOcrDate = (input: string) => {
      if (!input) return '';
      const s = String(input).trim().replace(/[-.]/g, '/');
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (m) {
        const mm = String(parseInt(m[1], 10)).padStart(2, '0');
        const dd = String(parseInt(m[2], 10)).padStart(2, '0');
        const y = m[3];
        const yyyy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
        return `${yyyy}-${mm}-${dd}`;
      }
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${yyyy}-${mm}-${dd}`;
      }
      return s;
    };

    return {
      firstName,
      lastName,
      phoneNumber: getFromData('Phone') || '',
      email: getFromData('Email') || '',
      leadId: getFromData('Lead ID') || '',
      date: normalizeOcrDate(rawDate),
    };
  };

  const handlePaperFallbackSubmit = async (fileData: any) => {
    try {
      const res = await ocrMutation.mutateAsync(fileData);
      const parsedData = parseOcrData(res);
      setPrefilledOcrData(parsedData);

      const targetForm = activeFallbackForm;
      setActiveFallbackForm(null);

      if (targetForm === 'consent') {
        toggleModal('showConsentModal', true);
      } else if (targetForm === 'roof_waiver') {
        toggleModal('showWaiverModal', true);
      }
    } catch (err) {
      console.error('OCR scanning error:', err);
    }
  };

  const handleCall = () => {
    const phone = lead?.customerDetails?.phone;
    if (phone) {
      Linking.openURL(`tel:${getRawPhoneNumber(phone)}`);
    }
    setShowPhoneOptions(false);
  };

  const handleTextMessage = () => {
    const phone = lead?.customerDetails?.phone;
    if (phone) {
      Linking.openURL(`sms:${getRawPhoneNumber(phone)}`);
    }
    setShowPhoneOptions(false);
  };

  const handleCopyPhone = () => {
    const phone = lead?.customerDetails?.phone;
    if (phone) {
      Clipboard.setString(phone);
      FlashMessage.success('Copied', 'Phone number copied to clipboard');
    }
    setShowPhoneOptions(false);
  };

  const handleEmail = () => {
    const email = lead?.customerDetails?.email;
    if (email) {
      Linking.openURL(`mailto:${email}`);
    }
    setShowEmailOptions(false);
  };

  const handleCopyEmail = () => {
    const email = lead?.customerDetails?.email;
    if (email) {
      Clipboard.setString(email);
      FlashMessage.success('Copied', 'Email copied to clipboard');
    }
    setShowEmailOptions(false);
  };

  // Auto-refresh Lead data when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (lead?._id) {
        queryClient.invalidateQueries({ queryKey: ['revrender-runs', lead._id] });
        refetch(); // Ensure lead data is fresh when returning from other screens
      }
    }, [lead?._id, queryClient, refetch])
  );

  // Auto-open Job Builder logic
  useEffect(() => {
    const handleAutoOpen = async () => {
      if (route.params?.openJobBuilder && !isOutcomeLoading) {
        try {
          const res = await LeadService.getLeadOutcome(lead?._id);
          const data = res.data?.data || res.data;
          let updatedJobState;
          const outcome = data?.outcome || data?.leadData || data;
          if (outcome?.jobBuilder) {
            updatedJobState = outcome.jobBuilder;
            setJobState(updatedJobState);
          } else {
            updatedJobState = {
              gutter: {
                partial: '',
                gutterColorsMulti: [],
                downspoutsMulti: [],
                extrasColors: { groundSpout: 'Black' },
              },
              leaffilter: {
                combinations: [],
                extras: {
                  csr: 0,
                  cornersFilter: 0,
                  sawzallHanger: 0,
                  removeProtection: 0,
                  ribbedRoof: 0,
                },
              },
              soffit: { vinyl: { type: '' }, porch: { location: [] }, nailer: { type: '' } },
              fascia: {
                wrap: { type: '' },
                boards: { boardType: '' },
                aluminumBoards: { footage: '' },
              },
              additional: { extraLabor: 0 },
              scheduleTime: null,
            };
            setJobState(updatedJobState);
          }
          const uId = user?._id || user?.id;
          if (uId && lead?._id) {
            logBuildJobInitiated({
              userId: uId,
              leadId: lead._id,
              result: outcomeForm?.result || undefined,
              calculatorId: calculatorData?._id,
              calculatorType: calculatorData?.type,
            });
          }
          navigation.navigate('JobBuilder', {
            initialJobState: updatedJobState,
            calculatorData,
            leadId: lead?._id,
            outcomeForm,
            onGoBack: setJobState,
          });
        } catch (e) {
          console.warn('Reset failed during auto-open', e);
        }
        navigation.setParams({ openJobBuilder: undefined });
      }
    };
    handleAutoOpen();
  }, [route.params?.openJobBuilder, isOutcomeLoading, calculatorData, outcomeForm]);

  const handleOpenChat = () => {
    navigation.navigate('ChatDetail', {
      leadId: lead._id,
      chatId: lead.chatId || '',
      customerName: (() => {
        const dateStr = lead.leadDate ? format(new Date(lead.leadDate), 'MM.dd.yy') : '';
        return `${lead.office || ''} Lead ${dateStr} - ${lead.leadId || 'N/A'}`.trim() || 'Discussion';
      })(),
      // Hand the loaded photos to the Appointment Photos picker (web parity —
      // web passes selectedJob.salesPhotos straight into the chat composer).
      salesPhotos: lead.salesPhotos || [],
    });
  };

  const handleShowJobBuilder = async () => {
    try {
      setLoading(true);
      const res = await LeadService.getLeadOutcome(lead?._id);
      const data = res.data?.data || res.data;
      let updatedJobState;
      const outcome = data?.outcome || data?.leadData || data;
      if (outcome?.jobBuilder) {
        updatedJobState = outcome.jobBuilder;
        setJobState(updatedJobState);
      } else {
        updatedJobState = {
          gutter: {
            partial: '',
            gutterColorsMulti: [],
            downspoutsMulti: [],
            extrasColors: { groundSpout: 'Black' },
          },
          leaffilter: {
            combinations: [],
            extras: {
              csr: 0,
              cornersFilter: 0,
              sawzallHanger: 0,
              removeProtection: 0,
              ribbedRoof: 0,
            },
          },
          soffit: { vinyl: { type: '' }, porch: { location: [] }, nailer: { type: '' } },
          fascia: {
            wrap: { type: '' },
            boards: { boardType: '' },
            aluminumBoards: { footage: '' },
          },
          additional: { extraLabor: 0 },
          scheduleTime: null,
        };
        setJobState(updatedJobState);
      }
      const uId = user?._id || user?.id;
      if (uId && lead?._id) {
        logBuildJobInitiated({
          userId: uId,
          leadId: lead._id,
          result: outcomeForm?.result || undefined,
          calculatorId: calculatorData?._id,
          calculatorType: calculatorData?.type,
        });
      }
      navigation.navigate('JobBuilder', {
        initialJobState: updatedJobState,
        calculatorData,
        leadId: lead?._id,
        outcomeForm,
        onGoBack: setJobState,
      });
    } catch (e) {
      console.warn('Manual reset failed', e);
      const uId = user?._id || user?.id;
      if (uId && lead?._id) {
        logBuildJobInitiated({
          userId: uId,
          leadId: lead._id,
          result: outcomeForm?.result || undefined,
          calculatorId: calculatorData?._id,
          calculatorType: calculatorData?.type,
        });
      }
      navigation.navigate('JobBuilder', {
        initialJobState: jobState,
        calculatorData,
        leadId: lead?._id,
        outcomeForm,
        onGoBack: setJobState,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialTool === 'chat') handleOpenChat();
  }, [initialTool]);

  const submitJobBuilder = useSubmitJobBuilderMutation();
  const consentMutation = useSubmitDigitalConsentMutation();
  const waiverMutation = useSubmitRoofWaiverMutation();
  const reportMutation = useUploadReportMutation();
  const ocrMutation = useUploadPaperConsentOCRMutation();
  const revRenderMutation = useGenerateRevRenderMutation();

  const handleConsentSubmit = async (data: any) => {
    toggleModal('showConsentModal', false);
    setIsConsentGenerating(true);
    try {
      const res = await consentMutation.mutateAsync({ leadId: lead?._id, payload: data });

      // Log successful consent form submission
      if (user?._id || user?.id) {
        logEvent('submit', {
          user_id: user?._id || user?.id,
          created_by: user?._id || user?.id,
          module_type: 'consent_form',
          meta: {
            formType: data.type,
            customerName: data.fullName,
            email: data.email,
            phoneNumber: data.phoneNumber,
            leadId: lead?._id || lead?.id || data.leadId,
            repName: data.repName,
            action: data.type === 'digital' ? 'digital_consent_form_submitted' : 'paper_consent_form_submitted',
          },
        });
      }

      await refetch();
      if (typeof res === 'string') {
        await finalizeUploadMutation.mutateAsync({
          leadId: lead?._id,
          pdfPath: res,
          reportType: 'consent_form',
        });

        // Log 'create' event to mirror web
        if (user?._id || user?.id) {
          logEvent('create', {
            user_id: user?._id || user?.id,
            module_type: 'consent_form',
            created_by: user?._id || user?.id,
            meta: {
              formType: data.type,
              leadId: lead?._id || lead?.id || data.leadId,
              formattedAddress: lead?.fullAddress || '',
              filename: `consent-form-${data.leadId || lead?.leadId || lead?._id}.pdf`,
            },
          });

          // Call logReportGeneration to populate the activity feed
          const currentDate = format(new Date(), 'MMMM d, yyyy');
          const reportType = 'consent Form';
          const reportData = `The consent form, generated by ${user?.firstName} ${user?.lastName} on ${currentDate}, for the ${lead?.fullAddress || ''} area.`;

          await LeadService.logReportGeneration({
            createdAt: format(new Date(), 'yyyy-MM-dd hh:mm a'),
            reportType,
            reportData,
          }).catch((err: any) => console.warn('Failed to log report generation:', err));
        }

        await refetch();
        setTimeout(() => refetch(), 1000);
        setTimeout(() => refetch(), 3000);
      }
      return res;
    } catch (err) {
      console.error('Consent Submit Error:', err);
      const errorMsg = parseApiError(err);
      FlashMessage.show('Submission Failed', errorMsg, 'danger');
    } finally {
      setIsConsentGenerating(false);
    }
  };

  const handleCustomerSubmit = async (data: { firstName: string; lastName: string; phone: string; email: string }) => {
    try {
      const customerId = lead.customerDetails?._id || lead.customerDetails?.id || lead?._id || lead?.id;
      if (!customerId) {
        throw new Error('Customer ID is missing. Unable to update customer.');
      }

      const payload = {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: getRawPhoneNumber(data.phone),
        email: data.email,
      };

      console.log('[EditCustomer] PATCH lead/v1/customer/' + customerId, payload);
      await LeadService.updateCustomer(customerId, payload);

      setLead((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          customerDetails: {
            ...prev.customerDetails,
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            email: data.email,
          },
        };
      });

      FlashMessage.success('Success', 'Customer details updated successfully.');
      refetch();
    } catch (error: any) {
      const apiError = error?.response?.data || error?.data || error;
      const errorMsg =
        typeof apiError === 'string'
          ? apiError.substring(0, 200)
          : apiError?.message || error?.message || 'Failed to update customer info.';
      console.error('Update Customer Error:', errorMsg);
      throw new Error(errorMsg);
    }
  };

  const handleWaiverSubmit = async (data: any) => {
    toggleModal('showWaiverModal', false);
    setIsWaiverGenerating(true);
    try {
      const res = await waiverMutation.mutateAsync({ leadId: lead?._id, payload: data });

      // Log successful roof waiver submission
      if (user?._id || user?.id) {
        logEvent('submit', {
          user_id: user?._id || user?.id,
          created_by: user?._id || user?.id,
          module_type: 'roof_waiver',
          meta: {
            formType: data.type,
            customerName: data.fullName,
            email: data.email,
            phoneNumber: data.phoneNumber,
            leadId: lead?._id || lead?.id || data.leadId,
            repName: data.repName,
            action: 'roof_waiver_submitted',
          },
        });
      }

      await refetch();
      if (typeof res === 'string') {
        await finalizeUploadMutation.mutateAsync({
          leadId: lead?._id,
          pdfPath: res,
          reportType: 'waiver_form',
        });

        // Log 'create' event for roof waiver to mirror web
        if (user?._id || user?.id) {
          logEvent('create', {
            user_id: user?._id || user?.id,
            module_type: 'roof_waiver_form',
            created_by: user?._id || user?.id,
            meta: {
              formType: data.type,
              leadId: lead?._id || lead?.id || data.leadId,
              formattedAddress: lead?.fullAddress || '',
              filename: `roof_waiver-form-${data.leadId || lead?.leadId || lead?._id}.pdf`,
            },
          });

          // Call logReportGeneration to populate the activity feed
          const currentDate = format(new Date(), 'MMMM d, yyyy');
          const reportType = 'roof_waiver Form';
          const reportData = `The roof_waiver form, generated by ${user?.firstName} ${user?.lastName} on ${currentDate}, for the ${lead?.fullAddress || ''} area.`;

          await LeadService.logReportGeneration({
            createdAt: format(new Date(), 'yyyy-MM-dd hh:mm a'),
            reportType,
            reportData,
          }).catch((err: any) => console.warn('Failed to log report generation:', err));
        }

        await refetch();
        setTimeout(() => refetch(), 1000);
        setTimeout(() => refetch(), 3000);
      }
      return res;
    } catch (err) {
      console.error('Waiver Submit Error:', err);
      const errorMsg = parseApiError(err);
      FlashMessage.show('Submission Failed', errorMsg, 'danger');
    } finally {
      setIsWaiverGenerating(false);
    }
  };

  const handleInspectionSubmit = async (data: any) => {
    setIsInspectionGenerating(true);
    try {
      const token = Storage.getItem('accessToken');
      const { dirs } = ReactNativeBlobUtil.fs;
      const fileName = `Inspection_${lead.jobNumber || lead.leadId || 'Report'}.pdf`;
      const filePath = `${dirs.DocumentDir}/${fileName}`;

      const formData: any[] = [];

      Object.keys(data).forEach((key) => {
        const value = data[key];
        if (!value && value !== 0) return;

        if (key.includes('[image]') && typeof value === 'string' && (value.startsWith('file://') || value.startsWith('/'))) {
          const cleanPath = value.replace('file://', '');
          formData.push({
            name: key,
            filename: `inspection_${Date.now()}.jpg`,
            type: 'image/jpeg',
            data: ReactNativeBlobUtil.wrap(cleanPath),
          });
        } else {
          formData.push({
            name: key,
            data: String(value),
          });
        }
      });

      const baseUrl = ENV.API_URL.endsWith('/') ? ENV.API_URL.slice(0, -1) : ENV.API_URL;
      const genUrl = `${baseUrl}/pdf-reports/v1/inspection/${lead?._id}/generate`;

      const res = await ReactNativeBlobUtil.config({
        fileCache: true,
        path: filePath,
        timeout: 120000,
      }).fetch(
        'POST',
        genUrl,
        {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
          Accept: 'application/pdf',
        },
        formData
      );

      const pdfPath = res.path();
      const content = await ReactNativeBlobUtil.fs.readFile(pdfPath, 'base64');
      if (!content.startsWith('JVBERi')) {
        await ReactNativeBlobUtil.fs.unlink(pdfPath);
        throw new Error('Generated file is not a valid PDF.');
      }

      const uploadData = new FormData();
      const finalLeadId = lead?._id || lead?.id || lead?.leadId;
      uploadData.append('leadId', finalLeadId);
      uploadData.append('reportType', 'inspection_report');
      uploadData.append('reportName', fileName);
      uploadData.append('file', {
        uri: Platform.OS === 'android' ? `file://${filePath}` : filePath,
        type: 'application/pdf',
        name: fileName,
      } as any);

      await reportMutation.mutateAsync(uploadData);

      // Count items by category from the flat data payload for telemetry parity
      const countItems = (prefix: string) => {
        const keys = Object.keys(data).filter(
          (key) => key.startsWith(prefix) && key.endsWith('[issue]')
        );
        return keys.length;
      };
      const hasItems = {
        gutters: countItems('items['),
        fascia: countItems('items2['),
        ventilation: countItems('items3['),
        roofline: countItems('items4['),
        erosion: countItems('items5['),
      };

      if (user?._id || user?.id) {
        logEvent('create', {
          user_id: user?._id || user?.id,
          module_type: 'inspection_report',
          created_by: user?._id || user?.id,
          meta: {
            leadId: lead?._id || lead?.id || data.leadId,
            reportId: data.reportId,
            homeownerName: data.name,
            homeownerEmail: data.email,
            homeownerPhone: data.phone,
            hasItems,
          },
        });
      }

      // Close the modal first so that the flash message and sharesheet appear on the main screen
      toggleModal('showInspectionModal', false);

      setTimeout(async () => {
        try {
          await downloadPdfToDevice(pdfPath, 'Inspection Report', false);
          FlashMessage.success(
            'Success',
            Platform.OS === 'ios'
              ? 'Inspection report generated and uploaded.'
              : 'Inspection report generated and saved to Downloads.'
          );
        } catch (downloadErr) {
          console.error('[LeadCenter] Download after generation failed:', downloadErr);
          FlashMessage.success('Success', 'Inspection report generated and uploaded successfully.');
        }
      }, 400);

      await refetch();
      setTimeout(() => refetch(), 1000);
      setTimeout(() => refetch(), 3000);
    } catch (e: any) {
      console.error('Inspection Submit Error:', e);
      throw e;
    } finally {
      setIsInspectionGenerating(false);
    }
  };

  const handleJobSubmit = async (payload: any) => {
    if (user?._id) {
      await submitJobBuilder.mutateAsync({ leadId: lead?._id, payload });
      toggleModal('showJobBuilder', false);
    }
  };

  const returnToZoneCanvasser = useCallback(() => {
    navigation.navigate('Leads', { reopenZoneCanvasser: true });
  }, [navigation]);

  const handleClose = useCallback(async () => {
    if (lead?._id && !hasLoggedPauseRef.current) {
      hasLoggedPauseRef.current = true;
      try {
        await logLeadSessionPause(user, lead);
      } catch (err) {
        console.warn('[LeadCenter] Session pause logging failed:', err);
      }
    }
    if (fromZoneCanvasser) {
      returnToZoneCanvasser();
      return;
    }
    navigation.goBack();
  }, [lead, user, fromZoneCanvasser, returnToZoneCanvasser, navigation]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true; // prevent default back press on Android
    });

    return () => backHandler.remove();
  }, [handleClose]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(
      2,
      '0'
    )}/${d.getFullYear()}`;
  };

  if (!lead) return null;

  return (
    <>
      <SafeAreaView
        style={[styles.root, { backgroundColor: isDark ? colors.surface : colors.background }]}
        edges={['bottom', 'left', 'right']}
      >

        {showInspectionGrid && (
          <ImageGridModal
            visible={showInspectionGrid}
            onClose={() => toggleModal('showInspectionGrid', false)}
            images={
              lead?.salesPhotos?.map((p: any) => ({ uri: p.s3url, category: p.category })) || []
            }
          />
        )}

        {showPdfModal && (
          <PdfPreviewModal
            visible={showPdfModal}
            onClose={() => toggleModal('showPdfModal', false)}
            uri={pdfPreviewData.url}
            title={pdfPreviewData.title}
          />
        )}

        <View
          className="px-4 pb-4 pt-6"
          style={{
            backgroundColor: isDark ? colors.surface : colors.background,
          }}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <TouchableOpacity
                onPress={handleClose}
                className="mr-3 p-1 items-center justify-center border border-border rounded-lg"
                style={{
                  width: 32,
                  height: 32,
                }}
              >
                <Feather
                  name="arrow-left"
                  size={14}
                  color={isDark ? colors.text : colors.textSecondary}
                />
              </TouchableOpacity>
              <View>
                <Text className="text-lg font-black" style={{ color: colors.text }}>
                  Lead Center
                </Text>
              </View>
            </View>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}
          contentContainerStyle={{ paddingBottom: 20 }}
        >
          <View className="px-4">
            <View className="flex-row gap-[10%] mb-4">
              <View className="flex-col gap-4">
                <Text className="text-base font-semibold" style={{ color: '#72BD00' }}>
                  Lead ID:
                  <Text className="font-semibold" style={{ color: colors.text }}>
                    {lead.leadId}
                  </Text>
                </Text>
                <View className="flex-row items-center">
                  <FontAwesome
                    name="user"
                    size={14}
                    color="#72BD00"
                  />
                  <Text className="ml-1 text-base font-semibold text-text-primary">
                    {lead.customerDetails?.firstName} {lead.customerDetails?.lastName}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowEditCustomerModal(true)}
                    style={{ marginLeft: 6, paddingHorizontal: 4 }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Feather
                      name="edit-2"
                      size={12}
                      color="#72BD00"
                    />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  className="flex-row items-center"
                  onPress={() => setShowPhoneOptions(true)}
                >
                  <FontAwesome
                    name="phone"
                    size={14}
                    color="#72BD00"
                  />
                  <Text className="ml-1 text-base font-semibold" style={{ color: '#72BD00' }}>
                    {lead.customerDetails?.phone}
                  </Text>
                </TouchableOpacity>
                <View className="flex-row items-center">
                  <Ionicon
                    name="calendar-clear"
                    size={14}
                    color="#72BD00"
                  />
                  <Text className="ml-1 text-base font-semibold text-text-primary">
                    {formatDate(lead?.leadDatetime)}
                  </Text>
                </View>
              </View>

              <View className="flex-col gap-4">
                <Text className="text-base font-semibold" style={{ color: '#72BD00' }}>
                  Lead Code:{' '}
                  <Text className="font-semibold" style={{ color: colors.text }}>
                    {lead.leadCode || 'N/A'}
                  </Text>
                </Text>
                <View>
                  <Text className="ml-1 text-base font-semibold text-[#1C252E]"></Text>
                </View>
                <TouchableOpacity
                  className="flex-row items-center"
                  onPress={() => setShowEmailOptions(true)}
                >
                  <Ionicon
                    name="mail"
                    size={14}
                    color="#72BD00"
                  />
                  <Text className="ml-1 text-base font-semibold" style={{ color: '#72BD00' }}>
                    {lead?.customerDetails?.email || 'N/A'}
                  </Text>
                </TouchableOpacity>
                <View className="flex-row items-center">
                  <MaterialIcon
                    name="clock"
                    size={14}
                    color="#72BD00"
                  />
                  <Text className="ml-1 text-base font-semibold  text-text-primary">
                    {lead.leadTime}
                  </Text>
                </View>
              </View>
            </View>
            <TouchableOpacity onPress={() => setShowMapModal(true)} className="flex-row items-center mb-4">
              <Ionicon
                name="location-sharp"
                size={14}
                color="#72BD00"
              />
              <Text className="ml-1 text-base font-semibold " style={{ color: "#72BD00" }}>
                {lead?.fullAddress || lead?.customerDetails?.address || 'N/A'}
              </Text>
            </TouchableOpacity>
          </View>
          <View
            className="flex-row px-4 mb-2 mt-1"
            style={{ backgroundColor: isDark ? colors.surface : colors.background }}
          >
            <View className="flex-1 flex-row gap-3 rounded-xl">
              <TabButton
                label="Job docs"
                i="folder-open"
                active={activeTab === 'job_docs'}
                onPress={() => setActiveTab('job_docs')}
                colors={colors}
                isDark={isDark}
              />
              <TabButton
                label="Map"
                i="map"
                active={false}
                onPress={() => navigation.navigate('MapDetail', { currentLead: lead })}
                colors={colors}
                isDark={isDark}
              />
              <TabButton
                label="Tools"
                i="tools"
                active={activeTab === 'tools'}
                onPress={() => setActiveTab('tools')}
                colors={colors}
                isDark={isDark}
              />
            </View>
          </View>

          <View style={{ flex: 1 }}>
            {activeTab === 'job_docs' && (
              <JobDocsSection
                lead={lead}
                sectionImages={sectionImages}
                onSectionImagesChange={setSectionImages}
                refetch={refetch}
                onOpenPdf={handleOpenPdf}
                secureUrls={secureUrls}
                isRefreshing={isRefreshing}
              />
            )}
            {activeTab === 'tools' && (
              <ToolsSection
                lead={lead}
                secureUrls={secureUrls}
                riskJob={riskJob}
                revRenderJobs={revRenderJobs}
                isConsentGenerating={isConsentGenerating}
                isWaiverGenerating={isWaiverGenerating}
                isInspectionGenerating={isInspectionGenerating}
                isCalculatorLoading={loading}
                onAction={(toolId: string, extra: any) => {
                  if (toolId === 'revrender') {
                    navigation.navigate('RevRender', {
                      lead,
                      sectionImages,
                      onNavToDocs: () => setActiveTab('job_docs'),
                      onGenerate: async (payload: any) => {
                        handleStartRevRenders([payload]);
                        return null;
                      },
                      onGenerateAll: (body: { payloads: any[]; leadId: string; jobId: string }) => {
                        handleStartRevRenders(body.payloads);
                      }
                    });
                  } else if (toolId === 'inspection-download') {
                    onToolAction('inspection-download', extra);
                  } else {
                    onToolAction(toolId, extra);
                  }
                }}
                onShowJobBuilder={handleShowJobBuilder}
                onShowCalculator={async () => {
                  const executeWithRetry = async <T,>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
                    let attempt = 0;
                    while (attempt < retries) {
                      try {
                        return await fn();
                      } catch (error) {
                        attempt++;
                        if (attempt >= retries) throw error;
                        await new Promise<void>((resolve) => setTimeout(() => resolve(), delay * attempt));
                      }
                    }
                    throw new Error('Retry limit reached');
                  };

                  try {
                    setLoading(true);
                    let activeLead = leadRef.current || lead;

                    // If lead details are missing (e.g. still loading), wait and retry refetching
                    let refetchAttempts = 0;
                    while (
                      refetchAttempts < 5 &&
                      (!activeLead?.leadId || !activeLead?.customerDetails?.firstName)
                    ) {
                      try {
                        await refetch();
                      } catch (refetchErr) {
                        console.warn('Refetch lead attempt failed:', refetchErr);
                      }
                      await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000));
                      activeLead = leadRef.current || lead;
                      refetchAttempts++;
                    }

                    if (!activeLead?.leadId || !activeLead?.customerDetails?.firstName) {
                      throw new Error('Lead details are still loading. Please try again.');
                    }
                    if (!activeLead?._id) throw new Error('Lead ID is missing');

                    const dateStr =
                      activeLead.leadDate || activeLead.appointmentDate || activeLead.date || new Date().toISOString();
                    const finalLeadDate = activeLead.leadDate
                      ? activeLead.leadDate
                      : dateStr.split('T')[0] + 'T00:00:00+05:00';

                    let res = await executeWithRetry(
                      () => LeadService.getAppointments({ lead_date: finalLeadDate }),
                      3,
                      1000
                    );
                    let appointments = res.data?.data || res.data || [];
                    const targetTitle =
                      activeLead.title ||
                      `${activeLead.customerDetails?.firstName || ''} ${activeLead.customerDetails?.lastName || ''}`.trim() ||
                      'test user';

                    const findMyAppt = (list: any[]) =>
                      list.find(
                        (a: any) =>
                          a.selfGenLeadId === activeLead._id ||
                          a.leadId === activeLead._id ||
                          a._id === activeLead.appointmentId ||
                          a.id === activeLead.appointmentId ||
                          a.title?.trim().toLowerCase() === targetTitle.trim().toLowerCase()
                      );
                    let myAppt = findMyAppt(appointments);

                    if (!myAppt) {
                      await executeWithRetry(
                        () => LeadService.createAppointment({
                          title: targetTitle,
                          address: activeLead.customerDetails?.address || 'N/A',
                          leadId: activeLead.leadId || 'N/A',
                          selfGenLeadId: activeLead._id,
                        }),
                        3,
                        1000
                      );
                      res = await executeWithRetry(
                        () => LeadService.getAppointments({ lead_date: finalLeadDate }),
                        3,
                        1000
                      );
                      appointments = res.data?.data || res.data || [];
                      myAppt = findMyAppt(appointments);
                    }

                    if (!myAppt) throw new Error('Appointment could not be resolved or created.');

                    const apptId = myAppt._id;
                    const calcRes = await executeWithRetry(
                      () => LeadService.getCalculators(apptId),
                      3,
                      1000
                    );
                    let calculatorsData = calcRes.data?.data || calcRes.data || [];

                    if (calculatorsData.length === 0) {
                      const isLowesLead = activeLead.lowesLead === true;
                      const defaultPay = user?.defaultPaymentMethod || (isLowesLead ? 'lowes_ach' : 'check');

                      const INITIAL_INPUTS = {
                        gutter5DsE: '',
                        gutter6Ft1: '',
                        gutter7DsE: '',
                        miters: '',
                        endCaps: '',
                        spoutSavers: '',
                        versaMaxFt1: '',
                        versaMaxFt2: '',
                        versaMaxFt3: '',
                        versa6Ft1: '',
                        versa7Ft1: '',
                        filter45Ft1: '',
                        versa6Ft2: '',
                        versa7Ft2: '',
                        filter45Ft2: '',
                        versa6Ft3: '',
                        versa7Ft3: '',
                        filter45Ft3: '',
                        ckToInstallers: '',
                        extraLabor: '',
                        markup: '100',
                        paymentPlan: defaultPay,
                        price: 0,
                        isLocked: false,
                        discountPercentage: 15,
                        isDefaultDiscount: true,
                      };

                      const INITIAL_EXTRAS = {
                        lighting1stStory: '',
                        lighting2ndStory: '',
                        lighting3rdStory: '',
                        lightingControlBox: '',
                        foamInserts: '',
                        screenRemoval: '',
                        fasciaBoard: '',
                        soffitRepairs: '',
                        dripEdge: '',
                        tuckPointing: '',
                        cappingWrapping: '',
                        underDecking: '',
                        heatCable: '',
                        waterMitigation: '',
                        otherFees: '',
                        commercialPremium: '',
                        ladderSurcharge: '',
                      };

                      const leadName = `${activeLead.customerDetails?.firstName || ''} ${activeLead.customerDetails?.lastName || ''
                        }`.trim();
                      const fullPayload = {
                        title: leadName || '.',
                        position: 1,
                        ...INITIAL_INPUTS,
                        paymentPlan: defaultPay,
                        paymentMethod: defaultPay,
                        pricemarkup: '100',
                        ...Object.keys(INITIAL_EXTRAS).reduce((acc, k) => ({ ...acc, [k]: 0 }), {}),
                        price: 0,
                      };
                      await executeWithRetry(
                        () => LeadService.createCalculator(apptId, fullPayload),
                        3,
                        1000
                      );
                      const reCalcRes = await executeWithRetry(
                        () => LeadService.getCalculators(apptId),
                        3,
                        1000
                      );
                      calculatorsData = reCalcRes.data?.data || reCalcRes.data || [];

                      const createdCalc = calculatorsData[0];
                      const userId = user?._id || user?.id;
                      if (userId && createdCalc) {
                        const createdId = createdCalc._id;
                        const leadId = activeLead._id;
                        await logCalculatorCreated({
                          userId,
                          calculatorId: createdId,
                          appointmentId: createdCalc.appointmentId || apptId,
                          calculatorTitle: createdCalc.title || targetTitle,
                          isFirstCalculator: true,
                          calculatorPosition: 1,
                          leadId,
                        });
                        if (defaultPay) {
                          await logPaymentMethodInherited({
                            userId,
                            calculatorId: createdId,
                            appointmentId: apptId,
                            calculatorTitle: createdCalc.title || targetTitle,
                            paymentMethod: defaultPay,
                            inheritanceSource: 'default payment method',
                            toCalculator: createdId,
                          });
                        }
                      }
                    }

                    if (calculatorsData.length === 0) {
                      throw new Error('Calculator data is empty.');
                    }

                    setLoading(false);
                    navigation.navigate('DealCenter', { lead });
                  } catch (err) {
                    setLoading(false);
                    Alert.alert(
                      'Calculator Error',
                      'Failed to load calculator data. Please check your network connection and try again.'
                    );
                    console.warn('Failed to pre-initialize calculator:', err);
                  }
                }}
                onShowDynamicDealCenter={() => navigation.navigate('DynamicDealCenter', { lead })}
                onShowInvestmentCenter={() => navigation.navigate('InvestmentCenter', { lead })}
                onShowPitchbook={() => navigation.navigate('Pitchbook', { lead })}
                onShowRooflineDeck={() => navigation.navigate('RooflineDeck', { lead })}
                onShowInspectionGrid={() => toggleModal('showInspectionGrid', true)}
                onOpenPdf={handleOpenPdf}
              />
            )}
          </View>
        </ScrollView>

        <View
          className="px-5 py-4 flex-row gap-2"
          style={{
            backgroundColor: isDark ? colors.surface : colors.background,
            paddingBottom: Platform.OS === 'ios' ? 0 : 16,
          }}
        >
          <TouchableOpacity
            onPress={handleOpenChat}
            className="flex-[2] h-12 rounded-xl items-center justify-center bg-blue-600 shadow-lg shadow-blue-500/30 flex-row"
          >
            <Icon
              name="chatbubble-ellipses"
              size={14}
              color="white"
              style={{ marginRight: 6, marginBottom: 2 }}
            />
            <Text className="text-white text-base font-black  tracking-widest">Msg Ops/IM</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {showConsentModal && (
        <ConsentFormModal
          visible={showConsentModal}
          onClose={() => {
            toggleModal('showConsentModal', false);
            setPrefilledOcrData(null);
          }}
          onPaperFallback={() => {
            toggleModal('showConsentModal', false);
            setActiveFallbackForm('consent');
          }}
          onSubmit={handleConsentSubmit}
          lead={lead}
          type="consent"
          loading={consentMutation.isPending}
          prefilledData={prefilledOcrData}
        />
      )}

      {showWaiverModal && (
        <RoofWaiverModal
          visible={showWaiverModal}
          onClose={() => {
            toggleModal('showWaiverModal', false);
            setPrefilledOcrData(null);
          }}
          onPaperFallback={() => {
            toggleModal('showWaiverModal', false);
            setActiveFallbackForm('roof_waiver');
          }}
          onSubmit={handleWaiverSubmit}
          lead={lead}
          loading={waiverMutation.isPending}
          prefilledData={prefilledOcrData}
        />
      )}

      {activeFallbackForm !== null && (
        <PaperFallbackModal
          visible={activeFallbackForm !== null}
          onClose={() => setActiveFallbackForm(null)}
          onSubmit={handlePaperFallbackSubmit}
          loading={ocrMutation.isPending}
        />
      )}

      {showInspectionModal && (
        <InspectionFormModal
          visible={showInspectionModal}
          onClose={() => toggleModal('showInspectionModal', false)}
          onSubmit={handleInspectionSubmit}
          lead={lead}
          loading={isInspectionGenerating}
        />
      )}

      {showRiskModal && (
        <RiskReportModal
          visible={showRiskModal}
          onClose={() => toggleModal('showRiskModal', false)}
          lead={lead}
        />
      )}

      {showMapModal && (
        <MapSelectionModal
          visible={showMapModal}
          address={lead?.fullAddress || lead?.customerDetails?.address || ''}
          onClose={() => setShowMapModal(false)}
        />
      )}

      {showEditCustomerModal && (
        <EditCustomerModal
          visible={showEditCustomerModal}
          onClose={() => setShowEditCustomerModal(false)}
          onSubmit={handleCustomerSubmit}
          lead={lead}
        />
      )}

      <Modal
        visible={showPhoneOptions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPhoneOptions(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setShowPhoneOptions(false)}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: insets.bottom + 16,
            }}
          >
            <View style={{ width: 40, height: 4, backgroundColor: colors.textSecondary, borderRadius: 2, alignSelf: 'center', marginBottom: 20, opacity: 0.3 }} />
            <TouchableOpacity
              onPress={handleCall}
              className="flex-row items-center py-4"
            >
              <Feather name="phone-call" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>Call</Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.5 }} />
            <TouchableOpacity
              onPress={handleTextMessage}
              className="flex-row items-center py-4"
            >
              <Feather name="message-square" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>Text Message</Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.5 }} />
            <TouchableOpacity
              onPress={handleCopyPhone}
              className="flex-row items-center py-4"
            >
              <Feather name="copy" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>Copy Number</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showEmailOptions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEmailOptions(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setShowEmailOptions(false)}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: insets.bottom + 16,
            }}
          >
            <View style={{ width: 40, height: 4, backgroundColor: colors.textSecondary, borderRadius: 2, alignSelf: 'center', marginBottom: 20, opacity: 0.3 }} />
            <TouchableOpacity
              onPress={handleEmail}
              className="flex-row items-center py-4"
            >
              <Feather name="mail" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>Email</Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.5 }} />
            <TouchableOpacity
              onPress={handleCopyEmail}
              className="flex-row items-center py-4"
            >
              <Feather name="copy" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>Copy Email</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

function TabButton({ label, i, active, onPress, colors, isDark }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 items-center justify-center py-2 rounded-xl"
      style={{
        backgroundColor: active ? colors.primary.main : isDark ? colors.card : '#919EAB1F',
        shadowColor: active ? colors.primary.main : 'transparent',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: active ? 6 : 0,
      }}
    >
      <FontAwesome5
        name={active ? i : i}
        size={18}
        color={active ? 'white' : colors.textSecondary}
      />
      <Text
        className="text-base font-semibold mt-1"
        style={{ color: active ? 'white' : colors.textSecondary }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
