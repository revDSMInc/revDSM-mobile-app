import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { ConsentFormModal } from '../../widgets/modals/lead-center/ConsentFormModal';
import { RoofWaiverModal } from '../../widgets/modals/lead-center/RoofWaiverModal';
import { PaperFallbackModal } from '../../widgets/modals/lead-center/PaperFallbackModal';
import { RiskReportModal } from '../../widgets/modals/lead-center/RiskReportModal';
import { PdfPreviewModal } from '../../widgets/modals/PdfPreviewModal';
import { useAuth } from '../../hooks/useAuth';
import { JobDocsSection } from '../../widgets/components/LeadCenter/JobDocsSection';
import { ToolsSection, MapSection } from '../../widgets/components/LeadCenter/OperationalSections';
import Icon from 'react-native-vector-icons/Ionicons';
import { Header } from '../../widgets/common/MainHeader';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import Feather from 'react-native-vector-icons/Feather';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';
import Ionicon from 'react-native-vector-icons/Ionicons';

type TabType = 'job_docs' | 'tools';

import { ImageGridModal } from '../../widgets/modals/lead-center/ImageGridModal';
import { Linking } from 'react-native';
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
        barStyle={isDark ? 'light-content' : 'dark-content'}
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

  const { lead: initialLead, initialTool } = route.params || {};

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
  } = useLeadCenterData(initialLead, user);

  const {
    secureUrls,
    riskJob,
    handleStartRiskReport,
    handleDownloadRiskReport,
    handleDownloadReport,
    handleResetRiskReport,
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

  const [loading, setLoading] = useState(false);

  // Auto-refresh RevRender runs when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (lead?._id) {
        queryClient.invalidateQueries({ queryKey: ['revrender-runs', lead._id] });
      }
    }, [lead?._id, queryClient])
  );

  // Auto-open Job Builder logic
  useEffect(() => {
    const handleAutoOpen = async () => {
      if (route.params?.openJobBuilder && !isOutcomeLoading) {
        try {
          await LeadService.resetLead(lead?._id);
          const res = await LeadService.getLeadOutcome(lead?._id);
          const data = res.data?.data || res.data;
          let updatedJobState;
          if (data?.leadData?.jobBuilder) {
            updatedJobState = data.leadData.jobBuilder;
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
        const isSale = lead.status === 'sale';
        const dateStr = lead.leadDate ? format(new Date(lead.leadDate), 'MM.dd.yy') : '';
        return `${lead.office || ''} ${
          isSale ? lead.leadId : `Lead ${dateStr} - ${lead.leadId || 'N/A'}`
        }`.trim() || 'Discussion';
      })(),
    });
  };

  const handleShowJobBuilder = async () => {
    try {
      setLoading(true);
      await LeadService.resetLead(lead?._id);
      const res = await LeadService.getLeadOutcome(lead?._id);
      const data = res.data?.data || res.data;
      let updatedJobState;
      if (data?.leadData?.jobBuilder) {
        updatedJobState = data.leadData.jobBuilder;
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
      navigation.navigate('JobBuilder', {
        initialJobState: updatedJobState,
        calculatorData,
        leadId: lead?._id,
        outcomeForm,
        onGoBack: setJobState,
      });
    } catch (e) {
      console.warn('Manual reset failed', e);
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
    const res = await consentMutation.mutateAsync(data);
    await refetch();
    return res;
  };

  const handleWaiverSubmit = async (data: any) => {
    const res = await waiverMutation.mutateAsync({ leadId: lead?._id, payload: data });
    await refetch();
    return res;
  };

  const handlePaperFallbackSubmit = async (fileData: any) => {
    try {
      await ocrMutation.mutateAsync(fileData);
      const payload = {
        fullName: lead?.customerDetails?.firstName + ' ' + (lead?.customerDetails?.lastName || ''),
        phoneNumber: lead?.customerDetails?.phone,
        email: lead?.customerDetails?.email,
        leadId: lead?.leadId,
        repName: 'Firstrep',
        officeCode: '01',
        address: lead?.fullAddress || '',
        time: '12:00 AM',
        date: '05/01/2025',
        type: 'paper',
        consent: 'true',
        file: fileData,
      };
      await consentMutation.mutateAsync(payload);
      await refetch();
      toggleModal('showPaperFallback', false);
    } catch (e) {}
  };

  const handleInspectionSubmit = async (data: any) => {
    try {
      FlashMessage.info('Generating inspection report...', 'Generating');
      const token = await AsyncStorage.getItem('accessToken');
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

      handleOpenPdf(pdfPath, 'Inspection Report');

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
      handleOpenPdf(pdfPath, 'Inspection Report');
      toggleModal('showInspectionModal', false);
      FlashMessage.success('Success', 'Inspection report generated and uploaded.');
      refetch();
    } catch (e: any) {
      console.error('Inspection Submit Error:', e);
      FlashMessage.show(e.message || 'Error generating inspection report', 'danger');
    }
  };

  const handleJobSubmit = async (payload: any) => {
    if (user?._id) {
      await submitJobBuilder.mutateAsync({ leadId: lead?._id, payload });
      toggleModal('showJobBuilder', false);
    }
  };

  const handleClose = () => navigation.goBack();

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
      >
        <Header onNavigate={(route) => navigation.navigate(route)} />

        <ImageGridModal
          visible={showInspectionGrid}
          onClose={() => toggleModal('showInspectionGrid', false)}
          images={
            lead?.salesPhotos?.map((p: any) => ({ uri: p.s3url, category: p.category })) || []
          }
        />

        <PdfPreviewModal
          visible={showPdfModal}
          onClose={() => toggleModal('showPdfModal', false)}
          uri={pdfPreviewData.url}
          title={pdfPreviewData.title}
        />

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
            <View className="flex-row gap-[30%] mb-4">
              <View className="flex-col gap-3">
                <Text className="text-sm" style={{ color: colors.textSecondary }}>
                  Lead ID: {lead.leadId}
                </Text>
                <View className="flex-row items-center">
                  <FontAwesome
                    name="user"
                    size={14}
                    color={isDark ? colors.textSecondary : '#637381'}
                  />
                  <Text className="ml-1 text-xs font-semibold text-text-primary">
                    {lead.customerDetails?.firstName} {lead.customerDetails?.lastName}
                  </Text>
                </View>
                <View className="flex-row items-center">
                  <FontAwesome
                    name="phone"
                    size={14}
                    color={isDark ? colors.textSecondary : '#637381'}
                  />
                  <Text className="ml-1 text-xs font-semibold text-text-primary">
                    {lead.customerDetails?.phone}
                  </Text>
                </View>
                <View className="flex-row items-center">
                  <Ionicon
                    name="calendar-clear"
                    size={14}
                    color={isDark ? colors.textSecondary : '#637381'}
                  />
                  <Text className="ml-1 text-xs font-semibold text-text-primary">
                    {formatDate(lead?.leadDatetime)}
                  </Text>
                </View>
              </View>

              <View className="flex-col gap-3">
                <Text className="text-sm text-right" style={{ color: colors.textSecondary }}>
                  Lead Code:{' '}
                  <Text className="font-semibold" style={{ color: colors.text }}>
                    {lead.leadCode || 'N/A'}
                  </Text>
                </Text>
                <View>
                  <Text className="ml-1 text-xs font-semibold text-[#1C252E]"></Text>
                </View>
                <View className="flex-row items-center">
                  <Ionicon
                    name="mail"
                    size={14}
                    color={isDark ? colors.textSecondary : '#637381'}
                  />
                  <Text className="ml-1 text-xs font-semibold  text-text-primary">
                    {lead?.customerDetails?.email || 'N/A'}
                  </Text>
                </View>
                <View className="flex-row items-center">
                  <MaterialIcon
                    name="clock"
                    size={14}
                    color={isDark ? colors.textSecondary : '#637381'}
                  />
                  <Text className="ml-1 text-xs font-semibold  text-text-primary">
                    {lead.leadTime}
                  </Text>
                </View>
              </View>
            </View>
            <View className="flex-row items-center mb-3">
              <Ionicon
                name="location-sharp"
                size={14}
                color={isDark ? colors.textSecondary : '#637381'}
              />
              <Text className="ml-1 text-xs font-semibold " style={{ color: colors.primary.main }}>
                {lead?.fullAddress || lead?.customerDetails?.address || 'N/A'}
              </Text>
            </View>
          </View>
          <View
            className="flex-row px-4"
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
              />
            )}
            {activeTab === 'tools' && (
              <ToolsSection
                lead={lead}
                secureUrls={secureUrls}
                riskJob={riskJob}
                onAction={(toolId: string, extra: any) => {
                  if (toolId === 'revrender') {
                    navigation.navigate('RevRender', {
                      lead,
                      sectionImages,
                      onNavToDocs: () => setActiveTab('job_docs'),
                      onGenerate: async (payload: any) => {
                        try {
                          const res = await revRenderMutation.mutateAsync(payload);
                          const runData = res?.data?.data || res?.data;
                          
                          if (runData?.generatedUrl) {
                            return {
                              generatedUrl: runData.generatedUrl,
                              originalUrl: runData.originalUrl || payload.houseImageUrl
                            };
                          }
                          return null;
                        } catch (error) {
                          return null;
                        }
                      }
                    });
                  } else if (toolId === 'inspection-download') {
                    onToolAction('inspection-download', extra);
                  } else {
                    onToolAction(toolId, extra);
                  }
                }}
                onShowJobBuilder={handleShowJobBuilder}
                onShowCalculator={() => {
                  navigation.navigate('DealCenter', { lead });
                }}
                onShowPitchbook={() => navigation.navigate('Pitchbook', { lead })}
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
            paddingBottom: Platform.OS === 'ios' ? insets.bottom : 16,
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
            <Text className="text-white text-[10px] font-black  tracking-widest">Msg Ops/IM</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {showConsentModal && (
        <ConsentFormModal
          visible={showConsentModal}
          onClose={() => toggleModal('showConsentModal', false)}
          onPaperFallback={() => {
            toggleModal('showConsentModal', false);
            toggleModal('showPaperFallback', true);
          }}
          onSubmit={handleConsentSubmit}
          onFinalUpload={async (pdfPath) => {
            try {
              await finalizeUploadMutation.mutateAsync({
                leadId: lead?._id,
                pdfPath,
                reportType: 'consent_form',
              });
            } catch (error) {
              console.error('Consent auto-upload failed:', error);
            }
          }}
          uploading={finalizeUploadMutation.isPending}
          lead={lead}
          type="consent"
          loading={consentMutation.isPending}
        />
      )}

      {showConsentModal && (
        <ConsentFormModal
          visible={showConsentModal}
          onClose={() => toggleModal('showConsentModal', false)}
          onPaperFallback={() => {
            toggleModal('showConsentModal', false);
            toggleModal('showPaperFallback', true);
          }}
          onSubmit={handleConsentSubmit}
          onFinalUpload={async (pdfPath) => {
            try {
              await finalizeUploadMutation.mutateAsync({
                leadId: lead?._id,
                pdfPath,
                reportType: 'consent_form',
              });
            } catch (error) {
              console.error('Consent auto-upload failed:', error);
            }
          }}
          uploading={finalizeUploadMutation.isPending}
          lead={lead}
          type="consent"
          loading={consentMutation.isPending}
        />
      )}

      {showWaiverModal && (
        <RoofWaiverModal
          visible={showWaiverModal}
          onClose={() => toggleModal('showWaiverModal', false)}
          onPaperFallback={() => {
            toggleModal('showWaiverModal', false);
            toggleModal('showPaperFallback', true);
          }}
          onSubmit={handleWaiverSubmit}
          onFinalUpload={async (pdfPath) => {
            try {
              await finalizeUploadMutation.mutateAsync({
                leadId: lead?._id,
                pdfPath,
                reportType: 'waiver_form',
              });
            } catch (error) {
              console.error('Waiver auto-upload failed:', error);
            }
          }}
          uploading={finalizeUploadMutation.isPending}
          lead={lead}
          loading={waiverMutation.isPending}
        />
      )}

      {showPaperFallback && (
        <PaperFallbackModal
          visible={showPaperFallback}
          onClose={() => toggleModal('showPaperFallback', false)}
          onSubmit={handlePaperFallbackSubmit}
          loading={consentMutation.isPending}
        />
      )}

      {showInspectionModal && (
        <InspectionFormModal
          visible={showInspectionModal}
          onClose={() => toggleModal('showInspectionModal', false)}
          onSubmit={handleInspectionSubmit}
          lead={lead}
          loading={reportMutation.isPending}
        />
      )}

      {showRiskModal && (
        <RiskReportModal
          visible={showRiskModal}
          onClose={() => toggleModal('showRiskModal', false)}
          lead={lead}
        />
      )}

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
        className="text-xs font-semibold mt-1"
        style={{ color: active ? 'white' : colors.textSecondary }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
